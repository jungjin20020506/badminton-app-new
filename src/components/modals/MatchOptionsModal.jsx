import React, { useState } from 'react';
import { ModalShell } from './ModalShell';
import { getLevelColor, TEAM_BLUE, TEAM_WHITE } from '../../lib/helpers';

// ===================================================================================
// [자동 매칭 v2] 매칭 선택지 모달 — 베스트 2 / 보통 2 / 아쉬움 2 = 총 6개 후보를
// 이유와 함께 보여주고 관리자가 고른다. 고유 디자인(.mo-*)을 쓰므로 ModalShell 은 bare.
//  · 각 후보에 "왜 이 등급인지"를 이름과 숫자가 들어간 문장으로 설명
//  · 경기중인 선수는 무채색 + '경기중' 딱지 + 몇 번 코트를 기다려야 하는지 명시
//  · 지금 상황에서 좋은 조합이 없으면 맨 위에 솔직하게 안내
// ===================================================================================

/** 선택지 안에 들어가는 작은 선수 칩 */
function OptionPlayerChip({ player }) {
    const levelColor = getLevelColor(player.level, player.isGuest);
    return (
        <div className={`mo-chip ${player.onCourt ? 'playing' : ''} ${player.team === TEAM_BLUE ? 'tm-blue' : player.team === TEAM_WHITE ? 'tm-white' : ''}`}>
            <div className="mo-chip-name">{player.name}</div>
            <div className="mo-chip-sub">
                <span style={{ color: player.onCourt ? '#9aa0aa' : levelColor }}>{player.level.replace('조', '')}</span>
                <span className="mo-chip-games">{player.realGames}G</span>
            </div>
            {player.onCourt && <span className="mo-chip-tag">경기중</span>}
        </div>
    );
}

/**
 * [비교 뱃지] 모든 후보 카드에 같은 순서·같은 자리로 붙는 4개 지표.
 * 세로로 훑으면 "겹침 0쌍인 건 어느 거지?"가 한눈에 보인다. (이유 문장은 그 아래 그대로)
 */
function OptionMetrics({ facts }) {
    const overlapTone = facts.lastGamePairs.length > 0 || facts.metPairs.length >= 3 ? 'bad'
        : facts.metPairs.length === 0 ? 'good' : 'mid';
    const waitTone = facts.maxWaitMin >= 15 ? 'good' : 'mid';
    const spreadTone = facts.levelSpread >= 3 ? 'bad' : facts.levelSpread === 2 ? 'mid' : 'good';
    const gamesTone = facts.allSameGames ? 'good' : (facts.gamesMax - facts.gamesMin > 2 ? 'bad' : 'mid');
    const gamesText = facts.allSameGames ? `${facts.gamesMin}` : `${facts.gamesMin}~${facts.gamesMax}`;
    return (
        <div className="mo-metrics" aria-label="후보 비교 지표">
            <span className={`mo-metric ${overlapTone}`}><i>겹침</i><b>{facts.metPairs.length}쌍</b></span>
            <span className={`mo-metric ${waitTone}`}><i>대기</i><b>{facts.maxWaitMin}분</b></span>
            <span className={`mo-metric ${spreadTone}`}><i>급수폭</i><b>{facts.levelSpread}</b></span>
            <span className={`mo-metric ${gamesTone}`}><i>경기</i><b>{gamesText}</b></span>
        </div>
    );
}

export function MatchOptionsModal({ genderLabel, result, queueCount, onSelect, onRegenerate, onCancel }) {
    const [pageIndex, setPageIndex] = useState(0);
    const [busy, setBusy] = useState(false);
    const pages = result?.pages || [];
    const options = pages[pageIndex] || [];
    const hasMorePages = pages.length > 1;

    const handlePick = async (option) => {
        if (busy) return;
        setBusy(true);
        try { await onSelect(option); } finally { setBusy(false); }
    };

    return (
        <ModalShell bare sheet zIndex={70} onClose={busy ? undefined : onCancel} labelledBy="mo-title">
            <div className="mo-sheet modal-content">
                <div className="mo-head">
                    <div className="min-w-0">
                        <h3 id="mo-title" className="mo-title">{genderLabel} 매칭 고르기</h3>
                        <p className="mo-sub">
                            후보 {result.poolSize}명 · 대기 {result.waitingCount}명 · 경기중 {result.onCourtCount}명
                            {queueCount > 0 && <> · 목록에 {queueCount}경기 대기</>}
                        </p>
                    </div>
                    <button type="button" onClick={onCancel} className="mo-close" aria-label="닫기">&times;</button>
                </div>

                {result.qualityHint && <div className="mo-hint">💡 {result.qualityHint}</div>}
                <p className="mo-legend">겹침은 적을수록 · 대기는 길수록 · 급수폭은 작을수록 좋아요</p>

                <div className="mo-list" role="list">
                    {options.map((option, i) => (
                        <button
                            key={`${option.ids.join('-')}-${i}`}
                            type="button"
                            role="listitem"
                            className={`mo-card ${option.tier}`}
                            onClick={() => handlePick(option)}
                            disabled={busy}
                            aria-label={`${option.tierLabel} 조합: ${option.players.map((p) => p.name).join(', ')}`}
                        >
                            <div className="mo-card-head">
                                <span className="mo-tier">{option.tierEmoji} {option.tierLabel}</span>
                                {option.onCourtIds.length > 0 && (
                                    <span className="mo-wait-chip">⏳ {option.waitCourts.map((c) => `${c + 1}번`).join('·')} 코트 대기</span>
                                )}
                            </div>
                            <OptionMetrics facts={option.facts} />
                            <div className="mo-teams">
                                <div className="mo-team">
                                    <OptionPlayerChip player={option.players[0]} />
                                    <OptionPlayerChip player={option.players[1]} />
                                </div>
                                <div className="mo-vs">VS</div>
                                <div className="mo-team">
                                    <OptionPlayerChip player={option.players[2]} />
                                    <OptionPlayerChip player={option.players[3]} />
                                </div>
                            </div>
                            <ul className="mo-reasons">
                                {option.reasons.map((line, k) => <li key={k} className={`tone-${line.tone}`}>{line.text}</li>)}
                            </ul>
                        </button>
                    ))}
                </div>

                <div className="mo-foot">
                    {hasMorePages && (
                        <button type="button" className="mo-btn ghost" disabled={busy} onClick={() => setPageIndex((i) => (i + 1) % pages.length)}>
                            🔀 다른 조합 ({pageIndex + 1}/{pages.length})
                        </button>
                    )}
                    <button type="button" className="mo-btn ghost" disabled={busy} onClick={onRegenerate}>🔄 다시 계산</button>
                    <button type="button" className="mo-btn cancel" disabled={busy} onClick={onCancel}>닫기</button>
                </div>
            </div>
        </ModalShell>
    );
}
