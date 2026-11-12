import React, { useEffect, useMemo, useState } from 'react';
import { getLevelColor, getTeamOf, getWinLoss, TEAM_BLUE, TEAM_WHITE, TEAM_META } from '../lib/helpers';
// (경기 4명은 내 편/상대를 나누지 않는다 — 파트너는 코트에서 선수들끼리 랜덤으로 정하므로)
import { getMyStatus, listUpcomingMatches, estimateSchedule, DEFAULT_GAME_MIN } from '../lib/myStatus';
import { restRemainingMin } from '../lib/rest';
import { CourtTimer } from './PlayerCard';

// ===================================================================================
// [선수 화면] 관리자가 아닌 선수가 보는 메인 화면 — "내 상태 · 내 다음 경기 · 오늘 내 기록"
// -----------------------------------------------------------------------------------
//  관리자 화면(Sections.jsx)은 그대로 두고, 선수에게는 이 화면을 보여준다.
//   · 맨 위 큰 카드: 지금 내가 어떤 상태인지(대기/예약/경기중/휴식), 다음 경기는 누구와, 몇 번 코트가
//     끝나면 시작하는지 — 선수가 자기 이름을 화면에서 뒤지지 않아도 된다
//   · 숫자 3개: 오늘 경기 · 기다린 시간 · 대기 인원
//   · 다음 경기 목록(자동 매칭 + 경기 예정) · 대기 명단 · 코트 현황 — 모두 조회 전용, 큰 글씨
//   · 조작은 둘뿐: 📋 내 기록, ☕ 휴식 / ▶ 복귀
//  글자 크기는 12.5px 이상 — 체육관에서 팔을 뻗어 보는 화면이다.
// ===================================================================================

const TICK_MS = 20 * 1000;

function nameOf(id, players, allPlayers) {
    if (!id) return null;
    return players?.[id]?.name || allPlayers?.[id]?.name || '나간 선수';
}

/** 이름 칩 — 급수 색 점 + 이름 (+ 나 표시). id 가 없으면 '빈 자리' */
function Name({ id, players, allPlayers, meId, teamMode = false, big = false }) {
    if (!id) return <span className={`ph-name empty ${big ? 'big' : ''}`}><i className="dot" />빈 자리</span>;
    const p = players?.[id] || allPlayers?.[id] || null;
    const gone = !players?.[id] || !!players[id].isResting;
    const isMe = id === meId;
    const color = p ? getLevelColor(p.level, p.isGuest) : '#8C93A1';
    const team = teamMode && p ? getTeamOf(p) : null;
    return (
        <span className={`ph-name ${isMe ? 'me' : ''} ${gone ? 'gone' : ''} ${big ? 'big' : ''} ${team ? `tm-${TEAM_META[team].key}` : ''}`} title={p ? `${p.name} ${p.level || ''}` : undefined}>
            <i className="dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} aria-hidden="true" />
            <span className="nm">{p?.name || '나간 선수'}</span>
            {p?.level && <small className="lv" style={{ color }}>{String(p.level).replace('조', '')}</small>}
            {isMe && <b className="me-tag">나</b>}
            {gone && !isMe && <small className="gone-tag">{players?.[id]?.isResting ? '휴식' : '나감'}</small>}
        </span>
    );
}

/**
 * 경기에 들어가는 4명 — 내 편/상대 구분 없이 한 묶음으로 보여준다.
 * (관리자가 4명을 넣고, 파트너는 코트에서 선수들끼리 랜덤으로 짜기 때문)
 * 나를 맨 앞에, 나머지는 칸 순서대로.
 */
function Four({ ids, me, players, allPlayers, teamMode, big = false, label = null }) {
    const ordered = [...ids.filter((id) => id === me.id), ...ids.filter((id) => id !== me.id)];
    return (
        <div className={`ph-four ${big ? 'big' : ''}`} aria-label="경기에 들어가는 4명">
            {label && <span className="ph-four-label">{label}</span>}
            <div className="ph-four-grid">
                {ordered.map((id, i) => <Name key={`${id || 'empty'}-${i}`} id={id} players={players} allPlayers={allPlayers} meId={me.id} teamMode={teamMode} big={big} />)}
            </div>
        </div>
    );
}

/** 맨 위 큰 카드 — 내 상태와 다음 경기 */
function Hero({ me, status, est, gameMin, players, allPlayers, teamMode, onOpenHistory, onToggleRest, now }) {
    const kind = status.kind;
    const restLeft = kind === 'resting' ? restRemainingMin(me, now) : null;
    // [대기 시간 예측] 코트 수·평균 경기 시간·경기중인 코트의 남은 시간·내 순번을 돌려 본 예상 시작 시각
    const eta = kind === 'queued' ? est?.byKey?.[`${status.queueType}:${status.queueIndex}`] : null;
    const etaMin = eta ? eta.waitMin : status.waitEstimateMin;
    const etaText = etaMin <= 0 ? '곧 시작' : `약 ${etaMin}분 뒤`;
    let kicker = '', pill = '', headline = '', sub = '', note = null, noteTone = 'info';

    if (kind === 'resting') {
        kicker = 'TAKING A BREAK';
        pill = '휴식 중';
        headline = '☕ 쉬는 중이에요';
        sub = restLeft === null ? '복귀를 누르면 다시 매칭에 들어가요' : restLeft <= 0 ? '곧 자동으로 복귀해요' : `${restLeft}분 뒤 자동으로 복귀해요`;
    } else if (kind === 'playing') {
        kicker = 'NOW PLAYING';
        pill = '경기 중';
        headline = `${status.courtIndex + 1}번 코트`;
        sub = status.elapsedMin < 1 ? '방금 시작했어요' : `경기 시작 ${status.elapsedMin}분째`;
    } else if (kind === 'queued') {
        kicker = 'NEXT GAME';
        pill = '다음 경기';
        // 선수에게는 자동/수동 구분이 의미 없다 — 전체 예정 경기에서 몇 번째인지(대기 순번)만 보여준다
        const where = status.queuePos ? `대기 ${status.queuePos}번째` : '다음 경기';
        if (status.brokenIds.length > 0) {
            headline = '잠시만요';
            sub = where;
            note = '⚠️ 함께 뽑힌 선수가 빠졌어요 · 관리자가 다시 짜 줄 거예요';
            noteTone = 'warn';
        } else if (status.missing > 0) {
            headline = '다음 경기 준비 중';
            sub = where;
            note = '👤 아직 빈 자리가 있어요 · 관리자가 채우면 시작해요';
        } else if (status.onCourtIds.length > 0) {
            const courts = status.waitCourts.map((c) => `${c + 1}번`).join('·');
            headline = `${courts} 코트 끝나면`;
            sub = `${where} · ${etaText}`;
            note = `⏳ 경기중인 선수: ${status.onCourtIds.map((id) => nameOf(id, players, allPlayers)).join(' · ')}`;
        } else if (status.canStartNow) {
            headline = '곧 시작해요!';
            sub = `${where} · 빈 코트가 있어요`;
            note = '🏸 관리자가 START를 누르면 코트 번호가 떠요';
            noteTone = 'good';
        } else {
            headline = etaMin <= 0 ? '곧 시작해요!' : `${etaText} 시작`;
            sub = `${where} · 앞 경기가 끝나고 코트가 비면`;
            note = `🏸 평균 ${gameMin}분 경기 기준 · 코트 ${est?.courtFreeAt?.length || 0}개로 계산`;
        }
    } else {
        kicker = 'WAITING';
        pill = '대기 중';
        headline = status.gamesToday === 0 ? '첫 경기 기다리는 중' : '다음 경기 기다리는 중';
        sub = status.waitMin < 1 ? '방금 들어왔어요' : `기다린 지 ${status.waitMin}분`;
        const nf = est?.nextFreeMin;
        note = nf === null || nf === undefined
            ? '👀 관리자가 매칭을 만들면 여기에 바로 떠요'
            : nf <= 0
                ? '👀 지금 빈 코트가 있어요 · 관리자가 매칭을 만들면 바로 들어가요'
                : `👀 다음 빈 코트까지 약 ${nf}분 · 관리자가 매칭을 만들면 여기에 떠요`;
    }

    const resting = kind === 'resting';
    return (
        <section className={`ph-hero ${kind}`} data-tut="my-next" aria-live="polite">
            <div className="ph-hero-top">
                <span className="ph-kicker">{kicker}</span>
                <span className={`ph-pill ${kind}`}><i aria-hidden="true" />{pill}</span>
            </div>
            <h2 className="ph-headline">{headline}</h2>
            <p className="ph-sub">{sub}</p>
            {(kind === 'playing' || kind === 'queued') && (
                <Four ids={status.ids || []} me={me} players={players} allPlayers={allPlayers} teamMode={teamMode} big label={kind === 'playing' ? '같이 치는 4명' : '같이 들어갈 4명'} />
            )}
            {note && <p className={`ph-note ${noteTone}`}>{note}</p>}
            <div className="ph-actions">
                <button type="button" className="ph-btn primary" onClick={onOpenHistory} data-tut="my-history">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M9 3.5v2h6v-2M8.5 10h7M8.5 14h7M8.5 18h4" /></svg>
                    내 기록
                </button>
                <button type="button" className={`ph-btn ${resting ? 'accent' : 'ghost'}`} onClick={onToggleRest} aria-pressed={resting}>
                    {resting ? '▶ 복귀하기' : '☕ 휴식'}
                </button>
            </div>
        </section>
    );
}

/** 숫자 3개 — 오늘 경기 · 기다린 시간(또는 경기 시간) · 대기 인원 (청백전: 승패) */
function Stats({ status, me, waitingCount, teamMode }) {
    const { wins, losses } = getWinLoss(me);
    let midLabel = '기다린 지', midValue = `${status.waitMin}분`, midTone = status.waitMin >= 15 ? 'coral' : '';
    if (status.kind === 'playing') { midLabel = '경기 시간'; midValue = `${status.elapsedMin}분`; midTone = ''; }
    if (status.kind === 'resting') { midLabel = '상태'; midValue = '휴식'; midTone = ''; }
    return (
        <div className="cox-statbar ph-stats" aria-label="오늘 내 숫자">
            <div className="cox-stat"><div className="v volt">{status.gamesToday}</div><div className="k">오늘 경기</div></div>
            <div className="cox-stat"><div className={`v ${midTone}`}>{midValue}</div><div className="k">{midLabel}</div></div>
            {teamMode
                ? <div className="cox-stat"><div className="v"><span className="ph-w">{wins}</span><span className="ph-sep">:</span><span className="ph-l">{losses}</span></div><div className="k">승 : 패</div></div>
                : <div className="cox-stat"><div className="v">{waitingCount}</div><div className="k">대기 인원</div></div>}
        </div>
    );
}

/** 다음 경기 목록 (자동 매칭 + 경기 예정) */
function Upcoming({ rows, est, me, players, allPlayers, teamMode }) {
    return (
        <section className="ph-section" data-tut="auto">
            <div className="cox-secline mb-2">
                <div className="lbl green"><span className="tick" /><span role="heading" aria-level="2">다음 경기</span><span className="count">{rows.length}</span></div>
            </div>
            {rows.length === 0 && (
                <p className="ph-empty">아직 만들어진 다음 경기가 없어요.<br />관리자가 매칭을 만들면 여기에 순서대로 떠요.</p>
            )}
            <div className="ph-list">
                {rows.map((r, pos) => {
                    const mine = r.ids.includes(me.id);
                    const eta = est?.byKey?.[`${r.type}:${r.index}`];
                    const etaMin = eta ? eta.waitMin : null;
                    let chip = null;
                    if (r.brokenIds.length > 0) chip = <span className="ph-chip-state warn">⚠️ 선수 빠짐</span>;
                    else if (r.missing > 0) chip = <span className="ph-chip-state">👤 자리 {r.missing}칸 비었음</span>;
                    else if (r.onCourtIds.length > 0) chip = <span className="ph-chip-state wait">⏳ {r.waitCourts.map((c) => `${c + 1}번`).join('·')} 코트 끝나면{etaMin !== null && etaMin > 0 ? ` · 약 ${etaMin}분` : ''}</span>;
                    else if (etaMin !== null && etaMin > 0) chip = <span className="ph-chip-state wait">⏳ 약 {etaMin}분 뒤</span>;
                    else chip = <span className="ph-chip-state good">✅ 코트 비면 시작</span>;
                    return (
                        <div key={`${r.type}-${r.index}`} className={`ph-match ${mine ? 'mine' : ''}`}>
                            <div className="ph-match-no" aria-label={`대기 ${pos + 1}번째`}>
                                <b>{pos + 1}</b>
                                <small>번째</small>
                            </div>
                            <div className="ph-match-body">
                                <Four ids={r.ids} me={me} players={players} allPlayers={allPlayers} teamMode={teamMode} />
                                <div className="ph-match-foot">
                                    {chip}
                                    {mine && <span className="ph-mine-tag">내 경기</span>}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

/** 대기 명단 — 칩 형태, 남/여(청백전: 청/백)로 묶음 */
function Waiting({ maleWaitingPlayers, femaleWaitingPlayers, me, onlineIds, teamMode }) {
    const groups = useMemo(() => {
        if (teamMode) {
            const all = [...maleWaitingPlayers, ...femaleWaitingPlayers];
            const by = { [TEAM_BLUE]: [], [TEAM_WHITE]: [], none: [] };
            all.forEach((p) => { by[getTeamOf(p) || 'none'].push(p); });
            const list = [
                { key: 'blue', label: TEAM_META[TEAM_BLUE].label, color: TEAM_META[TEAM_BLUE].color, players: by[TEAM_BLUE] },
                { key: 'white', label: TEAM_META[TEAM_WHITE].label, color: TEAM_META[TEAM_WHITE].color, players: by[TEAM_WHITE] },
            ];
            if (by.none.length > 0) list.push({ key: 'none', label: '팀 미정', color: '#FB923C', players: by.none });
            return list;
        }
        return [
            { key: 'male', label: '남자', color: '#3B82F6', players: maleWaitingPlayers },
            { key: 'female', label: '여자', color: '#EC4899', players: femaleWaitingPlayers },
        ];
    }, [maleWaitingPlayers, femaleWaitingPlayers, teamMode]);
    const total = maleWaitingPlayers.length + femaleWaitingPlayers.length;
    return (
        <section className="ph-section" data-tut="waiting">
            <div className="cox-secline mb-2">
                <div className="lbl"><span className="tick" /><span role="heading" aria-level="2">대기 명단</span><span className="count">{total}</span></div>
            </div>
            {total === 0 && <p className="ph-empty">지금 대기 중인 선수가 없어요.</p>}
            {groups.map((g) => g.players.length > 0 && (
                <div key={g.key} className="ph-group">
                    <div className="ph-group-head"><i style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} aria-hidden="true" />{g.label}<span>{g.players.length}</span></div>
                    <div className="ph-chips">
                        {g.players.map((p) => {
                            const color = getLevelColor(p.level, p.isGuest);
                            const isMe = p.id === me.id;
                            const games = p.todayRecentGames ? p.todayRecentGames.length : 0;
                            return (
                                <span key={p.id} id={isMe ? 'my-player-card' : undefined} className={`ph-chip ${isMe ? 'me' : ''} ${p.isResting ? 'resting' : ''}`} aria-label={`${p.name} ${(p.level || '').replace('조', '')}조 ${games}경기${p.isResting ? ' 휴식 중' : ''}${isMe ? ' (나)' : ''}`}>
                                    <i className="dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} aria-hidden="true" />
                                    {onlineIds?.has(p.id) && !p.isResting && <i className="on" aria-hidden="true" />}
                                    <span className="nm">{p.name}</span>
                                    <small className="lv" style={{ color }}>{(p.level || '').replace('조', '')}</small>
                                    <small className="g">{games}G</small>
                                    {p.isResting && <small className="rest">☕</small>}
                                </span>
                            );
                        })}
                    </div>
                </div>
            ))}
        </section>
    );
}

/** 코트 현황 — 2열 타일 */
function Courts({ gameState, me, players, allPlayers, teamMode }) {
    const n = gameState?.numInProgressCourts || 0;
    const courts = gameState?.inProgressCourts || [];
    return (
        <section className="ph-section" data-tut="courts">
            <div className="cox-secline mb-2">
                <div className="lbl coral"><span className="tick" /><span role="heading" aria-level="2">코트 현황</span><span className="count">{courts.filter(Boolean).length}/{n}</span></div>
            </div>
            <div className="ph-courts">
                {Array.from({ length: n }).map((_, i) => {
                    const c = courts[i];
                    const ids = c?.players || [];
                    const mine = ids.includes(me.id);
                    return (
                        <div key={i} className={`ph-court ${c ? '' : 'empty'} ${mine ? 'mine' : ''}`} aria-label={`${i + 1}번 코트${c ? '' : ' 비어 있음'}${mine ? ' (내 경기)' : ''}`}>
                            <div className="ph-court-head">
                                <span className="ph-court-no"><b>{i + 1}</b><small>코트</small></span>
                                {c ? <span className="ph-court-timer"><CourtTimer court={c} /></span> : <span className="ph-court-free">빈 코트</span>}
                                {mine && <span className="ph-mine-tag">나</span>}
                            </div>
                            {c ? (
                                <div className="ph-court-body">
                                    {[0, 1, 2, 3].map((k) => <Name key={`${ids[k] || 'e'}-${k}`} id={ids[k] || null} players={players} allPlayers={allPlayers} meId={me.id} teamMode={teamMode} />)}
                                </div>
                            ) : (
                                <div className="ph-court-body empty"><span>비어 있어요</span></div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

export function PlayerHome({
    me, gameState, activePlayers, allPlayers, maleWaitingPlayers, femaleWaitingPlayers,
    onlineIds, teamMode = false, isMobile, activeTab, onOpenHistory, onToggleRest, gameMin = DEFAULT_GAME_MIN,
}) {
    // 20초마다 '지금'을 갱신 — 기다린 분, 경기 몇 분째, 휴식 남은 분이 저절로 흐른다
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
    }, []);

    const rows = useMemo(() => listUpcomingMatches(gameState, activePlayers), [gameState, activePlayers]);
    const status = useMemo(() => {
        const s = getMyStatus({ me, gameState, activePlayers, now });
        if (s.kind === 'queued') {
            // 자동/수동을 합친 전체 예정 경기에서 내 경기가 몇 번째인지 (선수가 보는 '대기 순번')
            const i = rows.findIndex((r) => r.type === s.queueType && r.index === s.queueIndex);
            s.queuePos = i >= 0 ? i + 1 : null;
        }
        return s;
    }, [me, gameState, activePlayers, now, rows]);
    const est = useMemo(() => estimateSchedule({ gameState, activePlayers, now, gameMin }), [gameState, activePlayers, now, gameMin]);
    const waitingCount = maleWaitingPlayers.length + femaleWaitingPlayers.length;

    const home = (
        <>
            <Hero me={me} status={status} est={est} gameMin={gameMin} players={activePlayers} allPlayers={allPlayers} teamMode={teamMode} onOpenHistory={onOpenHistory} onToggleRest={onToggleRest} now={now} />
            <Stats status={status} me={me} waitingCount={waitingCount} teamMode={teamMode} />
            <Upcoming rows={rows} est={est} me={me} players={activePlayers} allPlayers={allPlayers} teamMode={teamMode} />
            <Waiting maleWaitingPlayers={maleWaitingPlayers} femaleWaitingPlayers={femaleWaitingPlayers} me={me} onlineIds={onlineIds} teamMode={teamMode} />
        </>
    );
    const board = <Courts gameState={gameState} me={me} players={activePlayers} allPlayers={allPlayers} teamMode={teamMode} />;

    if (isMobile) {
        return (
            <div className="ph-wrap">
                {activeTab === 'inProgress'
                    ? <div key="ph-board" className="ph-col tab-fade-in">{board}</div>
                    : <div key="ph-home" className="ph-col tab-fade-in">{home}</div>}
            </div>
        );
    }
    return (
        <div className="ph-wrap">
            <div className="ph-col">{home}{board}</div>
        </div>
    );
}
