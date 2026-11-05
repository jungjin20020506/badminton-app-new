// ===================================================================================
// [휴식 타이머] 휴식 시작/복귀 쓰기 + 남은 시간 계산
// -----------------------------------------------------------------------------------
// players/{id}.isResting 에 더해 restUntil(ISO)이 있으면 그 시각이 지났을 때
//   · 본인 기기(useRestTimer)가 자동으로 복귀시킨다
//   · 본인 기기가 꺼져 있으면 관리자 기기 또는 서버 크론(repair-queues)이 복귀시킨다
// 시간을 정하지 않고 쉬면 restUntil 이 없고, 예전처럼 직접 복귀 버튼을 눌러야 한다.
// ===================================================================================
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { playersRef } from './firebase';

/** @param {number|null} minutes null 이면 시간 제한 없음 */
export async function startRest(playerId, minutes) {
    const restUntil = minutes ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
    await updateDoc(doc(playersRef, playerId), {
        isResting: true,
        restUntil: restUntil || deleteField(),
    });
}

export async function resumeFromRest(playerId) {
    await updateDoc(doc(playersRef, playerId), { isResting: false, restUntil: deleteField() });
}

/** 휴식 종료 시각(ms). 없으면 null */
export const restUntilMs = (player) => {
    if (!player?.isResting || !player?.restUntil) return null;
    const t = new Date(player.restUntil).getTime();
    return Number.isNaN(t) ? null : t;
};

/** 남은 분 (올림). 시간 제한이 없으면 null, 이미 지났으면 0 */
export const restRemainingMin = (player, now = Date.now()) => {
    const until = restUntilMs(player);
    if (until === null) return null;
    return Math.max(0, Math.ceil((until - now) / 60000));
};

export const isRestExpired = (player, now = Date.now()) => {
    const until = restUntilMs(player);
    return until !== null && until <= now;
};
