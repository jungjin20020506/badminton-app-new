import { useEffect, useState } from 'react';
import { forceReconnect } from '../lib/firebase';

// ===================================================================================
// [당겨서 새로고침] PWA standalone 모드에는 브라우저 기본 새로고침이 없으므로 직접 구현
// -----------------------------------------------------------------------------------
//  · 임계값 55px, 최대 당김 100px, 저항 계수 0.55
//  · 최상단 판정은 main / window / documentElement 세 군데를 모두 본다 (실제 스크롤은 body)
//  · 비패시브 touchmove 리스너는 당김이 시작될 때만 붙인다 (상시 걸면 모든 스크롤이 버벅인다)
//  · 임계값을 넘기면 페이지를 새로고침하지 않고 Firestore 연결만 새로 맺는다 (훨씬 빠르다)
// resetKeys: 이 값들이 바뀌면(화면 전환 등으로 main 이 다시 마운트) 리스너를 다시 붙인다
// ===================================================================================
const THRESHOLD = 55;
const MAX_PULL = 100;

export function usePullToRefresh(scrollRef, resetKeys = []) {
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return undefined;
        let startY = 0;
        let pulling = false;
        let currentPull = 0;

        const atTop = () => el.scrollTop <= 0 && window.scrollY <= 0 && document.documentElement.scrollTop <= 0;

        const onTouchMove = (e) => {
            if (!pulling || isRefreshing) return;
            const delta = e.touches[0].clientY - startY;
            if (delta > 0 && atTop()) {
                e.preventDefault();
                currentPull = Math.min(MAX_PULL, delta * 0.55);
                setPullDistance(currentPull);
            } else {
                stopPulling();
                setPullDistance(0);
            }
        };
        const stopPulling = () => {
            if (!pulling) return;
            pulling = false;
            currentPull = 0;
            el.removeEventListener('touchmove', onTouchMove);
        };
        const onTouchStart = (e) => {
            if (isRefreshing) return;
            if (atTop()) {
                startY = e.touches[0].clientY;
                pulling = true;
                currentPull = 0;
                el.addEventListener('touchmove', onTouchMove, { passive: false });
            }
        };
        const finishPull = () => {
            if (!pulling) return;
            const finalPull = currentPull;
            stopPulling();
            if (finalPull >= THRESHOLD) {
                setIsRefreshing(true);
                setPullDistance(THRESHOLD);
                (async () => {
                    try {
                        await Promise.race([
                            forceReconnect('당겨서 새로고침'),
                            new Promise((resolve) => setTimeout(resolve, 4000)),
                        ]);
                    } catch { /* 재연결 실패해도 스피너는 멈춘다 */ }
                    setTimeout(() => { setIsRefreshing(false); setPullDistance(0); }, 500);
                })();
            } else {
                setPullDistance(0);
            }
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchend', finishPull, { passive: true });
        el.addEventListener('touchcancel', finishPull, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', finishPull);
            el.removeEventListener('touchcancel', finishPull);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrollRef, isRefreshing, ...resetKeys]);

    return { pullDistance, isRefreshing };
}
