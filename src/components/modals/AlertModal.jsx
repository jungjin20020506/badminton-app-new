import React from 'react';
import { ModalShell } from './ModalShell';

/** 알림 — 제목 + 본문(줄바꿈 유지) + 확인. 본문이 길면 스크롤 */
export function AlertModal({ title, body, onClose, confirmLabel = '확인' }) {
    return (
        <ModalShell
            title={title}
            titleClass="accent"
            onClose={onClose}
            centered
            tone="accent"
            zIndex={80}
            footer={<button type="button" className="cox-btn primary" onClick={onClose} data-autofocus>{confirmLabel}</button>}
        >
            <p className="cox-modal-text">{body}</p>
        </ModalShell>
    );
}
