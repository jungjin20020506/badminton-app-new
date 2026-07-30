import React from 'react';

// ===================================================================================
// [브랜드 CI] 콕스타 마크 — 검정 바탕에 노란 번개 하나 (심플·클래식)
// ===================================================================================

export function CoxMark({ size = 32, glow = false, className = '' }) {
    return (
        <svg
            viewBox="0 0 64 64"
            width={size}
            height={size}
            className={className}
            style={glow ? { filter: 'drop-shadow(0 0 10px rgba(255,214,10,.5))' } : undefined}
            aria-label="콕스라이팅"
        >
            {/* 검정 라운드 배경 */}
            <rect x="1" y="1" width="62" height="62" rx="16" fill="#0A0A0C" stroke="rgba(255,214,10,.35)" strokeWidth="2" />
            {/* 노란 번개 */}
            <path d="M37 6 L15 37 H29 L25 58 L49 26 H34 Z" fill="#FFD60A" />
        </svg>
    );
}
