import React, { useState } from 'react';
import { TEAM_BLUE, TEAM_WHITE, TEAM_META, getLevelColor } from '../lib/helpers';

// ===================================================================================
// [청백전] 🏆 오늘의 순위 — 점수판 바로 아래, 항상 보인다.
// -----------------------------------------------------------------------------------
//  · [전체 | 청팀 | 백팀] 세그먼트로 전환. 승률순(같으면 승수↓·패수↑).
//  · 기본은 상위 5명만, '전체 보기'를 누르면 모두 펼친다.
//  · 내 줄은 주황 테두리로 강조. 경기 0인 선수는 맨 아래(승률 '-').
// ===================================================================================
const VIEWS = [
    { key: 'all', label: '전체' },
    { key: 'blue', label: '청팀' },
    { key: 'white', label: '백팀' },
];
const COLLAPSED_ROWS = 5;

const OPEN_KEY = 'cox-rank-open';
const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };

const TeamRankingSection = React.memo(({ rankings, currentUserId, aceIds }) => {
    // 패널 전체 접기/펼치기 (기본 접힘 · 기기별로 기억)
    const [open, setOpen] = useState(readOpen);
    const [view, setView] = useState('all');
    const [expanded, setExpanded] = useState(false);
    const toggleOpen = () => {
        setOpen(o => {
            const next = !o;
            try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* 무시 */ }
            if (!next) setExpanded(false); // 접으면 '전체 보기'도 초기화
            return next;
        });
    };
    const list = rankings?.[view] || [];
    const shown = expanded ? list : list.slice(0, COLLAPSED_ROWS);
    const played = (rankings?.all || []).filter(r => r.games > 0).length;
    const me = currentUserId ? (rankings?.all || []).find(r => r.id === currentUserId) : null;

    return (
        <section className={`tm-rank ${open ? 'open' : 'closed'}`} data-tut="team-rank">
            <button type="button" className="tm-rank-head" onClick={toggleOpen} aria-expanded={open}>
                <div className="lbl">
                    <span className="tick"></span>
                    <span>🏆 오늘의 순위</span>
                    <span className="count">{played}명 경기</span>
                </div>
                <div className="tm-rank-right">
                    {!open && me && me.games > 0 && <span className="tm-rank-me">내 순위 {me.rank}위</span>}
                    <span className="chev">{open ? '접기 ▲' : '펼치기 ▼'}</span>
                </div>
            </button>

            {open && (
                <div className="tm-rank-body">
                    <div className="tm-rank-seg" role="tablist">
                        {VIEWS.map(v => (
                            <button
                                key={v.key} type="button" role="tab" aria-selected={view === v.key}
                                className={`seg ${v.key} ${view === v.key ? 'on' : ''}`}
                                onClick={() => setView(v.key)}
                            >{v.label}</button>
                        ))}
                    </div>

                    {list.length === 0 ? (
                        <p className="tm-rank-empty">아직 순위에 올릴 선수가 없어요.</p>
                    ) : (
                        <ol className="tm-rank-list">
                            {shown.map(r => {
                                const meta = r.team ? TEAM_META[r.team] : null;
                                const isMe = r.id === currentUserId;
                                const top = r.rank <= 3 && r.games > 0;
                                return (
                                    <li key={r.id} className={`tm-rank-row ${isMe ? 'me' : ''} ${top ? `top${r.rank}` : ''} ${r.games === 0 ? 'idle' : ''}`}>
                                        <span className="rk">{r.games === 0 ? '·' : r.rank}</span>
                                        <span className="dot" style={{ background: meta ? meta.color : '#565D6B' }} title={meta ? meta.label : '팀 미정'}></span>
                                        <span className="nm">
                                            {aceIds?.has(r.id) && <span className="ace" title="팀 에이스">⭐</span>}
                                            {r.name}
                                            <small style={{ color: getLevelColor(r.level, false) }}>{(r.level || '').replace('조', '')}</small>
                                        </span>
                                        <span className="wl"><b className="w">{r.wins}승</b> <b className="l">{r.losses}패</b></span>
                                        <span className="rt">{r.rate === null ? '-' : `${r.rate}%`}</span>
                                    </li>
                                );
                            })}
                        </ol>
                    )}

                    {list.length > COLLAPSED_ROWS && (
                        <button type="button" className="tm-rank-more" onClick={() => setExpanded(e => !e)}>
                            {expanded ? '접기 ▲' : `전체 보기 (${list.length}명) ▼`}
                        </button>
                    )}
                </div>
            )}
        </section>
    );
});

export { TeamRankingSection };
