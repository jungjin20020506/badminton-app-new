import React, { useRef } from 'react';

// ===================================================================================
// [고스트 무브] FLIP 애니메이션 — 카드가 순간이동하지 않고 옛 자리에서 새 자리로
// 미끄러지듯 이동한다. 관리자가 카드를 옮기면 모든 접속자의 화면에서 같은 연출.
//   원리: 렌더마다 data-flip-id 요소들의 위치를 기억해 두고, 다음 렌더에서 위치가
//   바뀐 요소를 "예전 위치 → 현 위치"로 transform 애니메이션한다. (First-Last-Invert-Play)
//  · 문서 기준 좌표로 기억한다 (viewport 기준이면 스크롤 후 카드 전체가 날아다닌다)
//  · 탭이 바뀌었거나 12장 넘게 움직였으면 레이아웃 재배치로 보고 생략한다
//  · 움직임 줄이기 설정을 켠 기기에서는 연출하지 않는다
// ===================================================================================
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useFlipAnimation(scrollRef, activeTab, deps) {
    const positionsRef = useRef(new Map());
    const prevTabRef = useRef(activeTab);

    React.useLayoutEffect(() => {
        const tabChanged = prevTabRef.current !== activeTab;
        prevTabRef.current = activeTab;

        const scrollX = window.scrollX + (scrollRef.current?.scrollLeft || 0);
        const scrollY = window.scrollY + (scrollRef.current?.scrollTop || 0);

        const next = new Map();
        document.querySelectorAll('[data-flip-id]').forEach((el) => {
            const r = el.getBoundingClientRect();
            next.set(el.dataset.flipId, { el, left: r.left + scrollX, top: r.top + scrollY });
        });

        if (!tabChanged && !reduceMotion()) {
            const movers = [];
            next.forEach(({ el, left, top }, id) => {
                const old = positionsRef.current.get(id);
                if (!old) return;
                const dx = old.left - left;
                const dy = old.top - top;
                if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
                movers.push({ el, dx, dy });
            });
            if (movers.length > 0 && movers.length <= 12) {
                movers.forEach(({ el, dx, dy }) => {
                    el.style.animation = 'none';
                    el.animate(
                        [
                            { transform: `translate(${dx}px, ${dy}px) scale(1.06)`, boxShadow: '0 10px 26px -8px rgba(205,251,71,.45)', zIndex: 5 },
                            { transform: 'none', boxShadow: '0 0 0 0 rgba(205,251,71,0)' },
                        ],
                        { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' }
                    );
                });
            }
        }

        const positions = new Map();
        next.forEach(({ left, top }, id) => positions.set(id, { left, top }));
        positionsRef.current = positions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, ...deps]);
}
