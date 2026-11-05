// ===================================================================================
// [모니터링] 회원 폰에서 난 오류를 모아 보는 장치 (Sentry, 선택 사항)
// -----------------------------------------------------------------------------------
// Vercel 환경변수 VITE_SENTRY_DSN 이 있을 때만 켜진다. 없으면 아무것도 불러오지 않아
// 번들 크기에 영향이 없다 (동적 import로 분리된 청크).
//   1) https://sentry.io 에서 프로젝트(React) 생성 → DSN 복사
//   2) Vercel → Settings → Environment Variables → VITE_SENTRY_DSN 추가 → 재배포
// 로거(logger.js)의 error 레벨과 ErrorBoundary의 예외가 자동으로 전송된다.
// 개인정보: 선수 이름은 보내지 않는다 (선수 id만 태그로).
// ===================================================================================
import { log, formatLogEntry } from './logger';
import { CURRENT_BUILD } from './appUpdate';
import { STORAGE_KEYS } from './constants';

let sentry = null;
let initPromise = null;

export function initMonitoring() {
    if (initPromise) return initPromise;
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    if (!dsn) { initPromise = Promise.resolve(null); return initPromise; }

    initPromise = import('@sentry/react')
        .then((Sentry) => {
            Sentry.init({
                dsn,
                release: `cockslighting@${CURRENT_BUILD}`,
                environment: import.meta.env.MODE,
                tracesSampleRate: 0,          // 성능 추적은 끈다 (비용·개인정보)
                sendDefaultPii: false,
                maxBreadcrumbs: 30,
                beforeSend(event) {
                    // 직전 로그 30줄을 함께 첨부해 재현에 도움을 준다
                    event.extra = { ...(event.extra || {}), recentLogs: log.recent().slice(-30).map(formatLogEntry) };
                    return event;
                },
            });
            let playerId = null;
            try { playerId = localStorage.getItem(STORAGE_KEYS.currentUserId); } catch { /* 무시 */ }
            if (playerId) Sentry.setTag('playerId', playerId);
            sentry = Sentry;
            // 로거의 error 레벨을 자동 전송
            log.subscribe((entry) => {
                if (entry.level !== 'error') return;
                const err = entry.args.find((a) => a instanceof Error);
                if (err) Sentry.captureException(err, { extra: { message: formatLogEntry(entry) } });
                else Sentry.captureMessage(formatLogEntry(entry), 'error');
            });
            log.info('[모니터링] Sentry 연결됨');
            return Sentry;
        })
        .catch((e) => { log.warn('[모니터링] 초기화 실패 (무시하고 계속)', e); return null; });
    return initPromise;
}

/** ErrorBoundary 등에서 예외를 직접 보낼 때 */
export function captureError(error, context = {}) {
    if (!sentry) return;
    try { sentry.captureException(error, { extra: context }); } catch { /* 무시 */ }
}
