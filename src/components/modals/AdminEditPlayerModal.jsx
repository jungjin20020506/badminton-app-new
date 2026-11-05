import React from 'react';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ModalShell } from './ModalShell';
import { ResultBadge } from './shared';
import { playersRef } from '../../lib/firebase';
import { getTeamOf, getWinLoss, TEAM_BLUE, TEAM_WHITE, TEAM_META } from '../../lib/helpers';
import { log } from '../../lib/logger';
import { startRest, resumeFromRest, restRemainingMin } from '../../lib/rest';

// ===================================================================================
// [선수 정보 관리] 카드를 1초 길게 눌렀을 때 (관리자) — 휴식 토글 · 경기 수 ±1 · 기록 열람 · 완전 삭제
// [청백전] 승/패 수동 조작 · 팀 바꾸기
// ===================================================================================
export function AdminEditPlayerModal({ player, allPlayers, onClose, setModal, teamMode = false }) {
    const currentPlayer = allPlayers[player.id] || player;
    const remaining = restRemainingMin(currentPlayer);

    const handleToggleRest = async () => {
        try {
            if (currentPlayer.isResting) await resumeFromRest(player.id);
            else await startRest(player.id, null); // 관리자가 넣는 휴식은 시간 제한 없음
        } catch (e) { log.error('휴식 상태 변경 실패:', e); }
        onClose();
    };

    const { wins, losses } = getWinLoss(currentPlayer);
    const handleAdjustWinLoss = async (field, delta) => {
        const cur = field === 'todayWins' ? wins : losses;
        const next = Math.max(0, cur + delta);
        if (next === cur) return;
        try { await updateDoc(doc(playersRef, player.id), { [field]: next }); }
        catch (error) { log.error('Win/loss adjustment failed:', error); }
    };
    const currentTeam = getTeamOf(currentPlayer);
    const handleSetTeam = async (team) => {
        if (team === currentTeam) return;
        try { await updateDoc(doc(playersRef, player.id), { team }); }
        catch (error) { log.error('Team change failed:', error); }
    };
    const handleAdjustGameCount = async (delta) => {
        const currentGames = currentPlayer.todayRecentGames || [];
        const newGames = [...currentGames];
        if (delta > 0) newGames.unshift({ timestamp: new Date().toISOString(), partners: [], opponents: [], isManual: true });
        else if (delta < 0 && newGames.length > 0) newGames.shift();
        try { await updateDoc(doc(playersRef, player.id), { todayRecentGames: newGames }); }
        catch (error) { log.error('Game count adjustment failed:', error); }
    };
    const handleDeletePermanently = () => {
        setModal({ type: 'confirm', data: {
            title: '선수 완전 삭제',
            body: `[경고] ${player.name} 선수를 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`,
            confirmLabel: '삭제',
            onConfirm: async () => {
                await deleteDoc(doc(playersRef, player.id));
                onClose();
                setModal({ type: null, data: null });
            },
        } });
    };

    const getPlayerName = (id) => allPlayers[id]?.name || '알수없음';
    const games = currentPlayer.todayRecentGames || [];

    return (
        <ModalShell
            title={`${player.name} 정보 관리`}
            titleClass="display accent"
            onClose={onClose}
            size="md"
            zIndex={60}
            footer={<button type="button" onClick={handleDeletePermanently} className="cox-btn ghost sm" style={{ color: 'var(--coral)' }}>선수 완전 삭제</button>}
        >
            <div className="space-y-3">
                <button type="button" onClick={handleToggleRest} className={`cox-btn block ${currentPlayer.isResting ? 'primary' : 'ghost'}`}>
                    {currentPlayer.isResting
                        ? `휴식 해제 (복귀) · ${remaining !== null ? `${remaining}분 남음` : '∞ 시간 제한 없음'}`
                        : '휴식 상태로 전환'}
                </button>

                <div className="cox-box soft flex items-center justify-between">
                    <span className="font-bold text-gray-300 text-sm">현재 게임 수 조작</span>
                    <div className="cox-stepper">
                        <button type="button" onClick={() => handleAdjustGameCount(-1)} aria-label="게임 수 1 빼기">−</button>
                        <span className="val" style={{ minWidth: 40, fontSize: 24 }}>{games.length}</span>
                        <button type="button" onClick={() => handleAdjustGameCount(1)} aria-label="게임 수 1 더하기">+</button>
                    </div>
                </div>

                {teamMode && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="font-bold text-gray-300 text-sm">⚔️ 승패 수동 조작</span>
                            <span className="text-[10px] text-gray-500">팀 점수판은 바뀌지 않아요</span>
                        </div>
                        <div className="tm-wl-adjust">
                            <div className="cell w">
                                <span className="k">승</span>
                                <div className="ctr">
                                    <button type="button" onClick={() => handleAdjustWinLoss('todayWins', -1)} aria-label="승 1 빼기">−</button>
                                    <b>{wins}</b>
                                    <button type="button" onClick={() => handleAdjustWinLoss('todayWins', 1)} aria-label="승 1 더하기">+</button>
                                </div>
                            </div>
                            <div className="cell l">
                                <span className="k">패</span>
                                <div className="ctr">
                                    <button type="button" onClick={() => handleAdjustWinLoss('todayLosses', -1)} aria-label="패 1 빼기">−</button>
                                    <b>{losses}</b>
                                    <button type="button" onClick={() => handleAdjustWinLoss('todayLosses', 1)} aria-label="패 1 더하기">+</button>
                                </div>
                            </div>
                        </div>
                        <div className="cox-box soft flex items-center justify-between">
                            <span className="font-bold text-gray-300 text-sm">소속 팀</span>
                            <div className="flex gap-1.5">
                                {[TEAM_BLUE, TEAM_WHITE].map((team) => (
                                    <button
                                        key={team}
                                        type="button"
                                        onClick={() => handleSetTeam(team)}
                                        aria-pressed={currentTeam === team}
                                        className={`px-3 min-h-[40px] rounded-lg text-xs font-black arcade-button border ${currentTeam === team
                                            ? (team === TEAM_BLUE ? 'bg-blue-500 border-blue-400 text-white' : 'bg-gray-100 border-white text-gray-900')
                                            : 'bg-gray-700 border-gray-600 text-gray-300'}`}
                                    >
                                        {TEAM_META[team].label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <hr className="border-gray-600" />
                <h3 className="font-bold text-yellow-400 text-center text-sm">오늘의 매칭 히스토리</h3>
                {games.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center">오늘 매칭 기록이 없습니다.</p>
                ) : (
                    <ul className="text-sm space-y-1 max-h-40 overflow-y-auto pr-1">
                        {games.map((game, i) => (
                            <li key={i} className="cox-box soft" style={{ padding: '8px 10px' }}>
                                {game.isManual ? (
                                    <div className="flex flex-wrap gap-1 items-center">
                                        <span className="text-yellow-400 font-bold">{getPlayerName(player.id)}</span>
                                        <span className="text-gray-400 text-xs ml-2">(수동 조작됨)</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-1 items-center">
                                        <ResultBadge game={game} />
                                        {[player.id, ...(game.partners || []), ...(game.opponents || [])].map((id, idx, arr) => (
                                            <span key={idx} className={id === player.id ? 'text-yellow-400 font-bold' : 'text-gray-300'}>
                                                {getPlayerName(id)}{idx < arr.length - 1 ? ', ' : ''}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </ModalShell>
    );
}
