// ===================================================================================
// [날짜] 한국시간(KST) 기준 날짜 계산 — 브라우저와 서버(Vercel 함수) 양쪽에서 쓴다
// -----------------------------------------------------------------------------------
// 이 파일은 브라우저 API를 쓰지 않는 순수 함수만 둔다. (api/cron/* 에서도 import)
// ===================================================================================
import { KST } from './constants.js';

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 새벽 2시(KST)를 하루의 경계로 보는 '운영일 키'(YYYY-MM-DD).
 * UTC 시각에 +7시간(KST +9에서 초기화 기준 2시를 뺀 값)을 더한 뒤 날짜를 취하면
 * 새벽 2시 이전이면 전날, 이후면 당일 날짜가 자연스럽게 나온다.
 * @param {Date} [now]
 */
export const getDailyResetKey = (now = new Date()) => {
    const shiftHours = 9 - KST.dailyResetHour;
    const shifted = new Date(now.getTime() + shiftHours * 60 * 60 * 1000);
    return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
};

/**
 * KST 기준 현재 시각 정보 (정모 날짜 비교는 '실제 날짜' 기준 — 새벽 2시 경계와 무관)
 * @param {Date} [now]
 * @returns {{dateNumber:number, dateKey:string, hour:number}}
 */
export const getKstParts = (now = new Date()) => {
    const s = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return {
        dateNumber: s.getUTCFullYear() * 10000 + (s.getUTCMonth() + 1) * 100 + s.getUTCDate(), // YYYYMMDD
        dateKey: `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`,
        hour: s.getUTCHours(),
    };
};

/**
 * [대기 시간 초기화] now 기준으로 가장 최근에 지난 저녁 7시(KST)의 시각(ms).
 * 운동은 저녁 7시에 시작하므로, 일찍 온 선수의 "입장 후 기다린 시간"이 시작 전부터
 * 쌓이지 않게 모든 선수의 대기 시간을 이 시각부터 다시 센다.
 *  · 19:00 이전(예: 18:30)이면 '어제 19:00' — 오늘 입장한 선수에겐 아무 영향 없음
 *  · 19:00 이후(예: 20:10)면 '오늘 19:00'
 * @param {number|Date} [now]
 * @returns {number} ms
 */
export const getWaitResetAt = (now = Date.now()) => {
    const ms = now instanceof Date ? now.getTime() : now;
    const KST_OFFSET = 9 * 60 * 60 * 1000;
    const kst = new Date(ms + KST_OFFSET);
    const resetKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), KST.waitResetHour);
    const resetAt = resetKst - KST_OFFSET;
    return resetAt <= ms ? resetAt : resetAt - 24 * 60 * 60 * 1000;
};

/**
 * [대기 시간 초기화] 대기 시간을 세기 시작할 시각(ms).
 * 마지막 경기 종료(또는 입장) 시각과 가장 최근 저녁 7시 중 더 늦은 쪽.
 * 시각이 없거나 잘못됐으면 null (= 대기 시간 0분으로 본다).
 * @param {string|number|Date|null|undefined} timestamp 마지막 경기 종료 시각 또는 입장 시각
 * @param {number} [now]
 * @returns {number|null} ms
 */
export const getWaitStartAt = (timestamp, now = Date.now()) => {
    if (!timestamp) return null;
    const ms = new Date(timestamp).getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.max(ms, getWaitResetAt(now));
};
