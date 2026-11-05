import React, { useState } from 'react';
import { ModalShell } from './ModalShell';

/** [히든 키] 전체 내보내기 비밀 키 입력 — 키를 아는 사람만 실행할 수 있다 */
export function HiddenKeyModal({ onSubmit, onCancel }) {
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        if (busy || !value.trim()) return;
        setBusy(true);
        try { await onSubmit(value); } finally { setBusy(false); }
    };
    return (
        <ModalShell
            title="🔒 히든 키"
            subtitle="대기자 전체 내보내기를 실행하려면 관리자 히든 키를 입력하세요"
            onClose={busy ? undefined : onCancel}
            centered
            tone="danger"
            zIndex={80}
            footer={(
                <>
                    <button type="button" className="cox-btn ghost" onClick={onCancel} disabled={busy}>취소</button>
                    <button type="button" className="cox-btn danger" onClick={submit} disabled={busy || !value.trim()}>{busy ? '확인 중...' : '실행'}</button>
                </>
            )}
        >
            <input
                type="password"
                inputMode="text"
                data-autofocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                className="cox-field text-center text-lg tracking-widest"
                placeholder="••••"
                aria-label="히든 키"
            />
        </ModalShell>
    );
}
