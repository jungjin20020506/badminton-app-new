// ===================================================================================
// [서버] Firebase Admin SDK 초기화 — Vercel 서버리스 함수(api/cron/*)에서 쓴다
// -----------------------------------------------------------------------------------
// 환경변수 FIREBASE_SERVICE_ACCOUNT 에 서비스 계정 JSON 전체를 한 줄로 넣는다.
//   Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성 → 내용 복사
//   Vercel → Settings → Environment Variables → FIREBASE_SERVICE_ACCOUNT (Production)
// 키가 없으면 함수는 501로 "설정 필요"를 돌려주고 아무것도 하지 않는다 (안전 실패).
// ===================================================================================
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export class AdminConfigError extends Error {
    constructor(message) { super(message); this.code = 'ADMIN_NOT_CONFIGURED'; }
}

export function getAdminDb() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new AdminConfigError('FIREBASE_SERVICE_ACCOUNT 환경변수가 없습니다. README의 "서버 크론 설정"을 참고하세요.');
    if (getApps().length === 0) {
        let sa;
        try { sa = JSON.parse(raw); } catch { throw new AdminConfigError('FIREBASE_SERVICE_ACCOUNT 값이 JSON이 아닙니다.'); }
        // Vercel 환경변수에 넣으면 개행이 \\n 으로 들어오는 경우가 있다
        if (typeof sa.private_key === 'string') sa.private_key = sa.private_key.replace(/\\n/g, '\n');
        initializeApp({ credential: cert(sa), projectId: sa.project_id });
    }
    return getFirestore();
}

export { FieldValue };

/**
 * Vercel Cron 인증. CRON_SECRET 환경변수를 두면 Vercel이 Authorization: Bearer <secret>
 * 헤더를 붙여 호출한다. 외부 스케줄러(cron-job.org 등)로 부를 때도 같은 헤더를 쓰면 된다.
 * 시크릿이 없으면 아무도 호출할 수 없게 막는다.
 */
export function authorizeCron(req) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return { ok: false, status: 501, message: 'CRON_SECRET 환경변수가 없습니다. README의 "서버 크론 설정"을 참고하세요.' };
    const auth = req.headers?.authorization || '';
    if (auth !== `Bearer ${secret}`) return { ok: false, status: 401, message: '인증 실패' };
    return { ok: true };
}

/** 400개 단위로 배치 커밋 (Firestore 배치 한도 500) */
export async function commitInChunks(db, writes, chunk = 400) {
    let batch = db.batch();
    let n = 0;
    for (const w of writes) {
        w(batch);
        n += 1;
        if (n % chunk === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (n % chunk !== 0) await batch.commit();
    return n;
}
