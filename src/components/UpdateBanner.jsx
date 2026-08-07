import React, { useEffect, useState, useCallback } from 'react';

// ===================================================================================
// [업데이트 안내] 새 버전 배포 감지 배너
// -----------------------------------------------------------------------------------
// 배포(빌드)할 때마다 코드에 '빌드 번호'가 새겨지고(vite.config.js의 __BUILD_ID__),
// 서버에는 같은 번호가 적힌 version.json 파일이 함께 올라간다.
// 앱은 (1) 켜질 때 (2) 화면에 다시 돌아올 때 (3) 5분마다 서버의 version.json을
// 읽어서, 내 번호와 다르면 = 새 버전이 배포된 것 → 업데이트 배너를 띄운다.
// 홈화면에 추가한 앱(PWA)은 새로고침할 일이 없어 옛 코드로 계속 돌기 때문에 필요하다.
// ===================================================================================
const CURRENT_BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function UpdateBanner() {
    const [updateReady, setUpdateReady] = useState(false);

    useEffect(() => {
        if (!import.meta.env.PROD) return; // 개발 서버에서는 검사하지 않음
        let stopped = false;

        const check = async () => {
            if (stopped || document.visibilityState === 'hidden') return;
            try {
                // ?t=시각 을 붙여 CDN/브라우저 캐시를 건너뛰고 항상 최신 파일을 받는다
                const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
                if (!res.ok) return;
                const { buildId } = await res.json();
                if (!stopped && buildId && buildId !== CURRENT_BUILD) setUpdateReady(true);
            } catch { /* 오프라인 등 — 다음 검사 때 다시 시도 */ }
        };

        check();
        const timer = setInterval(check, CHECK_INTERVAL_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') check(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            stopped = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    const handleUpdate = useCallback(async () => {
        // 서비스워커도 새 버전으로 갱신해 두고 새로고침 (실패해도 새로고침은 진행)
        try {
            const regs = await navigator.serviceWorker?.getRegistrations?.();
            if (regs) await Promise.all(regs.map(r => r.update().catch(() => {})));
        } catch { /* 무시 */ }
        window.location.reload();
    }, []);

    if (!updateReady) return null;

    return (
        <div
            className="fixed bottom-5 left-4 right-4 z-[90] rounded-xl flex items-center justify-between gap-3 px-4 py-3 max-w-md mx-auto"
            style={{
                background: '#1a1f16',
                border: '1px solid rgba(205,251,71,.55)',
                boxShadow: '0 8px 30px rgba(0,0,0,.65), 0 0 18px -6px rgba(205,251,71,.35)',
            }}
        >
            <div className="flex-1">
                <p className="font-bold text-white text-sm">🔄 새 버전이 나왔어요!</p>
                <p className="text-[11px] text-gray-400 mt-0.5">업데이트 버튼을 누르면 최신 버전으로 바뀝니다.</p>
            </div>
            <button
                onClick={handleUpdate}
                className="flex-shrink-0 font-bold text-black text-sm px-4 py-2 rounded-lg active:scale-95 transition-transform"
                style={{ background: '#CDFB47' }}
            >
                업데이트
            </button>
        </div>
    );
}
