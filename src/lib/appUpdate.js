/* global __BUILD_ID__ */
// ===================================================================================
// [업데이트] 새 버전 감지 · 자동 적용 로직 (UpdateBanner / SettingsModal / EntryPage 공용)
// -----------------------------------------------------------------------------------
// 배포(빌드)할 때마다 코드에 빌드 번호(vite.config.js의 __BUILD_ID__)가 새겨지고,
// 서버에는 같은 번호가 적힌 version.json 이 함께 올라간다.
// 두 값이 다르면 = 이 기기는 구버전.
//
// 왜 구버전이 오래 남나: 홈화면에 추가한 앱(PWA)은 사용자가 새로고침을 하지 않고,
// 배너를 띄워 줘도 안 누르는 사람이 많다. 그래서 "사용자가 아무것도 하지 않아도"
// 아래 순간에는 자동으로 새로고침해서 최신 버전을 받아 온다.
//   ① 앱이 켜지는 순간            — 아직 아무것도 안 했으니 잃을 게 없다
//   ② 다른 앱에 갔다가 1분 넘게 지나 돌아온 순간
//   ③ 새 버전이 떠 있는데 2분 넘게 손을 안 대고 있을 때 (전광판처럼 켜 둔 기기)
// 그 외(조작 중)에는 배너로 안내만 하고, [업데이트] 버튼을 누르면 즉시 적용한다.
//
// 안전장치: 같은 서버 버전에 대한 자동 새로고침은 10분에 한 번만. (CDN 전파 지연 등으로
// 새로고침 뒤에도 옛 파일이 오면 무한 새로고침에 빠지지 않도록) 그 경우엔 배너만 남긴다.
// 로그인은 localStorage(badminton-currentUser-id)에 있어 새로고침해도 유지된다.
// ===================================================================================

export const CURRENT_BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
// 개발 서버(npm run dev)에는 version.json 이 없으므로 검사하지 않는다
export const UPDATE_ENABLED = import.meta.env.PROD && CURRENT_BUILD !== 'dev';

export const CHECK_INTERVAL_MS = 3 * 60 * 1000;   // 주기 검사 (배너 안내만)
export const AWAY_RELOAD_MS = 60 * 1000;          // 이만큼 나갔다 돌아오면 자동 새로고침
export const IDLE_RELOAD_MS = 2 * 60 * 1000;      // 새 버전 대기 중 이만큼 조작 없으면 자동 새로고침
const ATTEMPT_COOLDOWN_MS = 10 * 60 * 1000;       // 같은 버전 자동 새로고침 재시도 간격
const ATTEMPT_KEY = 'cox-update-attempt';         // localStorage: {buildId, at}

const readAttempt = () => {
    try { return JSON.parse(localStorage.getItem(ATTEMPT_KEY) || 'null'); } catch { return null; }
};
const writeAttempt = (buildId) => {
    try { localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ buildId, at: Date.now() })); } catch { /* 무시 */ }
};
const clearAttempt = () => {
    try { localStorage.removeItem(ATTEMPT_KEY); } catch { /* 무시 */ }
};

// 빌드 번호(ISO 시각)를 "2026.11.05 11:47" (한국시간) 처럼 읽기 쉽게
export function formatBuild(buildId = CURRENT_BUILD) {
    if (!buildId || buildId === 'dev') return '개발 버전';
    const d = new Date(buildId);
    if (Number.isNaN(d.getTime())) return buildId;
    const k = new Date(d.getTime() + 9 * 60 * 60 * 1000); // KST
    const p = (n) => String(n).padStart(2, '0');
    return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

// 서버의 현재 빌드 번호. 실패(오프라인 등)하면 null
export async function fetchServerBuild({ timeoutMs = 8000 } = {}) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
        // ?t=시각 을 붙여 CDN/브라우저 캐시를 건너뛰고 항상 최신 파일을 받는다
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', signal: ctrl?.signal });
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data?.buildId === 'string' && data.buildId ? data.buildId : null;
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export const isNewerBuild = (serverBuild) => !!serverBuild && serverBuild !== CURRENT_BUILD;

// 이 서버 버전으로 자동 새로고침을 해도 되는가 (10분 내 이미 시도했으면 false)
export function canAutoReload(serverBuild) {
    const a = readAttempt();
    if (!a || a.buildId !== serverBuild) return true;
    return Date.now() - a.at > ATTEMPT_COOLDOWN_MS;
}

// 방금 업데이트 새로고침으로 올라온 버전인지 (안내 토스트용). 확인하면서 기록을 지운다
export function consumeJustUpdated() {
    const a = readAttempt();
    if (a && a.buildId === CURRENT_BUILD) { clearAttempt(); return true; }
    return false;
}

// 새 버전 적용: 서비스워커 갱신 + 캐시 비우기(각각 실패해도 진행, 최대 2.5초) → 새로고침
let applying = false;
export async function applyUpdate(serverBuild) {
    if (applying) return;
    applying = true;
    if (serverBuild) writeAttempt(serverBuild);
    const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
    try {
        await withTimeout((async () => {
            const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
            await Promise.all(regs.map((r) => r.update().catch(() => {})));
            if (window.caches?.keys) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
            }
        })(), 2500);
    } catch { /* 무시 */ }
    window.location.reload();
}

const isTyping = () => {
    const el = document.activeElement;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
};

// 감시 시작. 자동 적용하지 못하고 대기 중인 새 버전이 생기면 onUpdateReady(buildId) 호출.
// 반환값: 감시 중단 함수
export function startUpdateWatcher(onUpdateReady) {
    if (!UPDATE_ENABLED || typeof document === 'undefined') return () => {};
    let stopped = false;
    let checking = false;
    let pending = null;              // 감지됐지만 아직 적용 못 한 서버 버전
    let hiddenAt = 0;
    let lastActivity = Date.now();

    const tryAutoReload = (reason) => {
        if (!pending || !canAutoReload(pending)) return false;
        console.log('[업데이트] 자동 새로고침:', reason, pending);
        applyUpdate(pending);
        return true;
    };

    // allowAuto: 지금이 자동 새로고침해도 되는 순간인가
    const check = async ({ allowAuto, reason }) => {
        if (stopped || checking || document.visibilityState === 'hidden') return;
        checking = true;
        try {
            const server = await fetchServerBuild();
            if (stopped || !isNewerBuild(server)) return;
            pending = server;
            if (allowAuto && tryAutoReload(reason)) return;
            onUpdateReady(server);
        } finally {
            checking = false;
        }
    };

    // ① 켜질 때
    check({ allowAuto: true, reason: '앱 시작' });

    // 주기 검사 — 조작 중일 수 있으니 배너로만 안내
    const timer = setInterval(() => check({ allowAuto: false }), CHECK_INTERVAL_MS);

    // ② 화면 복귀 — 오래 나갔다 왔으면 자동, 잠깐이면 배너
    const onVisibility = () => {
        if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
        const away = hiddenAt ? Date.now() - hiddenAt : 0;
        hiddenAt = 0;
        lastActivity = Date.now();
        check({ allowAuto: away >= AWAY_RELOAD_MS, reason: `화면 복귀 (${Math.round(away / 1000)}초 만)` });
    };
    document.addEventListener('visibilitychange', onVisibility);
    // 뒤로가기 캐시(bfcache)에서 되살아난 경우도 앱 시작과 같게 취급
    const onPageShow = (e) => { if (e.persisted) check({ allowAuto: true, reason: '뒤로가기 복귀' }); };
    window.addEventListener('pageshow', onPageShow);
    const onOnline = () => check({ allowAuto: false });
    window.addEventListener('online', onOnline);

    // ③ 새 버전 대기 중 조작이 없으면 자동 적용
    const markActive = () => { lastActivity = Date.now(); };
    const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    activityEvents.forEach((ev) => window.addEventListener(ev, markActive, { passive: true, capture: true }));
    const idleTimer = setInterval(() => {
        if (!pending || document.visibilityState === 'hidden') return;
        if (Date.now() - lastActivity < IDLE_RELOAD_MS) return;
        if (isTyping()) return;
        tryAutoReload('조작 없음');
    }, 15 * 1000);

    return () => {
        stopped = true;
        clearInterval(timer);
        clearInterval(idleTimer);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pageshow', onPageShow);
        window.removeEventListener('online', onOnline);
        activityEvents.forEach((ev) => window.removeEventListener(ev, markActive, { capture: true }));
    };
}
