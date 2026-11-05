import React, { useEffect, useState } from 'react';
import { subscribeConnection, getConnectionState, forceReconnect } from '../lib/firebase';

// ===================================================================================
// [연결 상태] 서버와 끊기면 화면 위에 띠를 띄운다
// -----------------------------------------------------------------------------------
// 예전에는 연결이 끊겨도 아무 표시가 없어 "앱이 멈췄나?" 싶었다.
//  · offline      → "연결이 끊겼어요 · 다시 연결 중…" (빨간 띠)
//  · reconnecting → "다시 연결 중…" (노란 띠)
//  · online       → 띠가 사라진다. 끊김 뒤 복구되면 2초간 "연결됐어요" (초록 띠)
// 잠깐의 끊김(3초 미만)에는 띠를 띄우지 않아 깜빡임이 없다.
// ===================================================================================
const SHOW_DELAY_MS = 3000;

export function ConnectionBanner() {
    const [state, setState] = useState(getConnectionState());
    const [visible, setVisible] = useState(false);
    const [restored, setRestored] = useState(false);

    useEffect(() => subscribeConnection(setState), []);

    useEffect(() => {
        if (state === 'online') {
            if (visible) {
                setRestored(true);
                const t = setTimeout(() => setRestored(false), 2000);
                setVisible(false);
                return () => clearTimeout(t);
            }
            return undefined;
        }
        const t = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
        return () => clearTimeout(t);
    }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

    if (restored && state === 'online') {
        return <div className="cox-conn online" role="status">✅ 다시 연결됐어요</div>;
    }
    if (!visible || state === 'online') return null;

    return (
        <div className={`cox-conn ${state}`} role="status">
            <span>{state === 'offline' ? '📡 연결이 끊겼어요 · 다시 연결 중…' : '🔄 다시 연결 중…'}</span>
            <button type="button" onClick={() => forceReconnect('연결 띠 재시도')}>지금 재시도</button>
        </div>
    );
}
