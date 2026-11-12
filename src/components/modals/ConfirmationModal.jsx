import React from 'react';
import { ModalShell } from './ModalShell';

/**
 * 되돌릴 수 없는 동작 전 확인. 기본은 '위험' 톤(빨간 확인 버튼).
 * data: { title, body, onConfirm, confirmLabel?, cancelLabel?, tone?: 'danger'|'primary',
 *         secondaryLabel?, onSecondary? }  — 본문 아래 작은 글씨 링크(예: '경기 취소')
 */
export function ConfirmationModal({ title, body, onConfirm, onCancel, confirmLabel = '확인', cancelLabel = '취소', tone = 'danger', secondaryLabel = null, onSecondary = null }) {
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
            {secondaryLabel && onSecondary && (
                <button type="button" className="cox-confirm-secondary" onClick={onSecondary}>{secondaryLabel}</button>
            )}
        </ModalShell>
    );
}
