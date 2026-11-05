import { useEffect } from 'react';

// ===================================================================================
// [스와이프 탭 전환] 모바일에서 화면을 좌우로 밀어 경기 예정 ↔ 경기 진행 이동
// 수평 이동이 64px 넘고, 세로 이동의 1.8배 이상일 때만 (세로 스크롤과 혼동 방지)
// ===================================================================================
export function useSwipeTabs(scrollRef, enabled, setActiveTab) {
    useEffect(() => {
        if (!enabled) return undefined;
        const el = scrollRef.current;
        if (!el) return undefined;
        let sx = 0, sy = 0, tracking = false;
        const onStart = (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true; };
        const onEnd = (e) => {
            if (!tracking) return;
            tracking = false;
            const dx = e.changedTouches[0].clientX - sx;
            const dy = e.changedTouches[0].clientY - sy;
            if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.8) {
                setActiveTab(dx < 0 ? 'inProgress' : 'matching');
            }
        };
        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchend', onEnd, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchend', onEnd);
        };
    }, [scrollRef, enabled, setActiveTab]);
}
