import React, { useEffect, useState } from 'react';
import { ModalShell } from './ModalShell';
import { TEAM_BLUE, TEAM_WHITE, TEAM_META } from '../../lib/helpers';

/** [청백전] 점수판 수정 — 점수판을 길게 눌렀을 때 (관리자) */
export function TeamScoreEditModal({ teamScores, onSave, onClose }) {
    const [blue, setBlue] = useState(Math.max(0, Number(teamScores?.blue) || 0));
    const [white, setWhite] = useState(Math.max(0, Number(teamScores?.white) || 0));
    const [busy, setBusy] = useState(false);
    const [touched, setTouched] = useState(false);
    // 다른 관리자가 그 사이 점수를 올렸으면 화면의 초기값도 따라간다 (아직 손대기 전일 때만)
    useEffect(() => {
        if (touched) return;
        setBlue(Math.max(0, Number(teamScores?.blue) || 0));
        setWhite(Math.max(0, Number(teamScores?.white) || 0));
    }, [teamScores, touched]);

    const clamp = (v) => Math.max(0, Math.min(999, Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0));
    const renderCell = (team, value, setValue) => (
        <div className={`tm-edit-cell ${TEAM_META[team].key}`}>
            <div className="t">{TEAM_META[team].label}</div>
            <div className="ctr">
                <button type="button" onClick={() => { setTouched(true); setValue((v) => clamp(v - 1)); }} aria-label={`${TEAM_META[team].label} 1점 빼기`}>−</button>
                <input
                    type="number" inputMode="numeric" min="0" max="999" value={value}
                    aria-label={`${TEAM_META[team].label} 점수`}
                    onChange={(e) => { setTouched(true); setValue(clamp(e.target.value)); }}
                    onFocus={(e) => e.target.select()}
                />
                <button type="button" onClick={() => { setTouched(true); setValue((v) => clamp(v + 1)); }} aria-label={`${TEAM_META[team].label} 1점 더하기`}>+</button>
            </div>
        </div>
    );

    const save = async () => {
        if (busy) return;
        setBusy(true);
        try { await onSave({ blue: clamp(blue), white: clamp(white) }); } finally { setBusy(false); }
    };

    return (
        <ModalShell
            title="⚔️ 점수판 수정"
            titleClass="display accent"
            subtitle="잘못 올라간 점수를 바로잡습니다. 선수 개인 승패는 바뀌지 않아요."
            onClose={busy ? undefined : onClose}
            zIndex={80}
            footer={(
                <>
                    <button type="button" onClick={() => { setTouched(true); setBlue(0); setWhite(0); }} disabled={busy} className="cox-btn ghost sm" style={{ flex: '0 0 auto' }}>0 : 0</button>
                    <button type="button" onClick={onClose} disabled={busy} className="cox-btn ghost">취소</button>
                    <button type="button" onClick={save} disabled={busy} className="cox-btn primary">{busy ? '저장 중...' : '저장'}</button>
                </>
            )}
        >
            <div className="tm-edit-row">
                {renderCell(TEAM_BLUE, blue, setBlue)}
                {renderCell(TEAM_WHITE, white, setWhite)}
            </div>
        </ModalShell>
    );
}
