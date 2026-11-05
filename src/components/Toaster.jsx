import React, { useEffect, useState, useCallback } from 'react';
import { subscribeToasts } from '../lib/toast';

// ===================================================================================
// [토스트] lib/toast.js 의 showToast()를 화면에 그린다. main.jsx 에서 App 옆에 둔다.
//  · 최대 3개까지 쌓이고, 각자 시간이 지나면 사라진다
//  · 탭하면 바로 닫힌다. action 이 있으면 버튼으로 표시
//  · role="status" 로 보조기기에도 읽힌다
// ===================================================================================
const MAX_VISIBLE = 3;

export function Toaster() {
    const [toasts, setToasts] = useState([]);

    const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

    useEffect(() => {
        const timers = new Map();
        const stop = subscribeToasts((toast) => {
            setToasts((list) => [...list, toast].slice(-MAX_VISIBLE));
            timers.set(toast.id, setTimeout(() => { dismiss(toast.id); timers.delete(toast.id); }, toast.durationMs));
        });
        return () => { stop(); timers.forEach(clearTimeout); };
    }, [dismiss]);

    if (toasts.length === 0) return null;

    return (
        <div className="cox-toasts" aria-live="polite">
            {toasts.map((t) => (
                <div
                    key={t.id}
                    className={`cox-toast ${t.tone}`}
                    role="status"
                    onClick={() => dismiss(t.id)}
                >
                    <span className="cox-toast-text">{t.text}</span>
                    {t.action && (
                        <button
                            type="button"
                            className="cox-toast-action"
                            onClick={(e) => { e.stopPropagation(); dismiss(t.id); t.action.onClick(); }}
                        >
                            {t.action.label}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
