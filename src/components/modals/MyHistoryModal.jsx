import React, { useMemo } from 'react';
import { ModalShell } from './ModalShell';
import { ResultBadge } from './shared';
import { getTeamOf, getWinLoss, getLevelColor, TEAM_META } from '../../lib/helpers';

// ===================================================================================
// [내 기록] 오늘 내가 친 경기 — 선수 화면의 '📋 내 기록' 버튼 / 하단 가운데 버튼 / 프로필 메뉴에서 연다
//  · 위: 오늘 경기 수 · 함께 친 사람 수 · 가장 많이 만난 사람 (청백전: 승·패·순위)
//  · 아래: 경기 한 판씩 — 몇 시, 함께/상대 (이름 옆 급수 색 점)
// ===================================================================================
function timeLabel(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

function Person({ id, allPlayers }) {
    const p = allPlayers?.[id];
    const color = p ? getLevelColor(p.level, p.isGuest) : '#8C93A1';
    return (
        <span className="mh-person">
            <i style={{ background: color }} aria-hidden="true" />
            {p?.name || '알수없음'}
        </span>
    );
}

export function MyHistoryModal({ player, allPlayers, onClose, teamMode = false, rankInfo = null }) {
    const games = useMemo(() => (Array.isArray(player?.todayRecentGames) ? player.todayRecentGames : []), [player?.todayRecentGames]);
    const { wins, losses } = getWinLoss(player);
    const myTeam = getTeamOf(player);

    // 함께 친 사람(같은 편 + 상대) 집계 — 관리자 조정 기록은 제외
    const { metCount, topMet } = useMemo(() => {
        const count = {};
        games.forEach((g) => {
            if (!g || g.isManual) return;
            [...(g.partners || []), ...(g.opponents || [])].filter(Boolean).forEach((id) => { count[id] = (count[id] || 0) + 1; });
        });
        const entries = Object.entries(count).sort((a, b) => b[1] - a[1]);
        return { metCount: entries.length, topMet: entries.length ? entries[0] : null };
    }, [games]);

    const realGames = games.filter((g) => g && !g.isManual);

    return (
        <ModalShell
            title="📋 내 기록"
            titleClass="display accent"
            subtitle={player?.name ? `${player.name} · 오늘` : '오늘'}
            onClose={onClose}
            zIndex={60}
            footer={<button type="button" className="cox-btn primary" onClick={onClose}>확인</button>}
        >
            <div className="mh-summary">
                <div className="mh-tile">
                    <b>{games.length}</b>
                    <span>오늘 경기</span>
                </div>
                {teamMode ? (
                    <div className="mh-tile">
                        <b><span className="w">{wins}</span><i>:</i><span className="l">{losses}</span></b>
                        <span>승 : 패{rankInfo && rankInfo.rate !== null ? ` · ${rankInfo.rate}%` : ''}</span>
                    </div>
                ) : (
                    <div className="mh-tile">
                        <b>{metCount}</b>
                        <span>함께 친 사람</span>
                    </div>
                )}
                <div className="mh-tile">
                    <b className="sm">{topMet ? (allPlayers?.[topMet[0]]?.name || '알수없음') : '-'}</b>
                    <span>{topMet ? `가장 자주 · ${topMet[1]}번` : '아직 없음'}</span>
                </div>
            </div>
            {teamMode && (
                <p className="mh-teamline">
                    {myTeam && <span style={{ color: TEAM_META[myTeam].textVar }}>{TEAM_META[myTeam].label}</span>}
                    {rankInfo && (
                        <>
                            {myTeam && <span className="sep">·</span>}
                            🏆 {rankInfo.teamRank ? `${myTeam ? TEAM_META[myTeam].label : '팀'} 내 ${rankInfo.teamRank}위 / ${rankInfo.teamCount}명` : '팀 미정'}
                            <span className="sep">·</span>
                            전체 {rankInfo.overallRank}위 / {rankInfo.overallCount}명
                        </>
                    )}
                </p>
            )}

            <div className="mh-list">
                {games.length === 0 && (
                    <p className="mh-empty">아직 오늘 경기 기록이 없어요.<br />곧 매칭에 뽑힐 거예요!</p>
                )}
                {games.map((game, i) => (
                    game.isManual ? (
                        <div key={i} className="mh-row manual">관리자 조정 기록</div>
                    ) : (
                        <div key={i} className="mh-row">
                            <div className="mh-row-head">
                                <span className="mh-no">{realGames.length - realGames.indexOf(game)}경기</span>
                                <span className="mh-time">{timeLabel(game.timestamp)}</span>
                                <ResultBadge game={game} />
                            </div>
                            {/* 내 편/상대를 나누지 않는다 — 파트너는 코트에서 선수들끼리 랜덤으로 정하므로 '같이 친 3명'만 */}
                            <div className="mh-row-body">
                                <div className="mh-line">
                                    <span className="k">같이</span>
                                    {[...(game.partners || []), ...(game.opponents || [])].filter(Boolean).length
                                        ? [...(game.partners || []), ...(game.opponents || [])].filter(Boolean).map((id) => <Person key={id} id={id} allPlayers={allPlayers} />)
                                        : <span className="none">-</span>}
                                </div>
                            </div>
                        </div>
                    )
                ))}
            </div>
        </ModalShell>
    );
}
