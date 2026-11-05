import { useCallback } from 'react';
import { doc } from 'firebase/firestore';
import { db, playersRef, gameStateRef, runTx, writeAuditLog } from '../lib/firebase';
import { PLAYERS_PER_MATCH, TEAM_BLUE, TEAM_WHITE, getTeamOf, emptyTeamScores, teamScoreKey } from '../lib/helpers';
import { playStart, playFinish } from '../lib/sound';
import { log } from '../lib/logger';

// ===================================================================================
// [코트 운영] 경기 시작 / 종료 / 취소 / 코트 이동·교환 / 점수판 수정
// -----------------------------------------------------------------------------------
//  · 시작: 트랜잭션 안에서 "슬롯이 여전히 찼는지, 4명 중 누구도 다른 코트에 없는지" 재검증
//  · 종료: gameState + 선수 4명을 한 트랜잭션에서 읽고 기록 추가 후 코트 비움.
//          코트가 이미 비어 있으면 아무것도 하지 않는다 (관리자 둘이 동시에 눌러도 중복 기록 없음)
// ===================================================================================
export function useCourtActions({ gameState, allPlayers, inProgressPlayerIds, teamMode, currentUser, updateGameState, setModal, setCourtMove }) {
    const handleStartMatch = useCallback(async (matchIndex, matchType = 'schedule') => {
        if (!gameState) return;
        const match = matchType === 'schedule'
            ? gameState.scheduledMatches[String(matchIndex)] || []
            : gameState.autoMatches[String(matchIndex)] || [];
        if (match.filter((p) => p).length !== PLAYERS_PER_MATCH) return;

        if (match.some((playerId) => inProgressPlayerIds.has(playerId))) {
            setModal({ type: 'alert', data: { title: '시작 불가', body: '선수가 이미 경기중입니다.' } });
            return;
        }
        // [청백전] 왼쪽 2명 청 · 오른쪽 2명 백이 아니면 시작하지 않는다
        if (teamMode && matchType === 'schedule') {
            const bad = match.some((id, i) => id && getTeamOf(allPlayers[id]) !== (i < 2 ? TEAM_BLUE : TEAM_WHITE));
            if (bad) {
                setModal({ type: 'alert', data: { title: '시작 불가', body: '청팀 2명(왼쪽) vs 백팀 2명(오른쪽)이 아니에요.\n⚠ 표시된 선수를 자기 팀 칸으로 옮겨주세요.' } });
                return;
            }
        }

        const emptyCourts = [];
        for (let i = 0; i < gameState.numInProgressCourts; i += 1) if (!gameState.inProgressCourts[i]) emptyCourts.push(i);
        if (emptyCourts.length === 0) {
            setModal({ type: 'alert', data: { title: '시작 불가', body: '빈 코트가 없습니다.' } });
            return;
        }

        const start = async (courtIndex) => {
            const updateFunction = (currentState) => {
                const newState = JSON.parse(JSON.stringify(currentState));
                // [중복 방지 #1] 대상 코트가 이미 사용 중이면 중단
                if (newState.inProgressCourts[courtIndex]) throw new Error('이미 다른 관리자가 이 코트에서 경기를 시작했습니다.');
                const currentMatch = (matchType === 'schedule' ? newState.scheduledMatches : newState.autoMatches)[String(matchIndex)] || [];
                if (currentMatch.filter((p) => p).length !== PLAYERS_PER_MATCH) throw new Error('경기를 시작할 수 없습니다. 다른 관리자가 먼저 시작했을 수 있습니다.');
                const playersToMove = [...currentMatch];
                // [중복 방지 #2] 이 선수들이 이미 다른 코트에서 경기 중이면 중단
                const onCourt = new Set(newState.inProgressCourts.filter((c) => c && c.players).flatMap((c) => c.players).filter(Boolean));
                if (playersToMove.some((pid) => pid && onCourt.has(pid))) throw new Error('선택한 선수가 이미 다른 코트에서 경기 중입니다.');

                if (matchType === 'schedule') {
                    for (let i = matchIndex; i < newState.numScheduledMatches - 1; i += 1) {
                        newState.scheduledMatches[String(i)] = newState.scheduledMatches[String(i + 1)] || Array(PLAYERS_PER_MATCH).fill(null);
                    }
                    newState.scheduledMatches[String(newState.numScheduledMatches - 1)] = Array(PLAYERS_PER_MATCH).fill(null);
                } else {
                    delete newState.autoMatches[matchIndex];
                    const reindexed = {};
                    Object.values(newState.autoMatches).forEach((m, i) => { reindexed[String(i)] = m; });
                    newState.autoMatches = reindexed;
                }
                newState.inProgressCourts[courtIndex] = {
                    players: playersToMove,
                    startTime: new Date().toISOString(),
                    matchId: `${courtIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                };
                return { newState };
            };
            try {
                await updateGameState(updateFunction, '경기를 시작하는 데 실패했습니다. 다른 관리자가 먼저 시작했을 수 있습니다.');
            } catch { setModal({ type: null, data: null }); return; }
            playStart();
            setModal({ type: null, data: null });
        };

        if (emptyCourts.length === 1) start(emptyCourts[0]);
        else setModal({ type: 'courtSelection', data: { courts: emptyCourts, onSelect: start } });
    }, [gameState, updateGameState, inProgressPlayerIds, teamMode, allPlayers, setModal]);

    const handleStartAutoMatch = useCallback((matchIndex) => handleStartMatch(matchIndex, 'auto'), [handleStartMatch]);

    // 경기 종료 트랜잭션 (일반 · 청백전 공용)
    //  result: null → 일반 모드, 히스토리만 기록
    //  result: { winnerSide:'A'|'B' } → [청백전] 이긴 쪽 todayWins+1, 진 쪽 todayLosses+1, 통일된 팀이면 팀 점수 +1
    const finishCourtTx = useCallback(async (courtIndex, result) => {
        await runTx('경기 종료', async (transaction) => {
            const gameStateDoc = await transaction.get(gameStateRef);
            if (!gameStateDoc.exists()) throw new Error('게임 상태가 존재하지 않습니다.');
            const currentState = gameStateDoc.data();
            const currentCourt = currentState.inProgressCourts[courtIndex];
            if (!currentCourt || !currentCourt.players) return; // 이미 다른 관리자에 의해 종료됨

            const allMatchPlayerIds = currentCourt.players;
            const validPlayerIds = allMatchPlayerIds.filter(Boolean);
            const now = new Date().toISOString();
            const teamA = [allMatchPlayerIds[0], allMatchPlayerIds[1]].filter(Boolean);
            const teamB = [allMatchPlayerIds[2], allMatchPlayerIds[3]].filter(Boolean);

            const playerDocs = await Promise.all(validPlayerIds.map((pId) => transaction.get(doc(playersRef, pId))));

            let winnerTeam = null;
            if (result?.winnerSide) {
                const winnerIds = result.winnerSide === 'A' ? teamA : teamB;
                const teams = [...new Set(winnerIds.map((id) => {
                    const d = playerDocs.find((pd) => pd.id === id);
                    return d && d.exists() ? getTeamOf(d.data()) : null;
                }))];
                winnerTeam = teams.length === 1 && teams[0] ? teams[0] : null;
            }

            playerDocs.forEach((pDoc) => {
                if (!pDoc.exists()) return;
                const pId = pDoc.id;
                const pData = pDoc.data();
                let partners = [], opponents = [], side = null;
                if (teamA.includes(pId)) { partners = teamA.filter((id) => id !== pId); opponents = teamB; side = 'A'; }
                else if (teamB.includes(pId)) { partners = teamB.filter((id) => id !== pId); opponents = teamA; side = 'B'; }

                const gameRecord = { timestamp: now, partners, opponents };
                const update = {};
                if (result?.winnerSide && side) {
                    const won = side === result.winnerSide;
                    gameRecord.result = won ? 'win' : 'loss';
                    gameRecord.winnerTeam = winnerTeam;
                    if (won) update.todayWins = (Number(pData.todayWins) || 0) + 1;
                    else update.todayLosses = (Number(pData.todayLosses) || 0) + 1;
                }
                const recentGames = (pData.todayRecentGames || []).slice(0, 19); // 최근 20경기 유지
                transaction.update(pDoc.ref, { ...update, todayRecentGames: [gameRecord, ...recentGames] });
            });

            const newState = JSON.parse(JSON.stringify(currentState));
            newState.inProgressCourts[courtIndex] = null;
            if (winnerTeam) {
                const key = teamScoreKey(winnerTeam);
                const scores = { ...emptyTeamScores(), ...(newState.teamScores || {}) };
                scores[key] = (Number(scores[key]) || 0) + 1;
                newState.teamScores = scores;
            }
            if (result?.winnerSide) {
                const winners = result.winnerSide === 'A' ? teamA : teamB;
                const losers = result.winnerSide === 'A' ? teamB : teamA;
                newState.lastTeamResult = { at: now, winnerTeam, courtIndex, players: validPlayerIds, winners, losers };
                newState.teamResultLog = [
                    { at: now, winnerTeam, courtIndex, winners, losers },
                    ...(Array.isArray(newState.teamResultLog) ? newState.teamResultLog : []),
                ].slice(0, 60);
            }
            transaction.set(gameStateRef, newState);
        });
        playFinish();
    }, []);

    const handleEndMatch = useCallback((courtIndex) => {
        const court = gameState?.inProgressCourts?.[courtIndex];
        if (!court || !court.players) return;
        if (teamMode) { setModal({ type: 'teamMatchEnd', data: { courtIndex } }); return; }
        setModal({
            type: 'confirm',
            data: {
                title: '경기 종료',
                body: '경기를 종료하고 코트를 비우시겠습니까? (선수들의 매칭 히스토리가 기록됩니다.)',
                confirmLabel: '종료',
                onConfirm: async () => {
                    setModal({ type: null, data: null });
                    try { await finishCourtTx(courtIndex, null); }
                    catch (e) { log.error(e); setModal({ type: 'alert', data: { title: '오류', body: '결과 처리에 실패했습니다.' } }); }
                },
            },
        });
    }, [gameState, teamMode, finishCourtTx, setModal]);

    const handleTeamPickWinner = useCallback(async (courtIndex, winnerSide) => {
        setModal({ type: null, data: null });
        try { await finishCourtTx(courtIndex, { winnerSide }); }
        catch (e) { log.error(e); setModal({ type: 'alert', data: { title: '오류', body: '결과 처리에 실패했습니다.' } }); }
    }, [finishCourtTx, setModal]);

    const handleTeamCancelMatch = useCallback((courtIndex) => {
        setModal({ type: 'confirm', data: {
            title: '경기 취소',
            body: `${courtIndex + 1}번 코트 경기를 취소할까요?\n승패·경기 수·히스토리를 남기지 않고 코트만 비웁니다.`,
            confirmLabel: '취소하기',
            onConfirm: async () => {
                setModal({ type: null, data: null });
                await updateGameState((currentState) => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    newState.inProgressCourts[courtIndex] = null;
                    return { newState };
                }, '경기 취소에 실패했습니다.').catch(() => {});
            },
        } });
    }, [updateGameState, setModal]);

    const handleTeamScoreSave = useCallback(async (scores) => {
        try {
            await updateGameState((currentState) => ({
                newState: { ...currentState, teamScores: { blue: scores.blue, white: scores.white } },
            }), '점수 저장에 실패했습니다.');
        } catch { return; }
        writeAuditLog('청백전-점수수정', { by: currentUser?.name || null, scores });
        setModal({ type: null, data: null });
    }, [updateGameState, currentUser, setModal]);

    const handleMoveOrSwapCourt = useCallback(async (sourceIndex, targetIndex) => {
        if (sourceIndex === targetIndex) return;
        await updateGameState((currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            if (newState.inProgressCourts.length < newState.numInProgressCourts) {
                newState.inProgressCourts.length = newState.numInProgressCourts;
                newState.inProgressCourts.fill(null, newState.inProgressCourts.length);
            }
            const a = newState.inProgressCourts[sourceIndex] || null;
            const b = newState.inProgressCourts[targetIndex] || null;
            newState.inProgressCourts[sourceIndex] = b;
            newState.inProgressCourts[targetIndex] = a;
            return { newState };
        }, '코트 이동/교환에 실패했습니다.').catch(() => {});
        setCourtMove({ sourceIndex: null });
    }, [updateGameState, setCourtMove]);

    return { handleStartMatch, handleStartAutoMatch, finishCourtTx, handleEndMatch, handleTeamPickWinner, handleTeamCancelMatch, handleTeamScoreSave, handleMoveOrSwapCourt, db };
}
