import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TEAM_BLUE, TEAM_WHITE, TEAM_META } from '../lib/helpers';

// ===================================================================================
// [청백전] 팀 점수판 — 메인 화면 맨 위에 항상 보인다.
// -----------------------------------------------------------------------------------
//  · 점수가 바뀌면 숫자가 '팡' 튀는 연출 (모든 접속자 화면에서 동일)
//  · 관리자가 길게 누르면(800ms) 점수 수정 모달이 열린다 (onLongPress)
//  · 아래 얇은 바는 두 팀의 점수 비율 — 한눈에 누가 앞서는지
// ===================================================================================
const TeamScoreBoard = React.memo(({ teamScores, blueCount = 0, whiteCount = 0, isAdmin = false, onLongPress }) => {
    const blue = Math.max(0, Number(teamScores?.blue) || 0);
    const white = Math.max(0, Number(teamScores?.white) || 0);
    const total = blue + white;
    const bluePct = total === 0 ? 50 : Math.round((blue / total) * 100);
    const lead = blue === white ? null : (blue > white ? TEAM_BLUE : TEAM_WHITE);
    const diff = Math.abs(blue - white);

    // 점수가 오른 쪽만 팡 튀기
    const prevRef = useRef({ blue, white });
    const [pop, setPop] = useState({ blue: false, white: false });
    useEffect(() => {
        const prev = prevRef.current;
        const next = { blue: blue !== prev.blue, white: white !== prev.white };
        prevRef.current = { blue, white };
        if (next.blue || next.white) {
            setPop(next);
            const t = setTimeout(() => setPop({ blue: false, white: false }), 520);
            return () => clearTimeout(t);
        }
    }, [blue, white]);

    // 길게 누르기 (관리자만) — 카드/코트 번호와 같은 손맛(800ms)
    const timerRef = useRef(null);
    const firedRef = useRef(false);
    const start = useCallback(() => {
        if (!isAdmin || !onLongPress) return;
        firedRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { firedRef.current = true; onLongPress(); }, 800);
    }, [isAdmin, onLongPress]);
    const end = useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    }, []);
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    return (
        <div
            className={`tm-board ${isAdmin ? 'admin' : ''}`}
            data-tut="team-board"
            onMouseDown={start} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchEnd={end} onTouchCancel={end}
            onContextMenu={(e) => e.preventDefault()}
            role={isAdmin ? 'button' : undefined}
            aria-label={`청팀 ${blue}점, 백팀 ${white}점`}
        >
            <div className={`tm-side blue ${lead === TEAM_BLUE ? 'lead' : ''}`}>
                <div className="nm"><span className="dot"></span>{TEAM_META[TEAM_BLUE].label}</div>
                <div className={`sc ${pop.blue ? 'pop' : ''}`}>{blue}</div>
                <div className="sub">{blueCount}명</div>
            </div>
            <div className="tm-center">
                <div className="title">⚔️ 청백전</div>
                <div className="vs">VS</div>
                <div className={`lead-tag ${lead ? TEAM_META[lead].key : ''}`}>
                    {lead ? `${TEAM_META[lead].short} +${diff}` : (total === 0 ? '경기 전' : '동점')}
                </div>
            </div>
            <div className={`tm-side white ${lead === TEAM_WHITE ? 'lead' : ''}`}>
                <div className="nm"><span className="dot"></span>{TEAM_META[TEAM_WHITE].label}</div>
                <div className={`sc ${pop.white ? 'pop' : ''}`}>{white}</div>
                <div className="sub">{whiteCount}명</div>
            </div>
            <div className="tm-bar" aria-hidden="true">
                <div className="b" style={{ width: `${bluePct}%` }}></div>
                <div className="w"></div>
            </div>
            {isAdmin && <div className="hint">길게 누르면 점수 수정</div>}
        </div>
    );
});

export { TeamScoreBoard };
