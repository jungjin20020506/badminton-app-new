import React from 'react';

// ===================================================================================
// [브랜드 CI] 콕스타 마크 — "볼트 셔틀(Volt Shuttle)"
// -----------------------------------------------------------------------------------
// 셔틀콕의 깃털 3장이 번개(볼트)로 변하는 모노그램. 코르크는 라임색 점.
// 잉크색 라운드 사각 위 형광 라임 — 앱의 다크+볼트 시스템을 한 글자로 압축한다.
// 어디서나 currentColor 없이 고정 브랜드 컬러를 쓴다 (일관성 우선).
// ===================================================================================

export function CoxMark({ size = 32, glow = false, className = '' }) {
    return (
        <svg
            viewBox="0 0 64 64"
            width={size}
            height={size}
            className={className}
            style={glow ? { filter: 'drop-shadow(0 0 10px rgba(205,251,71,.55))' } : undefined}
            aria-label="콕스타"
        >
            {/* 잉크 라운드 배경 */}
            <rect x="1" y="1" width="62" height="62" rx="16" fill="#101217" stroke="rgba(205,251,71,.35)" strokeWidth="2" />
            {/* 깃털 = 번개 3획 (오른쪽 위로 날아가는 셔틀) */}
            <path d="M20 46 L34 26 L28 26 L40 10 L37 22 L43 22 L26 46 Z" fill="#CDFB47" />
            <path d="M40 34 L52 20 L49 31 L54 31 L42 46 L45 37 Z" fill="#CDFB47" opacity=".55" />
            {/* 코르크 = 라임 점 (스매시 임팩트) */}
            <circle cx="18" cy="52" r="5" fill="#CDFB47" />
            <circle cx="18" cy="52" r="8.5" fill="none" stroke="rgba(205,251,71,.4)" strokeWidth="1.6" />
        </svg>
    );
}

// 워드마크 — 마크 + COCKSLIGHTING 레터링 (입장 화면·헤더용)
export function CoxWordmark({ markSize = 40 }) {
    return (
        <div className="cox-wordmark">
            <CoxMark size={markSize} glow />
            <div className="cox-wordmark-text">
                <span className="line1">COCKS<em>LIGHTING</em></span>
            </div>
        </div>
    );
}
