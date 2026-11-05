import React, { useState } from 'react';
import { ModalShell } from './ModalShell';

/** 빈 코트가 2개 이상일 때 — 어느 코트에서 시작할지 */
export function CourtSelectionModal({ courts, onSelect, onCancel }) {
    const [isProcessing, setIsProcessing] = useState(false);
    return (
        <ModalShell
            title="코트 선택"
            titleClass="display accent"
            subtitle="경기를 시작할 코트를 골라주세요"
            onClose={isProcessing ? undefined : onCancel}
            centered
            zIndex={70}
            footer={<button type="button" className="cox-btn ghost" onClick={onCancel} disabled={isProcessing}>취소</button>}
        >
            <div className="flex flex-col gap-2">
                {courts.map((courtIdx) => (
                    <button
                        key={courtIdx}
                        type="button"
                        className="cox-btn primary block"
                        style={{ minHeight: 52, fontSize: 16 }}
                        disabled={isProcessing}
                        onClick={() => { setIsProcessing(true); onSelect(courtIdx); }}
                    >
                        {isProcessing ? '처리 중...' : `${courtIdx + 1}번 코트`}
                    </button>
                ))}
            </div>
        </ModalShell>
    );
}
