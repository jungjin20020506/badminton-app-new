// ===================================================================================
// [시뮬레이션] 브라우저 안에서만 도는 가짜 Firestore — 실제 서버에는 아무것도 보내지 않는다
// -----------------------------------------------------------------------------------
// 쓰는 법:  npm run dev:sim   (vite --mode sim)
//   vite.config.js 가 'sim' 모드일 때만 'firebase/firestore' 를 이 파일로 바꿔치기한다.
//   배포 빌드(vercel)·일반 dev 서버에는 전혀 영향이 없다.
//
// 왜 필요한가:
//   이 앱은 로컬에서 띄워도 프로덕션 Firestore에 그대로 붙는다. 테스트로 선수를 넣고
//   경기를 돌리면 실제 모임 현황판이 더럽혀지고, 새벽 초기화까지 건드릴 수 있다.
//   그래서 앱이 쓰는 Firestore API 부분집합을 메모리+localStorage 로 흉내 낸다.
//
// 지원: collection/doc/query/where/orderBy/limit, getDoc/getDocs, onSnapshot(문서·쿼리),
//      setDoc(merge)/updateDoc(점 표기 필드 경로)/deleteDoc/addDoc, writeBatch, runTransaction,
//      serverTimestamp/deleteField/arrayUnion/arrayRemove/increment, Timestamp.
// 특징:
//   · 데이터는 localStorage('cox-sim-firestore') 에 저장되어 새로고침해도 남는다.
//   · 다른 탭에서 쓰면 storage 이벤트로 전파되어 "두 기기가 같은 방을 보는" 상황을 흉내 낸다.
//   · 콘솔에서 window.__sim.dump() / reset() / set(path, data) 로 들여다보거나 손볼 수 있다.
// ===================================================================================

const PERSIST_KEY = 'cox-sim-firestore';

export class Timestamp {
    constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
    static now() { return Timestamp.fromMillis(Date.now()); }
    static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
    static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
    toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
    toDate() { return new Date(this.toMillis()); }
    isEqual(o) { return o instanceof Timestamp && o.toMillis() === this.toMillis(); }
    toJSON() { return { __ts: this.toMillis() }; }
}

const SENTINEL = Symbol('sentinel');
const sentinel = (kind, payload) => ({ [SENTINEL]: kind, payload });
const kindOf = (v) => (v && typeof v === 'object' && v[SENTINEL]) || null;

export const serverTimestamp = () => sentinel('serverTimestamp');
export const deleteField = () => sentinel('delete');
export const arrayUnion = (...items) => sentinel('arrayUnion', items);
export const arrayRemove = (...items) => sentinel('arrayRemove', items);
export const increment = (n) => sentinel('increment', n);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Date) && !kindOf(v);

const clone = (v) => {
    if (v instanceof Timestamp) return v;
    if (v instanceof Date) return Timestamp.fromDate(v);
    if (Array.isArray(v)) return v.map(clone);
    if (isPlainObject(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = clone(v[k]); return o; }
    return v;
};

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 센티널을 실제 값으로 바꾼다 (prev: 같은 자리에 있던 기존 값) */
const resolveValue = (v, prev) => {
    const kind = kindOf(v);
    if (!kind) return clone(v);
    if (kind === 'serverTimestamp') return Timestamp.now();
    if (kind === 'increment') return (typeof prev === 'number' ? prev : 0) + v.payload;
    if (kind === 'arrayUnion') {
        const base = Array.isArray(prev) ? [...prev] : [];
        v.payload.forEach((it) => { if (!base.some((b) => sameValue(b, it))) base.push(clone(it)); });
        return base;
    }
    if (kind === 'arrayRemove') return (Array.isArray(prev) ? prev : []).filter((b) => !v.payload.some((it) => sameValue(b, it)));
    return undefined;
};

/** setDoc({merge:true}) — 맵은 재귀 병합, 그 외는 덮어쓰기 */
const mergeInto = (target, src) => {
    for (const k of Object.keys(src)) {
        const v = src[k];
        if (kindOf(v) === 'delete') { delete target[k]; continue; }
        if (isPlainObject(v) && isPlainObject(target[k])) { mergeInto(target[k], v); continue; }
        if (isPlainObject(v)) { target[k] = {}; mergeInto(target[k], v); continue; }
        target[k] = resolveValue(v, target[k]);
    }
};

/** updateDoc — 키는 'a.b.c' 필드 경로, 값이 맵이면 그 자리를 통째로 바꾼다 */
const applyFieldPath = (target, path, v) => {
    const segs = path.split('.');
    let cur = target;
    for (let i = 0; i < segs.length - 1; i += 1) {
        if (!isPlainObject(cur[segs[i]])) cur[segs[i]] = {};
        cur = cur[segs[i]];
    }
    const last = segs[segs.length - 1];
    if (kindOf(v) === 'delete') { delete cur[last]; return; }
    if (isPlainObject(v)) { const o = {}; mergeInto(o, v); cur[last] = o; return; }
    cur[last] = resolveValue(v, cur[last]);
};

const getField = (data, path) => path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), data);

// ── 저장소 ─────────────────────────────────────────────────────────────────────
let store = new Map();

const load = () => {
    try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) { store = new Map(); return; }
        const obj = JSON.parse(raw, (k, v) => (v && typeof v === 'object' && typeof v.__ts === 'number' ? Timestamp.fromMillis(v.__ts) : v));
        store = new Map(Object.entries(obj));
    } catch { store = new Map(); }
};
const save = () => {
    try { localStorage.setItem(PERSIST_KEY, JSON.stringify(Object.fromEntries(store))); } catch { /* 용량 초과 등 */ }
};
load();

// ── 참조 ───────────────────────────────────────────────────────────────────────
const db = { type: 'firestore', app: null, _sim: true };
const joinPath = (...segs) => segs.filter((s) => s !== '' && s != null).join('/');
const autoId = () => Array.from({ length: 20 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');

const collectionRef = (path) => ({ type: 'collection', path, id: path.split('/').pop(), firestore: db });
const docRef = (path) => {
    const segs = path.split('/');
    return { type: 'document', path, id: segs[segs.length - 1], parent: collectionRef(segs.slice(0, -1).join('/')), firestore: db };
};
const basePath = (parent) => (parent === db || parent?.type === 'firestore' ? '' : parent.path);

export const initializeFirestore = (app) => { db.app = app; return db; };
export const getFirestore = () => db;
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const memoryLocalCache = () => ({});
export const disableNetwork = async () => {};
// 실제 SDK는 네트워크를 다시 켜면 서버 스냅샷을 한 번 더 내려준다 — 연결 배너가 '다시 연결 중'에 머물지 않게
export const enableNetwork = async () => { refireAll(); };
export const connectFirestoreEmulator = () => {};

export const collection = (parent, ...segs) => collectionRef(joinPath(basePath(parent), ...segs));
export const doc = (parent, ...segs) => {
    if (parent?.type === 'collection' && segs.length === 0) segs = [autoId()];
    return docRef(joinPath(basePath(parent), ...segs));
};

export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit = (n) => ({ kind: 'limit', n });
export const query = (base, ...constraints) => ({
    type: 'query',
    path: base.path,
    constraints: [...(base.constraints || []), ...constraints],
});

// ── 조회 ───────────────────────────────────────────────────────────────────────
const matchesWhere = (data, { field, op, value }) => {
    const v = getField(data, field);
    switch (op) {
        case '==': return sameValue(v, value);
        case '!=': return !sameValue(v, value);
        case '<': return v < value;
        case '<=': return v <= value;
        case '>': return v > value;
        case '>=': return v >= value;
        case 'in': return (value || []).some((x) => sameValue(x, v));
        case 'not-in': return !(value || []).some((x) => sameValue(x, v));
        case 'array-contains': return Array.isArray(v) && v.some((x) => sameValue(x, value));
        case 'array-contains-any': return Array.isArray(v) && v.some((x) => (value || []).some((y) => sameValue(x, y)));
        default: throw new Error(`[sim] 지원하지 않는 where 연산자: ${op}`);
    }
};

const docsInCollection = (path) => {
    const out = [];
    for (const [p, data] of store) {
        if (!p.startsWith(`${path}/`)) continue;
        if (p.slice(path.length + 1).includes('/')) continue; // 하위 컬렉션 제외
        out.push([p, data]);
    }
    return out;
};

const makeDocSnap = (ref, data) => ({
    id: ref.id,
    ref,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : clone(data)),
    get: (f) => (data === undefined ? undefined : clone(getField(data, f))),
    metadata: { fromCache: false, hasPendingWrites: false },
});

const runQuery = (q) => {
    const path = q.type === 'collection' ? q.path : q.path;
    const constraints = q.constraints || [];
    let rows = docsInCollection(path).filter(([, data]) => constraints.filter((c) => c.kind === 'where').every((c) => matchesWhere(data, c)));
    constraints.filter((c) => c.kind === 'orderBy').forEach((c) => {
        rows.sort(([, a], [, b]) => {
            const va = getField(a, c.field), vb = getField(b, c.field);
            const cmp = va < vb ? -1 : va > vb ? 1 : 0;
            return c.dir === 'desc' ? -cmp : cmp;
        });
    });
    const lim = constraints.find((c) => c.kind === 'limit');
    if (lim) rows = rows.slice(0, lim.n);
    const docs = rows.map(([p, data]) => makeDocSnap(docRef(p), data));
    return {
        docs, size: docs.length, empty: docs.length === 0,
        forEach: (cb) => docs.forEach(cb),
        docChanges: () => docs.map((d) => ({ type: 'added', doc: d })),
        metadata: { fromCache: false, hasPendingWrites: false },
    };
};

export const getDoc = async (ref) => makeDocSnap(ref, store.get(ref.path));
export const getDocs = async (q) => runQuery(q);

// ── 리스너 ─────────────────────────────────────────────────────────────────────
const listeners = new Set();
let pendingChanged = null;

const flushNotify = () => {
    const changed = pendingChanged; pendingChanged = null;
    if (!changed) return;
    const changedCols = new Set([...changed].map((p) => p.split('/').slice(0, -1).join('/')));
    listeners.forEach((l) => {
        const hit = l.target.type === 'document' ? changed.has(l.target.path) : changedCols.has(l.target.path);
        if (!hit) return;
        try { l.onNext(l.target.type === 'document' ? makeDocSnap(l.target, store.get(l.target.path)) : runQuery(l.target)); }
        catch (e) { console.error('[sim] 리스너 오류', e); }
    });
};
const notify = (paths) => {
    if (!pendingChanged) { pendingChanged = new Set(); setTimeout(flushNotify, 0); }
    paths.forEach((p) => pendingChanged.add(p));
};

const refireAll = () => {
    listeners.forEach((l) => {
        try { l.onNext(l.target.type === 'document' ? makeDocSnap(l.target, store.get(l.target.path)) : runQuery(l.target)); }
        catch (e) { console.error('[sim] 리스너 오류', e); }
    });
};

export const onSnapshot = (target, a, b, c) => {
    const onNext = typeof a === 'function' ? a : b;
    const onError = typeof a === 'function' ? b : c;
    const l = { target, onNext, onError };
    listeners.add(l);
    setTimeout(() => {
        if (!listeners.has(l)) return;
        try { onNext(target.type === 'document' ? makeDocSnap(target, store.get(target.path)) : runQuery(target)); }
        catch (e) { if (onError) onError(e); else console.error('[sim] 리스너 오류', e); }
    }, 0);
    return () => listeners.delete(l);
};

// ── 쓰기 ───────────────────────────────────────────────────────────────────────
const fsError = (code, message) => Object.assign(new Error(message), { code });

const writeSet = (ref, data, options) => {
    const prev = store.get(ref.path);
    if (options?.merge && prev) { const next = clone(prev); mergeInto(next, data); store.set(ref.path, next); }
    else { const next = {}; mergeInto(next, data); store.set(ref.path, next); }
};
const writeUpdate = (ref, data) => {
    const prev = store.get(ref.path);
    if (!prev) throw fsError('not-found', `No document to update: ${ref.path}`);
    const next = clone(prev);
    Object.keys(data).forEach((k) => applyFieldPath(next, k, data[k]));
    store.set(ref.path, next);
};
const writeDelete = (ref) => { store.delete(ref.path); };

const commitWrites = (writes) => {
    // 다른 탭이 방금 쓴 내용 위에 적용한다 (탭마다 메모리 사본이 있으므로, 통째로 저장하기 전에
    // 최신 상태를 다시 읽지 않으면 다른 탭의 쓰기를 되돌려 버린다 — 실제 Firestore에는 없는 현상)
    load();
    // 트랜잭션/배치는 전부 성공하거나 전부 실패한다 — 먼저 복사본에서 검증한 뒤 적용
    const backup = new Map(store);
    try {
        writes.forEach((w) => {
            if (w.op === 'set') writeSet(w.ref, w.data, w.options);
            else if (w.op === 'update') writeUpdate(w.ref, w.data);
            else writeDelete(w.ref);
        });
    } catch (e) { store = backup; throw e; }
    save();
    notify(writes.map((w) => w.ref.path));
};

export const setDoc = async (ref, data, options) => commitWrites([{ op: 'set', ref, data, options }]);
export const updateDoc = async (ref, data) => commitWrites([{ op: 'update', ref, data }]);
export const deleteDoc = async (ref) => commitWrites([{ op: 'delete', ref }]);
export const addDoc = async (col, data) => { const ref = doc(col); commitWrites([{ op: 'set', ref, data }]); return ref; };

export const writeBatch = () => {
    const writes = [];
    const batch = {
        set: (ref, data, options) => { writes.push({ op: 'set', ref, data, options }); return batch; },
        update: (ref, data) => { writes.push({ op: 'update', ref, data }); return batch; },
        delete: (ref) => { writes.push({ op: 'delete', ref }); return batch; },
        commit: async () => { commitWrites(writes); },
    };
    return batch;
};

export const runTransaction = async (_db, updateFunction) => {
    load(); // 트랜잭션은 항상 최신 문서를 읽는다
    const writes = [];
    const tx = {
        get: async (ref) => makeDocSnap(ref, store.get(ref.path)),
        set: (ref, data, options) => { writes.push({ op: 'set', ref, data, options }); return tx; },
        update: (ref, data) => { writes.push({ op: 'update', ref, data }); return tx; },
        delete: (ref) => { writes.push({ op: 'delete', ref }); return tx; },
    };
    const result = await updateFunction(tx);
    commitWrites(writes);
    return result;
};

// ── 다른 탭과 동기화 + 콘솔 도구 ───────────────────────────────────────────────
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key !== PERSIST_KEY) return;
        const before = new Map(store);
        load();
        const changed = new Set();
        new Set([...before.keys(), ...store.keys()]).forEach((p) => { if (!sameValue(before.get(p), store.get(p))) changed.add(p); });
        if (changed.size) notify([...changed]);
    });
    window.__sim = {
        dump: () => Object.fromEntries([...store].map(([p, d]) => [p, clone(d)])),
        get: (path) => clone(store.get(path)),
        set: (path, data, merge = true) => commitWrites([{ op: 'set', ref: docRef(path), data, options: { merge } }]),
        delete: (path) => commitWrites([{ op: 'delete', ref: docRef(path) }]),
        reset: () => { const paths = [...store.keys()]; store = new Map(); save(); notify(paths); },
    };
    console.info('%c[SIM] 가짜 Firestore 사용 중 — 실제 서버에는 아무것도 저장되지 않습니다', 'color:#CDFB47;font-weight:bold');
}
