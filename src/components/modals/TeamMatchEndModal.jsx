import React, { useState } from 'react';
import { ModalShell } from './ModalShell';
import { getTeamOf, TEAM_BLUE, TEAM_WHITE, TEAM_META } from '../../lib/helpers';

// ===================================================================================
// [청백전] 경기 종료 — 이긴 팀 고르기
//  · 청2 vs 백2 인 정상 경기: '청팀 승리' / '백팀 승리' 큰 버튼 → 그 팀 점수 +1
//  · 팀이 섞인 경기: 'A쪽 승리' / 'B쪽 승리' 로 선수 승패만 기록 (팀 점수는 오르지 않는다고 미리 안내)
//  · 아래 작은 글씨 '경기 취소' → 기록 없이 코트만 비운다
// ===================================================================================
export function TeamMatchEndModal({ courtIndex, court, allPlayers, onPickWinner, onCancelMatch, onClose }) {
    const [busy, setBusy] = useState(false);
    const ids = court?.players || [];
    const sideA = [ids[0], ids[1]].filter(Boolean);
    const sideB = [ids[2], ids[3]].filter(Boolean);
    const teamOfSide = (side) => {
        const teams = [...new Set(side.map((id) => getTeamOf(allPlayers[id])))];
        return teams.length === 1 && teams[0] ? teams[0] : null;
    };
    const teamA = teamOfSide(sideA);
    const teamB = teamOfSide(sideB);
    const isProper = teamA && teamB && teamA !== teamB;
    const nameOf = (id) => allPlayers[id]?.name || '나간 선수';
    const levelOf = (id) => (allPlayers[id]?.level || '').replace('조', '');

    const pick = async (side) => {
        if (busy) return;
        setBusy(true);
        try { await onPickWinner(side); } finally { setBusy(false); }
    };

    const SideBox = ({ label, side, team }) => (
        <div className={`tm-end-side ${team ? TEAM_META[team].key : 'mixed'}`}>
            <div className="t">{team ? TEAM_META[team].label : `${label}쪽 (팀 섞임)`}</div>
            {side.length === 0 && <div className="p" style={{ color: '#8C93A1' }}>빈 자리</div>}
            {side.map((id) => (
                <div key={id} className="p">
                    {!team && <span style={{ color: getTeamOf(allPlayers[id]) ? TEAM_META[getTeamOf(allPlayers[id])].text : '#8C93A1' }}>{getTeamOf(allPlayers[id]) || '?'} </span>}
                    {nameOf(id)}<small>{levelOf(id)}</small>
                </div>
            ))}
        </div>
    );

    const winBtn = (side, team, label) => (
        <button type="button" disabled={busy} onClick={() => pick(side)} className={`tm-win-btn ${team ? TEAM_META[team].key : 'side'}`} aria-label={team ? `${TEAM_META[team].label} 승리로 기록` : `${label}쪽 승리로 기록`}>
            <span className="big">{team ? `${TEAM_META[team].label} 승리` : `${label}쪽 승리`}</span>
            <span className="sm">{team ? `${TEAM_META[team].short}팀 점수 +1` : '선수 승패만 기록'}</span>
        </button>
    );

    return (
        <ModalShell
            title={`🏁 ${courtIndex + 1}번 코트 경기 종료`}
            titleClass="display accent"
            subtitle="이긴 팀을 골라주세요. 선수 승패와 팀 점수가 함께 기록됩니다."
            onClose={busy ? undefined : onClose}
            zIndex={80}
        >
            <div className="tm-end-sides mb-4">
                <SideBox label="A" side={sideA} team={teamA} />
                <div className="tm-end-vs">VS</div>
                <SideBox label="B" side={sideB} team={teamB} />
            </div>

            {!isProper && (
                <div className="cox-box warn text-[11px] text-center mb-3 leading-relaxed">
                    청 vs 백 경기가 아니라서 <b>팀 점수는 오르지 않아요.</b><br />이긴 쪽 선수에게 승, 진 쪽에 패만 기록됩니다.
                </div>
            )}

            <div className="grid grid-cols-2 gap-2">
                {isProper ? (
                    <>
                        {teamA === TEAM_BLUE ? winBtn('A', TEAM_BLUE, 'A') : winBtn('B', TEAM_BLUE, 'B')}
                        {teamA === TEAM_WHITE ? winBtn('A', TEAM_WHITE, 'A') : winBtn('B', TEAM_WHITE, 'B')}
                    </>
                ) : (
                    <>
                        {winBtn('A', null, 'A')}
                        {winBtn('B', null, 'B')}
                    </>
                )}
            </div>

            <button type="button" className="tm-cancel-link" disabled={busy} onClick={onCancelMatch}>
                경기 취소 (기록 없이 코트만 비우기)
            </button>
        </ModalShell>
    );
}
