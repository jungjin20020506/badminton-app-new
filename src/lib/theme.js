// ===================================================================================
// [테마] 다크 / 라이트 / 자동(기기 설정) — 체육관 햇빛 아래서 다크가 안 보일 때
// -----------------------------------------------------------------------------------
//  · html[data-theme="light"] 가 붙으면 styles/14-theme-light.css 의 토큰이 적용된다
//  · 'auto' 는 prefers-color-scheme 을 따른다 (기본값은 'dark' — 이 앱의 정체성)
//  · 첫 그리기 전에 initTheme() 을 불러 깜빡임(FOUC)을 막는다 (main.jsx)
//  · theme-color 메타도 함께 바꿔 상태바/주소창 색이 맞게 한다
// ===================================================================================
import { STORAGE_KEYS } from './constants';

export const THEMES = ['dark', 'light', 'auto'];
const THEME_COLOR = { dark: '#08090C', light: '#F4F6F9' };
const listeners = new Set();
const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

export function getThemePreference() {
    try {
        const v = localStorage.getItem(STORAGE_KEYS.theme);
        return THEMES.includes(v) ? v : 'dark';
    } catch { return 'dark'; }
}

/** 실제로 적용되는 테마 ('dark' | 'light') */
export function resolveTheme(pref = getThemePreference()) {
    if (pref === 'auto') return mql && mql.matches ? 'light' : 'dark';
    return pref;
}

function apply(pref) {
    const resolved = resolveTheme(pref);
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[resolved]);
    listeners.forEach((fn) => { try { fn(resolved, pref); } catch { /* 무시 */ } });
}

export function setThemePreference(pref) {
    const next = THEMES.includes(pref) ? pref : 'dark';
    try { localStorage.setItem(STORAGE_KEYS.theme, next); } catch { /* 무시 */ }
    apply(next);
}

/** 프로필 메뉴에서 한 번 누를 때마다 dark → light → auto → dark */
export function cycleTheme() {
    const cur = getThemePreference();
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    setThemePreference(next);
    return next;
}

export function subscribeTheme(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function initTheme() {
    if (typeof document === 'undefined') return;
    apply(getThemePreference());
    if (mql) {
        const onChange = () => { if (getThemePreference() === 'auto') apply('auto'); };
        if (mql.addEventListener) mql.addEventListener('change', onChange);
        else if (mql.addListener) mql.addListener(onChange);
    }
}

export const THEME_LABEL = { dark: '다크', light: '라이트', auto: '기기 설정 따라가기' };
