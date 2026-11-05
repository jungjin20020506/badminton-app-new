import { useEffect, useState } from 'react';

/** 화면 너비 768px 미만이면 모바일 레이아웃(탭 2개 + 하단 내비). resize 마다 재계산 */
export function useIsMobile(breakpoint = 768) {
    const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < breakpoint : true));
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < breakpoint);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [breakpoint]);
    return isMobile;
}
