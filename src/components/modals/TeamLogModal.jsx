import React from 'react';
import { ModalShell } from './ModalShell';
import { TEAM_BLUE, TEAM_WHITE, TEAM_META } from '../../lib/helpers';

/** [청백전] 득점 기록 — 점수판을 짧게 탭했을 때 (누구나) */
export function TeamLogModal({ log, teamScores, allPlayers, onClose }) {
    const entries = Array.isArray(log) ? log : [];
    const nameOf = (id) => allPlayers?.[id]?.name || '나간 선수';
    const timeOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    return (
        <ModalShell
            title="📜 오늘 득점 기록"
            titleClass="display accent"
            subtitle={(
                <span className="font-black text-sm">
                    <span style={{ color: TEAM_META[TEAM_BLUE].text }}>청 {teamScores?.blue ?? 0}</span>
                    <span className="text-gray-500 mx-2">:</span>
                    <span style={{ color: TEAM_META[TEAM_WHITE].text }}>백 {teamScores?.white ?? 0}</span>
                </span>
            )}
            onClose={onClose}
            zIndex={70}
            footer={<button type="button" className="cox-btn primary" onClick={onClose}>확인</button>}
        >
            <div className="space-y-1.5">
                {entries.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-6">아직 기록된 경기가 없어요.<br />경기가 끝나면 여기에 쌓입니다.</p>
                )}
                {entries.map((e, i) => {
                    const meta = e.winnerTeam ? TEAM_META[e.winnerTeam] : null;
                    return (
                        <div key={`${e.at}-${i}`} className={`tm-log-row ${meta ? meta.key : 'none'}`}>
                            <div className="tm-log-head">
                                <span className="who">{meta ? `${e.winnerTeam === TEAM_BLUE ? '🔵' : '⚪'} ${meta.label} 득점` : '🏁 승패만 기록'}</span>
                                <span className="when">{timeOf(e.at)} · {(e.courtIndex ?? 0) + 1}번 코트</span>
                            </div>
                            <div className="tm-log-body">
                                <b>{(e.winners || []).map(nameOf).join('·') || '-'}</b>
                                <span className="vs">승</span>
                                <span className="lose">{(e.losers || []).map(nameOf).join('·') || '-'}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </ModalShell>
    );
}
