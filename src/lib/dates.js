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
