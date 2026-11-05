import React, { useState } from 'react';
import { ModalShell } from './ModalShell';
import { TIMING } from '../../lib/constants';

// ===================================================================================
// [휴식 타이머] "몇 분 쉴까요?" — +/- 로 시간을 고르고, 지나면 자동으로 복귀한다
//  · 기본 10분, 5분 단위, 5~60분. '시간 정하지 않고 쉬기'도 가능 (직접 복귀 버튼을 눌러야 함)
//  · 휴식 중에는 매칭 후보에서 빠지고 카드가 회색이 된다
// ===================================================================================
const QUICK = [5, 10, 15, 30];

export function RestTimerModal({ onConfirm, onCancel, defaultMin = TIMING.restDefaultMin }) {
    const [minutes, setMinutes] = useState(defaultMin);
    const [busy, setBusy] = useState(false);
    const step = TIMING.restStepMin;
    const clamp = (v) => Math.max(step, Math.min(TIMING.restMaxMin, v));
    const endAt = new Date(Date.now() + minutes * 60000);
    const endLabel = `${String(endAt.getHours()).padStart(2, '0')}:${String(endAt.getMinutes()).padStart(2, '0')}`;

    const confirm = async (value) => {
        if (busy) return;
        setBusy(true);
        try { await onConfirm(value); } finally { setBusy(false); }
    };

    return (
        <ModalShell
            title="☕ 잠시 쉬어갈까요?"
            titleClass="display accent"
            subtitle="쉬는 동안은 매칭에 뽑히지 않아요. 시간이 지나면 자동으로 복귀합니다."
            onClose={busy ? undefined : onCancel}
            centered
            tone="accent"
            zIndex={80}
            footer={(
                <>
                    <button type="button" className="cox-btn ghost" onClick={onCancel} disabled={busy}>취소</button>
                    <button type="button" className="cox-btn primary" onClick={() => confirm(minutes)} disabled={busy} data-autofocus>
                        {busy ? '처리 중…' : `${minutes}분 쉬기`}
                    </button>
                </>
            )}
        >
            <div className="flex flex-col items-center gap-3">
                <div className="cox-stepper" role="group" aria-label="휴식 시간">
                    <button type="button" onClick={() => setMinutes((m) => clamp(m - step))} disabled={minutes <= step} aria-label={`${step}분 줄이기`}>−</button>
                    <span className="val" aria-live="polite">{minutes}<small>분</small></span>
                    <button type="button" onClick={() => setMinutes((m) => clamp(m + step))} disabled={minutes >= TIMING.restMaxMin} aria-label={`${step}분 늘리기`}>+</button>
                </div>
                <div className="flex gap-1.5 flex-wrap justify-center">
                    {QUICK.map((q) => (
                        <button
                            key={q}
                            type="button"
                            onClick={() => setMinutes(q)}
                            aria-pressed={minutes === q}
                            className={`cox-btn sm ${minutes === q ? 'primary' : 'ghost'}`}
                            style={{ flex: '0 0 auto', minWidth: 58 }}
                        >
                            {q}분
                        </button>
                    ))}
                </div>
                <p className="text-xs text-gray-400">약 <b className="text-white">{endLabel}</b>에 자동으로 복귀해요</p>
                <button type="button" className="cox-btn link" onClick={() => confirm(null)} disabled={busy}>
                    시간 정하지 않고 쉬기 (직접 복귀)
                </button>
            </div>
        </ModalShell>
    );
}
