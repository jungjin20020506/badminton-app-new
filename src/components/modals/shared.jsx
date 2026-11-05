import React from 'react';

/** [청백전] 경기 기록 한 건의 승/패 배지 (승패가 없는 일반 모드 기록은 아무것도 안 보인다) */
export function ResultBadge({ game }) {
    if (!game || !game.result) return null;
    if (game.result === 'win') return <span className="tm-result-badge win">승</span>;
    if (game.result === 'loss') return <span className="tm-result-badge loss">패</span>;
    return <span className="tm-result-badge none">무</span>;
}
