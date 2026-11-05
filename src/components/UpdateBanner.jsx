import React, { useEffect, useState, useCallback } from 'react';
import {
    UPDATE_ENABLED, CURRENT_COMMIT, formatBuild, fetchServerBuild, isNewerBuild,
    applyUpdate, startUpdateWatcher, consumeJustUpdated,
} from '../lib/appUpdate';

// ===================================================================================
// [업데이트 안내] 새 버전 배포 감지 배너 + 업데이트 완료 토스트
// -----------------------------------------------------------------------------------
// 감지·자동 적용 규칙은 src/lib/appUpdate.js 참고. 이 컴포넌트는 main.jsx 에서
// <App /> 과 나란히 렌더링되어, 로딩 화면·인앱 브라우저 안내·입장 화면·메인 화면
// 어디에 있든 항상 떠 있다.
//  · 자동으로 적용하지 못한 새 버전이 있으면 → 배너 (버튼을 누르면 즉시 적용,
//    안 눌러도 2분간 조작이 없으면 자동 적용)
//  · 업데이트 새로고침으로 막 올라왔으면 → 4초짜리 완료 토스트
// ===================================================================================
export function UpdateBanner() {
    const [pendingBuild, setPendingBuild] = useState(null);
    const [justUpdated, setJustUpdated] = useState(false);

    useEffect(() => {
        let toastTimer = null;
        if (consumeJustUpdated()) {
            setJustUpdated(true);
            toastTimer = setTimeout(() => setJustUpdated(false), 4000);
        }
        const stop = startUpdateWatcher((build) => setPendingBuild(build));
        return () => { stop(); if (toastTimer) clearTimeout(toastTimer); };
    }, []);

    const handleUpdate = useCallback(() => { applyUpdate(pendingBuild); }, [pendingBuild]);

    if (pendingBuild) {
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
                    <p className="text-[11px] text-gray-400 mt-0.5">버튼을 누르면 바로 바뀌고, 안 눌러도 잠시 후 자동으로 바뀝니다.</p>
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

    if (justUpdated) {
        return (
            <div
                className="fixed bottom-5 left-4 right-4 z-[90] rounded-xl px-4 py-2.5 max-w-md mx-auto text-center pointer-events-none"
                style={{ background: '#1a1f16', border: '1px solid rgba(205,251,71,.35)', boxShadow: '0 8px 30px rgba(0,0,0,.6)' }}
                role="status"
            >
                <p className="text-sm text-white font-bold">✅ 최신 버전으로 업데이트됐어요</p>
                <p className="text-[11px] text-gray-400 mt-0.5">버전 {formatBuild()}</p>
            </div>
        );
    }

    return null;
}

// ===================================================================================
// [버전 표시] "버전 2026.11.05 11:47 · 업데이트 확인" — 설정 모달·입장 화면 하단용
// 사용자가 구버전이라고 할 때 어느 버전인지 바로 알 수 있고, 눌러서 직접 확인·적용할 수 있다.
// ===================================================================================
export function VersionInfo({ className = '' }) {
    const [state, setState] = useState('idle'); // idle | checking | latest | updating | failed

    const check = useCallback(async () => {
        setState('checking');
        const server = await fetchServerBuild();
        if (!server) { setState('failed'); setTimeout(() => setState('idle'), 3000); return; }
        if (isNewerBuild(server)) { setState('updating'); applyUpdate(server); return; }
        setState('latest');
        setTimeout(() => setState('idle'), 3000);
    }, []);

    const label = {
        idle: '업데이트 확인',
        checking: '확인 중…',
        latest: '최신 버전이에요 ✓',
        updating: '업데이트 중…',
        failed: '확인 실패 (연결을 확인해 주세요)',
    }[state];

    return (
        <div className={`text-[11px] text-gray-500 flex items-center justify-center gap-2 ${className}`}>
            <span>버전 {formatBuild()}{CURRENT_COMMIT !== 'local' && <span className="opacity-70"> · {CURRENT_COMMIT}</span>}</span>
            {UPDATE_ENABLED && (
                <>
                    <span aria-hidden="true">·</span>
                    <button
                        type="button"
                        onClick={check}
                        disabled={state === 'checking' || state === 'updating'}
                        className="underline underline-offset-2 hover:text-gray-300 disabled:opacity-60"
                    >
                        {label}
                    </button>
                </>
            )}
        </div>
    );
}
