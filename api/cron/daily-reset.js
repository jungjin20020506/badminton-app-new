// ===================================================================================
// Vercel Cron: 새벽 2시 하루 초기화 (서버 버전)
// -----------------------------------------------------------------------------------
// 지금까지는 "그날 처음 앱을 연 기기"가 초기화를 돌렸다 (src/lib/firebase.js의
// runDailyResetIfDue). 그 방식은 그대로 남겨 두되(안전망), 이 함수가 매일 02:05 KST에
// 먼저 돌아서 첫 접속자의 화면 지연과 리더 선출을 없앤다.
// 두 쪽 모두 gameState.lastDailyResetKey 를 비교하므로 두 번 실행되지 않는다.
//
// vercel.json → "crons": [{ "path": "/api/cron/daily-reset", "schedule": "5 17 * * *" }]
// (Vercel 크론 시각은 UTC. 17:05 UTC = 02:05 KST)
// 필요한 환경변수: FIREBASE_SERVICE_ACCOUNT, CRON_SECRET (README 참고)
// ===================================================================================
import { getAdminDb, FieldValue, authorizeCron, commitInChunks, AdminConfigError } from '../_lib/firebaseAdmin.js';
import { getDailyResetKey } from '../../src/lib/dates.js';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const auth = authorizeCron(req);
    if (!auth.ok) { res.status(auth.status).json({ ok: false, message: auth.message }); return; }

    try {
        const db = getAdminDb();
        const gsRef = db.doc('gameState/live');
        const todayKey = getDailyResetKey(new Date()); // 서버 시각 기준 — 기기 시계 오류 없음

        // 1) 운영일 키 선점 + 경기방 비우기 (클라이언트 구현과 동일한 규칙: 뒤 날짜로만 진행)
        const won = await db.runTransaction(async (tx) => {
            const snap = await tx.get(gsRef);
            const gs = snap.exists ? snap.data() : {};
            if (gs.lastDailyResetKey && gs.lastDailyResetKey >= todayKey) return false;
            const numCourts = gs.numInProgressCourts || 4;
            tx.set(gsRef, {
                // 문서가 처음 만들어지는 경우에도 코트 수·예정 경기 수가 비지 않게 (없으면 앱이 코트 0개로 그려진다)
                numInProgressCourts: numCourts,
                numScheduledMatches: gs.numScheduledMatches || 4,
                lastDailyResetKey: todayKey,
                inProgressCourts: Array(numCourts).fill(null),
                scheduledMatches: {},
                autoMatches: {},
                teamScores: { blue: 0, white: 0 },
            }, { merge: true });
            return true;
        });
        if (!won) { res.status(200).json({ ok: true, skipped: true, key: todayKey, reason: '이미 초기화됨' }); return; }

        // 2) 모든 선수 내보내기 + 오늘 기록 삭제
        const snapshot = await db.collection('players').get();
        const count = await commitInChunks(db, snapshot.docs.map((d) => (batch) => batch.update(d.ref, {
            status: 'inactive',
            isResting: false,
            restUntil: FieldValue.delete(),
            todayWins: 0,
            todayLosses: 0,
            todayWinStreakCount: 0,
            todayRecentGames: [],
        })));

        await db.collection('logs').add({
            action: '새벽초기화',
            detail: { key: todayKey, count, by: 'vercel-cron' },
            byPlayerId: null,
            userAgent: 'vercel-cron',
            at: FieldValue.serverTimestamp(),
            atLocal: new Date().toISOString(),
        });

        res.status(200).json({ ok: true, key: todayKey, count });
    } catch (e) {
        const status = e instanceof AdminConfigError ? 501 : 500;
        console.error('[cron daily-reset]', e);
        res.status(status).json({ ok: false, code: e.code || 'UNKNOWN', message: e.message });
    }
}
