import { useCallback, useEffect, useRef, useState } from 'react';
import { buildMatchContext, buildCandidatePool, generateMatchOptions, getSensitivity } from '../lib/matching';
import { repairMatchQueues } from '../lib/helpers';
import { log } from '../lib/logger';

// ===================================================================================
// [자동 매칭] '매칭 만들기' — 후보 6개를 보여주고 관리자가 고른다 + 막힌 예약 자동 정리
// -----------------------------------------------------------------------------------
//  접속한 전원(대기석 + 경기중)을 후보로 놓고 베스트 2 / 보통 2 / 아쉬움 2를 이유와 함께
//  보여준다. 관리자가 고른 것만 목록에 들어간다. (이미 다음 경기가 잡힌 선수는 제외)
//  후보를 목록에 넣기 직전에도 DB 최신 상태로 재검증한다 (모달이 열린 동안 상황이 바뀐다).
// ===================================================================================
export function useMatchActions({ isAdmin, allPlayers, gameState, seasonConfig, inProgressPlayerIds, teamMode, updateGameState, setModal }) {
    const isGeneratingRef = useRef(false);
    const [generatingGender, setGeneratingGender] = useState(null);

    /** 지금 상황 기준으로 선택지를 계산한다 (모달을 처음 열 때 · '다시 계산'을 누를 때) */
    const computeMatchOptions = useCallback((gender) => {
        const isMixed = gender === '혼복';
        const config = seasonConfig?.autoMatchConfig || {};
        const masterSens = config.sensitivity || 'normal';
        const perGender = !!config.perGenderSensitivity;
        const sensKey = (perGender && !isMixed)
            ? ((gender === '남' ? config.maleSensitivity : config.femaleSensitivity) || masterSens)
            : masterSens;
        const sens = getSensitivity(sensKey);
        const ctx = buildMatchContext(allPlayers, gameState, { now: Date.now() });
        const pool = buildCandidatePool(ctx, gender);
        // 예약이 쌓이면 목록 전체가 대기 상태가 되어 코트가 놀기 때문에, 엔진이
        // "이번엔 바로 시작 가능한 조합"을 우선하도록 알려준다.
        const pendingReservations = Object.values(gameState?.autoMatches || {})
            .filter((m) => (m || []).some((id) => id && inProgressPlayerIds.has(id))).length;
        return generateMatchOptions({ pool, ctx, mode: gender, maxOnCourt: sens.maxOnCourt, pages: 3, pendingReservations, teamMatch: teamMode });
    }, [allPlayers, gameState, seasonConfig, inProgressPlayerIds, teamMode]);

    const handleGenerateMatch = useCallback(async (gender) => {
        const isMixed = gender === '혼복';
        const genderLabel = isMixed ? '혼복' : (gender === '남' ? '남자' : '여자');
        if (!isAdmin || isGeneratingRef.current) return;
        if (!allPlayers || !gameState) {
            setModal({ type: 'alert', data: { title: '잠시만요', body: '데이터를 불러오는 중입니다. 잠시 후 다시 눌러주세요.' } });
            return;
        }
        isGeneratingRef.current = true;
        setGeneratingGender(gender);
        try {
            const result = computeMatchOptions(gender);
            if (result.status !== 'ok') {
                setModal({ type: 'alert', data: {
                    title: `${genderLabel} 매칭 불가`,
                    body: result.isTeamMatch
                        ? (isMixed
                            ? `청백전 혼복은 청팀·백팀 각각 남 1명 + 여 1명 이상 필요합니다.\n(현재 청 ${result.blueCount ?? 0}명 · 백 ${result.whiteCount ?? 0}명)\n\n※ 휴식 중이거나 이미 다음 경기가 잡힌 선수는 빠집니다.`
                            : `청백전은 ${genderLabel} 선수가 청팀 2명, 백팀 2명 이상 필요합니다.\n(현재 청 ${result.blueCount ?? 0}명 · 백 ${result.whiteCount ?? 0}명)\n\n※ 휴식 중이거나 이미 다음 경기가 잡힌 선수는 빠집니다.\n경기중인 선수도 후보에 포함되므로, 경기가 끝나면 다시 눌러보세요.`)
                        : isMixed
                            ? `혼복은 남자 2명, 여자 2명 이상 필요합니다.\n(현재 남 ${result.maleCount ?? 0}명 · 여 ${result.femaleCount ?? 0}명)\n\n※ 휴식 중이거나 이미 다음 경기가 잡힌 선수는 빠집니다.`
                            : `${genderLabel} 선수가 4명 이상 필요합니다. (현재 ${result.poolSize}명)\n\n※ 휴식 중이거나 이미 다음 경기가 잡힌 선수는 빠집니다.\n경기중인 선수도 후보에 포함되므로, 경기가 끝나면 다시 눌러보세요.`,
                } });
                return;
            }
            setModal({ type: 'matchOptions', data: { gender, genderLabel, result } });
        } catch (error) {
            log.error('Auto-match generate error:', error);
            setModal({ type: 'alert', data: { title: '오류', body: '매칭 후보를 계산하지 못했습니다.' } });
        } finally {
            isGeneratingRef.current = false;
            setGeneratingGender(null);
        }
    }, [isAdmin, allPlayers, gameState, computeMatchOptions, setModal]);

    /** 모달에서 '다시 계산'을 눌렀을 때 — 지금 코트 상황으로 후보를 새로 뽑는다 */
    const handleRegenerateOptions = useCallback((gender, genderLabel) => {
        try {
            const result = computeMatchOptions(gender);
            if (result.status !== 'ok') {
                setModal({ type: 'alert', data: {
                    title: `${genderLabel} 매칭 불가`,
                    body: result.isTeamMatch ? '지금은 청팀 2명 · 백팀 2명을 채울 수 없습니다.' : '지금은 매칭할 수 있는 선수가 4명이 안 됩니다.',
                } });
                return;
            }
            setModal({ type: 'matchOptions', data: { gender, genderLabel, result } });
        } catch (error) {
            log.error('Auto-match regenerate error:', error);
        }
    }, [computeMatchOptions, setModal]);

    /** 관리자가 선택지 하나를 골랐을 때 — 자동 매칭 목록 맨 뒤에 추가 */
    const handleSelectMatchOption = useCallback(async (option) => {
        let failReason = null;
        try {
            await updateGameState((currentState) => {
                const newState = JSON.parse(JSON.stringify(currentState));
                if (!newState.autoMatches) newState.autoMatches = {};
                const queuedIds = new Set([
                    ...Object.values(newState.autoMatches).flat(),
                    ...Object.values(newState.scheduledMatches || {}).flat(),
                ].filter(Boolean));
                if (option.ids.some((id) => queuedIds.has(id))) {
                    failReason = '방금 다른 관리자가 같은 선수를 다른 경기에 넣었습니다.';
                    return { newState };
                }
                const goneName = option.ids.map((id) => allPlayers?.[id]).find((p) => !p || p.status !== 'active' || p.isResting)?.name;
                if (goneName !== undefined) {
                    failReason = `${goneName || '일부'} 선수가 방금 빠졌습니다.`;
                    return { newState };
                }
                const nextIndex = Object.keys(newState.autoMatches).length;
                newState.autoMatches[String(nextIndex)] = [...option.ids];
                return { newState };
            }, '자동 매칭 목록에 추가하지 못했습니다.');
        } catch { return; } // 토스트로 이미 알렸다 — 모달은 열어 두어 다시 고를 수 있게

        setModal({ type: null, data: null });
        if (failReason) {
            setModal({ type: 'alert', data: { title: '다시 골라주세요', body: `${failReason}\n\n매칭 버튼을 한 번 더 눌러 새 후보를 확인해주세요.` } });
        }
    }, [updateGameState, allPlayers, setModal]);

    // [자동매칭 v2] 막힌 예약 경기 자동 정리 — 관리자 화면이 감지하면 스스로 풀린다
    // (서버 크론 api/cron/repair-queues 가 같은 일을 하므로 관리자가 없어도 정리된다)
    const isRepairingRef = useRef(false);
    useEffect(() => {
        if (!isAdmin || !gameState || !allPlayers || Object.keys(allPlayers).length === 0) return;
        if (isRepairingRef.current) return;
        const { changed } = repairMatchQueues(gameState, allPlayers);
        if (!changed) return;
        isRepairingRef.current = true;
        updateGameState((currentState) => {
            const { newState } = repairMatchQueues(currentState, allPlayers);
            return { newState };
        })
            .catch((err) => log.error('예약 경기 자동 정리 실패:', err))
            .finally(() => { isRepairingRef.current = false; });
    }, [isAdmin, gameState, allPlayers, updateGameState]);

    const handleClearAutoMatches = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '전체 삭제', body: '자동 매칭 목록을 모두 삭제할까요?', confirmLabel: '삭제',
            onConfirm: () => {
                updateGameState((currentState) => ({ newState: { ...currentState, autoMatches: {} } })).catch(() => {});
                setModal({ type: null, data: null });
            },
        } });
    }, [updateGameState, setModal]);

    const handleDeleteAutoMatch = useCallback((matchIndex) => {
        setModal({ type: 'confirm', data: {
            title: '경기 삭제', body: `${parseInt(matchIndex, 10) + 1}번 경기를 삭제할까요?`, confirmLabel: '삭제',
            onConfirm: () => {
                updateGameState((currentState) => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    delete newState.autoMatches[matchIndex];
                    const reindexed = {};
                    Object.values(newState.autoMatches).forEach((m, i) => { reindexed[String(i)] = m; });
                    newState.autoMatches = reindexed;
                    return { newState };
                }).catch(() => {});
                setModal({ type: null, data: null });
            },
        } });
    }, [updateGameState, setModal]);

    return { generatingGender, handleGenerateMatch, handleRegenerateOptions, handleSelectMatchOption, handleClearAutoMatches, handleDeleteAutoMatch };
}
