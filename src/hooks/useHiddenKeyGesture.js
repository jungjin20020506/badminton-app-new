import { useCallback, useRef } from 'react';

// ===================================================================================
// [히든 키] 왼쪽 위 로고를 연속 5번 탭(탭 사이 3초 이내)하면 onTrigger 가 호출된다.
// onPointerDown 에 바인딩할 것 — 손가락이 닿는 순간 바로 세므로 빠르게 탭해도 놓치지 않는다.
// ===================================================================================
export function useHiddenKeyGesture(enabled, onTrigger, { taps = 5, windowMs = 3000 } = {}) {
    const ref = useRef({ count: 0, last: 0 });
    return useCallback(() => {
        if (!enabled) return;
        const now = Date.now();
        if (now - ref.current.last > windowMs) ref.current.count = 0;
        ref.current.last = now;
        ref.current.count += 1;
        if (ref.current.count >= taps) {
            ref.current.count = 0;
            onTrigger();
        }
    }, [enabled, onTrigger, taps, windowMs]);
}
