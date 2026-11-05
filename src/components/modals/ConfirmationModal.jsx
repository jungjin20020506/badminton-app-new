import React from 'react';
import { ModalShell } from './ModalShell';

/**
 * 되돌릴 수 없는 동작 전 확인. 기본은 '위험' 톤(빨간 확인 버튼).
 * data: { title, body, onConfirm, confirmLabel?, cancelLabel?, tone?: 'danger'|'primary' }
 */
export function ConfirmationModal({ title, body, onConfirm, onCancel, confirmLabel = '확인', cancelLabel = '취소', tone = 'danger' }) {
    return (
        <ModalShell
            title={title}
            onClose={onCancel}
            centered
            tone={tone === 'danger' ? 'danger' : ''}
            zIndex={80}
            footer={(
                <>
                    <button type="button" className="cox-btn ghost" onClick={onCancel}>{cancelLabel}</button>
                    <button type="button" className={`cox-btn ${tone === 'danger' ? 'danger' : 'primary'}`} onClick={onConfirm} data-autofocus>{confirmLabel}</button>
                </>
            )}
        >
            <p className="cox-modal-text">{body}</p>
        </ModalShell>
    );
}
