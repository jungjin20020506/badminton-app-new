import { useEffect, useRef } from 'react';
import { isRestExpired, resumeFromRest } from '../lib/rest';
import { log } from '../lib/logger';
import { toastSuccess } from '../lib/toast';

// ===================================================================================
// [휴식 타이머] 시간이 지나면 자동 복귀
// -----------------------------------------------------------------------------------
//  ① 본인: restUntil 에 맞춰 타이머를 걸고, 지나면 복귀 + 토스트 "휴식이 끝나 복귀했어요"
//     (앱이 꺼져 있다가 다시 켜져도 restUntil 이 이미 지났으면 즉시 복귀)
//  ② 관리자 기기: 다른 선수 중 시간이 지난 휴식자를 30초마다 찾아 복귀시킨다
//     (본인 폰이 꺼져 있어도 현황판이 맞게 유지된다)
// ===================================================================================
export function useRestTimer({ currentUser, activePlayers, isAdmin }) {
    const busyRef = useRef(new Set());

    // ① 본인
    useEffect(() => {
        if (!currentUser?.id || currentUser.isGhostAdmin || !currentUser.isResting || !currentUser.restUntil) return undefined;
        const until = new Date(currentUser.restUntil).getTime();
        if (Number.isNaN(until)) return undefined;
        const delay = Math.max(0, until - Date.now()) + 300;
        const t = setTimeout(async () => {
            try {
                await resumeFromRest(currentUser.id);
                toastSuccess('☕ 휴식이 끝나 경기에 복귀했어요');
            } catch (e) {
                log.warn('[휴식 타이머] 자동 복귀 실패', e);
            }
        }, delay);
        return () => clearTimeout(t);
    }, [currentUser?.id, currentUser?.isGhostAdmin, currentUser?.isResting, currentUser?.restUntil]);

    // ② 관리자 기기에서 다른 사람 정리
    useEffect(() => {
        if (!isAdmin) return undefined;
        const tick = () => {
            const now = Date.now();
            Object.values(activePlayers || {}).forEach(async (p) => {
                if (!isRestExpired(p, now) || busyRef.current.has(p.id)) return;
                if (currentUser && p.id === currentUser.id) return; // 본인은 ① 이 처리
                busyRef.current.add(p.id);
                try {
                    await resumeFromRest(p.id);
                    log.info('[휴식 타이머] 시간 만료로 복귀 처리:', p.name);
                } catch (e) {
                    log.warn('[휴식 타이머] 복귀 처리 실패', p.name, e);
                } finally {
                    busyRef.current.delete(p.id);
                }
            });
        };
        tick();
        const id = setInterval(tick, 30 * 1000);
        return () => clearInterval(id);
    }, [isAdmin, activePlayers, currentUser]);
}
