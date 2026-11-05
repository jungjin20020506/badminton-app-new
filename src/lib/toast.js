// ===================================================================================
// [토스트] 화면 아래에 잠깐 떴다 사라지는 짧은 안내 (저장 실패, 되돌리기 등)
// -----------------------------------------------------------------------------------
// 모달(AlertModal)은 사용자가 '확인'을 눌러야 닫혀서 경기 중 흐름을 끊는다.
// "저장 안 됐어요, 다시 눌러주세요" 같은 가벼운 안내는 이 토스트로 보낸다.
//   showToast('저장 안 됐어요', { tone: 'error', action: { label: '다시 시도', onClick } })
// 화면 쪽은 components/Toaster.jsx 가 구독해서 그린다.
// ===================================================================================
const listeners = new Set();
let seq = 0;

/**
 * @param {string} text
 * @param {{tone?: 'info'|'success'|'error'|'warn', durationMs?: number, action?: {label:string, onClick:Function}}} [opts]
 * @returns {number} toast id
 */
export function showToast(text, opts = {}) {
    const toast = {
        id: ++seq,
        text,
        tone: opts.tone || 'info',
        durationMs: opts.durationMs ?? (opts.action ? 6000 : 3500),
        action: opts.action || null,
    };
    listeners.forEach((fn) => fn(toast));
    return toast.id;
}

export const toastError = (text, opts) => showToast(text, { ...opts, tone: 'error' });
export const toastSuccess = (text, opts) => showToast(text, { ...opts, tone: 'success' });

/** Toaster 컴포넌트가 구독한다 */
export function subscribeToasts(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
