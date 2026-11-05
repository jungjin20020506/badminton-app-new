import React from 'react';

// ===================================================================================
// [아이콘] 앱에서 쓰는 아이콘 9개를 인라인 SVG로 — Font Awesome CSS(약 100KB + 웹폰트)
// 를 통째로 받던 것을 없앴다. stroke 는 currentColor 라 글자색을 그대로 따른다.
//   <Icon name="sliders" />   <Icon name="close" size={14} />
// 새 아이콘이 필요하면 아래 PATHS 에 24×24 기준 path 를 추가한다 (Lucide 스타일).
// ===================================================================================
const PATHS = {
    // 휴식 (머그컵)
    'mug-hot': 'M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM6 2v2M10 2v2M14 2v2',
    // 복귀 (재생)
    'play': 'M6 4l14 8-14 8V4z',
    // 관리자 설정 (슬라이더)
    'sliders': 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    // 자동매칭 (로봇)
    'robot': 'M12 2v4M8 6h8a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V8a2 2 0 0 1 2-2zM9 11h.01M15 11h.01M9 15h6M2 12h4M18 12h4',
    // 튜트리얼 (학사모)
    'graduation-cap': 'M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5M22 10v6',
    // 효과음 켜짐
    'volume-high': 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14',
    // 효과음 꺼짐
    'volume-xmark': 'M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6',
    // 나가기
    'right-from-bracket': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    // 카드 ✕ (원 안의 x)
    'close-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6',
    // 테마 (해 / 달)
    'sun': 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    'moon': 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    // 타이머
    'timer': 'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
};

export function Icon({ name, size = 16, strokeWidth = 2, className = '', style, title }) {
    const d = PATHS[name];
    if (!d) return null;
    return (
        <svg
            className={`cox-icon ${className}`}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={style}
            aria-hidden={title ? undefined : 'true'}
            role={title ? 'img' : undefined}
        >
            {title && <title>{title}</title>}
            <path d={d} />
        </svg>
    );
}
