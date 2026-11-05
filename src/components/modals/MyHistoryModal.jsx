import React from 'react';
import { ModalShell } from './ModalShell';
import { ResultBadge } from './shared';
import { getTeamOf, getWinLoss, TEAM_META } from '../../lib/helpers';

/** [내 기록] 일반 선수가 자기 카드를 탭하면 보이는 오늘의 기록 (조회 전용) */
export function MyHistoryModal({ player, allPlayers, onClose, teamMode = false, rankInfo = null }) {
    const games = player?.todayRecentGames || [];
    const getPlayerName = (id) => allPlayers[id]?.name || '알수없음';
    const { wins, losses } = getWinLoss(player);
    const myTeam = getTeamOf(player);

    return (
        <ModalShell
            title="🏸 내 기록"
            titleClass="display accent"
            onClose={onClose}
            zIndex={60}
            footer={<button type="button" className="cox-btn primary" onClick={onClose}>확인</button>}
        >
            <div className="cox-box accent text-center mb-3">
                <p className="text-sm text-gray-400">오늘 경기 수</p>
                <p className="text-3xl font-bold text-yellow-400 arcade-font">{games.length}<span className="text-base ml-1">경기</span></p>
                {teamMode && (
                    <>
                        <p className="mt-1 text-sm font-black">
                            {myTeam && <span style={{ color: TEAM_META[myTeam].text }}>{TEAM_META[myTeam].label} · </span>}
                            <span className="text-green-300">{wins}승</span>
                            <span className="text-gray-500 mx-1">·</span>
                            <span className="text-red-300">{losses}패</span>
                            {rankInfo && rankInfo.rate !== null && <span className="text-yellow-300 ml-2">승률 {rankInfo.rate}%</span>}
                        </p>
                        {rankInfo && (
                            <p className="mt-1 text-xs text-gray-300">
                                🏆 {rankInfo.teamRank ? `${myTeam ? TEAM_META[myTeam].label : '팀'} 내 ${rankInfo.teamRank}위 / ${rankInfo.teamCount}명` : '팀 미정'}
                                <span className="text-gray-500 mx-1">·</span>
                                전체 {rankInfo.overallRank}위 / {rankInfo.overallCount}명
                            </p>
                        )}
                    </>
                )}
            </div>

            <div className="space-y-1.5">
                {games.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">아직 오늘 경기 기록이 없어요.<br />곧 매칭에 뽑힐 거예요!</p>
                )}
                {games.map((game, i) => (
                    game.isManual ? (
                        <div key={i} className="cox-box soft text-sm text-gray-400">관리자 조정 기록</div>
                    ) : (
                        <div key={i} className="cox-box soft text-sm">
                            <p>
                                <ResultBadge game={game} />
                                <span className="text-gray-500 text-xs mr-1.5">함께</span>
                                <span className="text-green-300 font-semibold">{game.partners.map(getPlayerName).join(', ') || '-'}</span>
                            </p>
                            <p className="mt-0.5">
                                <span className="text-gray-500 text-xs mr-1.5">상대</span>
                                <span className="text-gray-200">{game.opponents.map(getPlayerName).join(', ') || '-'}</span>
                            </p>
                        </div>
                    )
                ))}
            </div>
        </ModalShell>
    );
}
