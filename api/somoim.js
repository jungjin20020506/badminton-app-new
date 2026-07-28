// ===================================================================================
// Vercel Serverless Function: GET /api/somoim
// -----------------------------------------------------------------------------------
// 브라우저는 CORS 때문에 소모임 페이지를 직접 읽을 수 없으므로, Vercel 서버가
// 대신 가져와(RSC:1 헤더) 파싱한 JSON을 돌려준다.
//   성공: { ok:true, fetchedAt, gid, members:[...], events:[...] }
//   실패: { ok:false, code, message }  (HTTP 502)
// ===================================================================================
import { fetchAndParseSomoim, DEFAULT_GID, SomoimError } from './_lib/somoimParser.js';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
        res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'GET만 지원합니다.' });
        return;
    }
    const gid = (req.query && req.query.gid) || DEFAULT_GID;
    try {
        const { members, events } = await fetchAndParseSomoim(gid);
        res.status(200).json({
            ok: true,
            fetchedAt: new Date().toISOString(),
            gid,
            memberCount: members.length,
            members,
            events,
        });
    } catch (e) {
        const code = e instanceof SomoimError ? e.code : 'UNKNOWN';
        console.error('[somoim api]', code, e.message);
        res.status(502).json({ ok: false, code, message: e.message });
    }
}
