// ===================================================================================
// [로거] console.* 대신 쓰는 얇은 래퍼
// -----------------------------------------------------------------------------------
//  · 레벨: debug < info < warn < error. 프로덕션에서는 debug를 숨긴다.
//  · 최근 60건을 링 버퍼에 보관한다 — 오류 화면·모니터링(Sentry)에 "직전에 무슨 일이
//    있었는지"를 같이 보낼 수 있다.
//  · subscribe()로 오류를 구독할 수 있다 (monitoring.js가 error 레벨을 Sentry로 보낸다).
// ===================================================================================
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const isProd = typeof import.meta !== 'undefined' && !!import.meta.env?.PROD;

let threshold = isProd ? LEVELS.info : LEVELS.debug;
const buffer = [];
const BUFFER_MAX = 60;
const listeners = new Set();

const consoleFor = {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};

function emit(level, args) {
    const entry = { level, at: new Date().toISOString(), args };
    buffer.push(entry);
    if (buffer.length > BUFFER_MAX) buffer.shift();
    listeners.forEach((fn) => { try { fn(entry); } catch { /* 구독자 오류는 무시 */ } });
    if (LEVELS[level] < threshold) return;
    consoleFor[level](...args);
}

/** 로그 항목을 사람이 읽을 수 있는 한 줄로 */
export function formatLogEntry(entry) {
    const parts = entry.args.map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
    });
    return `${entry.at.slice(11, 19)} [${entry.level}] ${parts.join(' ')}`;
}

export const log = {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    /** 'debug' | 'info' | 'warn' | 'error' */
    setLevel: (level) => { if (LEVELS[level]) threshold = LEVELS[level]; },
    /** 최근 로그 (오래된 것부터) */
    recent: () => buffer.slice(),
    /** 모든 로그 항목을 구독한다. 반환값은 구독 해제 함수 */
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
};
