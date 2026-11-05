// ===================================================================================
// Vercel 함수: 막힌 예약 경기 정리 (서버 버전)
// -----------------------------------------------------------------------------------
// 예약 경기에 있던 선수가 나가거나 휴식으로 바뀌면 그 경기는 영원히 시작할 수 없고,
// 그 선수들은 '예약됨'으로 분류돼 새 매칭 후보에서도 빠진다 → 매칭이 통째로 멈춘다.
// 앱은 관리자 화면이 떠 있을 때만 이를 정리했다(App.jsx의 repair 효과). 관리자가
// 아무도 접속해 있지 않으면 정리되지 않았는데, 이 함수가 서버에서 같은 정리를 한다.
//
// 호출 방법 (둘 중 하나):
//  · Vercel Pro: vercel.json crons 에 "*/5 * * * *" 로 등록 (Hobby는 하루 1회 제한)
//  · 무료 외부 스케줄러(cron-job.org 등)에서 5분마다
//    GET https://<도메인>/api/cron/repair-queues  (헤더 Authorization: Bearer <CRON_SECRET>)
// 아무 문제가 없으면 아무것도 쓰지 않는다 (읽기 2회뿐).
// ===================================================================================
import { getAdminDb, FieldValue, authorizeCron, AdminConfigError } from '../_lib/firebaseAdmin.js';
import { repairMatchQueues } from '../../src/lib/helpers.js';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const auth = authorizeCron(req);
    if (!auth.ok) { res.status(auth.status).json({ ok: false, message: auth.message }); return; }

    try {
        const db = getAdminDb();
        const gsRef = db.doc('gameState/live');

        // 선수 전체(나간 선수 포함)를 읽어야 '못 뛰는 선수'를 판정할 수 있다
        const playersSnap = await db.collection('players').get();
        const allPlayers = {};
        playersSnap.forEach((d) => { allPlayers[d.id] = d.data(); });

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(gsRef);
            if (!snap.exists) return { changed: false };
            const { changed, newState, dissolvedCount, clearedNames } = repairMatchQueues(snap.data(), allPlayers);
            if (!changed) return { changed: false };
            tx.set(gsRef, newState);
            return { changed: true, dissolvedCount, clearedNames };
        });

        // [휴식 타이머] 시간이 지난 휴식자를 복귀시킨다 (본인 폰이 꺼져 있어도 현황판이 맞게)
        const now = Date.now();
        const expired = Object.entries(allPlayers).filter(([, p]) => p.status === 'active' && p.isResting && p.restUntil && new Date(p.restUntil).getTime() <= now);
        if (expired.length > 0) {
            const batch = db.batch();
            expired.forEach(([id]) => batch.update(db.doc(`players/${id}`), { isResting: false, restUntil: FieldValue.delete() }));
            await batch.commit();
            result.restResumed = expired.map(([, p]) => p.name);
        }

        if (result.changed) {
            await db.collection('logs').add({
                action: '예약경기정리',
                detail: { dissolvedCount: result.dissolvedCount, clearedNames: result.clearedNames, by: 'vercel-cron' },
                byPlayerId: null,
                userAgent: 'vercel-cron',
                at: FieldValue.serverTimestamp(),
                atLocal: new Date().toISOString(),
            });
        }
        res.status(200).json({ ok: true, ...result });
    } catch (e) {
        const status = e instanceof AdminConfigError ? 501 : 500;
        console.error('[cron repair-queues]', e);
        res.status(status).json({ ok: false, code: e.code || 'UNKNOWN', message: e.message });
    }
}
