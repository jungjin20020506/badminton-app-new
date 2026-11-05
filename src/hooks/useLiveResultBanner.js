import { useEffect, useRef, useState } from 'react';
import { TEAM_BLUE, TEAM_META } from '../lib/helpers';

// ===================================================================================
// [청백전] 득점 실황 배너 + 화면 가장자리 플래시
// -----------------------------------------------------------------------------------
//  경기 종료 트랜잭션이 gameState.lastTeamResult 를 갱신하면, 모든 접속자 화면에서
//  "🔵 청팀 득점! 이동준·주재운 (2번 코트)" 배너가 3초간 스쳐 가고 화면 테두리가
//  팀 색으로 0.45초 번쩍인다. 접속 직후 이미 있던 결과(과거 것)는 재생하지 않는다.
// ===================================================================================
export function useLiveResultBanner(lastTeamResult, teamMode, allPlayers) {
    const [liveBanner, setLiveBanner] = useState(null);
    const [edgeFlash, setEdgeFlash] = useState(null);
    const lastSeenRef = useRef(undefined);
    const timersRef = useRef({ banner: null, edge: null });

    useEffect(() => {
        const r = lastTeamResult;
        const at = r?.at || '';
        if (lastSeenRef.current === undefined) { lastSeenRef.current = at; return; } // 첫 로드: 재생 안 함
        if (at === lastSeenRef.current) return;
        lastSeenRef.current = at;
        if (!teamMode || !r || !at) return;
        if (Date.now() - new Date(at).getTime() > 30 * 1000) return; // 오래된 결과(오프라인 복귀 등)는 건너뛴다
        const nameOf = (id) => allPlayers?.[id]?.name || '';
        const winners = (r.winners || []).map(nameOf).filter(Boolean).join('·');
        const key = r.winnerTeam ? TEAM_META[r.winnerTeam].key : 'none';
        setLiveBanner({
            id: at, key,
            title: r.winnerTeam ? `${r.winnerTeam === TEAM_BLUE ? '🔵' : '⚪'} ${TEAM_META[r.winnerTeam].label} 득점!` : '🏁 경기 종료',
            body: `${winners || '승리'} · ${(r.courtIndex ?? 0) + 1}번 코트`,
        });
        setEdgeFlash({ id: at, key });
        clearTimeout(timersRef.current.banner);
        clearTimeout(timersRef.current.edge);
        timersRef.current.banner = setTimeout(() => setLiveBanner(null), 3200);
        timersRef.current.edge = setTimeout(() => setEdgeFlash(null), 600);
    }, [lastTeamResult, teamMode, allPlayers]);

    useEffect(() => () => { clearTimeout(timersRef.current.banner); clearTimeout(timersRef.current.edge); }, []);

    return { liveBanner, edgeFlash, clearLiveBanner: () => setLiveBanner(null) };
}
