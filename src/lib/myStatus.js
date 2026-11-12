// ===================================================================================
// [선수 화면] "나는 지금 어떤 상태인가" — 순수 계산 (화면과 무관, 테스트 가능)
// -----------------------------------------------------------------------------------
//  kind: 'resting' | 'playing' | 'queued' | 'waiting'
//   · resting : 휴식 중 (매칭에서 빠짐)
//   · playing : 지금 코트에서 경기 중 — 몇 번 코트, 몇 분째, 누구와
//   · queued  : 자동 매칭 / 경기 예정 목록에 이름이 올라감 — 몇 번째, 누구와,
//               경기중인 동료가 있으면 어느 코트가 끝나야 하는지와 예상 분
//   · waiting : 대기 명단 — 기다린 지 몇 분
//  공통: gamesToday(오늘 경기 수), waitMin(마지막 경기 끝난 뒤 지난 분 — 저녁 7시 KST 이후부터만 센다)
// ===================================================================================
import { getWaitStartAt } from './dates.js';

/** 배드민턴 한 경기가 보통 몇 분 걸리는지 (매칭 엔진과 같은 값) */
const TYPICAL_GAME_MIN = 15;

function minutesSince(timestamp, now) {
    if (!timestamp) return 0;
    const ms = new Date(timestamp).getTime();
    if (!Number.isFinite(ms)) return 0;
    return Math.max(0, (now - ms) / 60000);
}

/**
 * 4칸 배열을 "내 편 / 상대 편"으로 나눈다. (왼쪽 2칸 = A, 오른쪽 2칸 = B)
 * @param {Array<string|null>} ids
 * @param {string} meId
 */
function splitLineup(ids, meId) {
    const a = [ids[0] ?? null, ids[1] ?? null];
    const b = [ids[2] ?? null, ids[3] ?? null];
    const meInA = a.includes(meId);
    const mine = meInA ? a : b;
    const theirs = meInA ? b : a;
    return {
        mySide: meInA ? 'A' : 'B',
        partners: mine.filter((id) => id !== meId),
        opponents: theirs,
    };
}

/**
 * @param {object} params
 * @param {object} params.me            내 선수 문서
 * @param {object} params.gameState     gameState/live
 * @param {object} params.activePlayers 활성 선수 맵 (id → player)
 * @param {number} [params.now]
 */
function getMyStatus({ me, gameState, activePlayers, now = Date.now() }) {
    const games = Array.isArray(me?.todayRecentGames) ? me.todayRecentGames : [];
    // [대기 시간 초기화] 저녁 7시(KST) 이전 시각은 7시로 끌어올린다 — 매칭 엔진과 같은 규칙
    const lastTs = getWaitStartAt(games[0]?.timestamp || me?.entryTime, now);
    const base = {
        gamesToday: games.length,
        waitMin: Math.round(minutesSince(lastTs, now)),
    };
    if (!me || !me.id) return { kind: 'waiting', ...base };

    if (me.isResting) return { kind: 'resting', ...base };

    const courts = Array.isArray(gameState?.inProgressCourts) ? gameState.inProgressCourts : [];
    const courtOf = {};
    courts.forEach((c, i) => {
        if (c && Array.isArray(c.players)) c.players.forEach((id) => { if (id) courtOf[id] = i; });
    });

    if (courtOf[me.id] !== undefined) {
        const courtIndex = courtOf[me.id];
        const court = courts[courtIndex];
        return {
            kind: 'playing',
            courtIndex,
            startTime: court.startTime || null,
            elapsedMin: Math.floor(minutesSince(court.startTime, now)),
            ids: [0, 1, 2, 3].map((i) => court.players[i] || null),
            lineup: splitLineup(court.players, me.id),
            ...base,
            waitMin: 0,
        };
    }

    const numCourts = Number.isInteger(gameState?.numInProgressCourts) && gameState.numInProgressCourts > 0
        ? gameState.numInProgressCourts : courts.length;
    let freeCourt = false;
    for (let i = 0; i < numCourts; i += 1) if (!courts[i]) freeCourt = true;

    const queued = (queueType, queueIndex, m) => {
        const ids = [0, 1, 2, 3].map((i) => m[i] || null);
        const onCourtIds = ids.filter((id) => id && courtOf[id] !== undefined);
        const waitCourts = [...new Set(onCourtIds.map((id) => courtOf[id]))].sort((x, y) => x - y);
        const waitEstimateMin = onCourtIds.length
            ? Math.max(...onCourtIds.map((id) => Math.max(0, TYPICAL_GAME_MIN - minutesSince(courts[courtOf[id]].startTime, now))))
            : 0;
        const missing = ids.filter((id) => !id).length;
        const brokenIds = ids.filter((id) => id && (!activePlayers?.[id] || activePlayers[id].isResting));
        return {
            kind: 'queued',
            queueType,
            queueIndex,
            ids,
            lineup: splitLineup(ids, me.id),
            onCourtIds,
            waitCourts,
            waitEstimateMin: Math.round(waitEstimateMin),
            missing,
            brokenIds,
            canStartNow: onCourtIds.length === 0 && missing === 0 && brokenIds.length === 0 && freeCourt,
            ...base,
        };
    };

    const auto = gameState?.autoMatches || {};
    const autoKeys = Object.keys(auto).sort((a, b) => Number(a) - Number(b));
    for (let i = 0; i < autoKeys.length; i += 1) {
        const m = auto[autoKeys[i]];
        if (Array.isArray(m) && m.includes(me.id)) return queued('auto', i, m);
    }
    const sched = gameState?.scheduledMatches || {};
    const schedKeys = Object.keys(sched).sort((a, b) => Number(a) - Number(b));
    for (const k of schedKeys) {
        const m = sched[k];
        if (Array.isArray(m) && m.includes(me.id)) return queued('schedule', Number(k), m);
    }

    return { kind: 'waiting', ...base };
}

/**
 * 예정 경기(자동 + 수동)를 화면에 보여줄 순서대로 정리한다. (선수 화면 '다음 경기' 목록)
 * 자동 매칭이 먼저(만든 순서), 그 다음 경기 예정(선수가 한 명이라도 있는 줄만).
 */
function listUpcomingMatches(gameState, activePlayers) {
    const courts = Array.isArray(gameState?.inProgressCourts) ? gameState.inProgressCourts : [];
    const courtOf = {};
    courts.forEach((c, i) => {
        if (c && Array.isArray(c.players)) c.players.forEach((id) => { if (id) courtOf[id] = i; });
    });
    const rows = [];
    const push = (type, index, m) => {
        const ids = [0, 1, 2, 3].map((i) => m[i] || null);
        if (ids.every((id) => !id)) return;
        const onCourtIds = ids.filter((id) => id && courtOf[id] !== undefined);
        const waitCourts = [...new Set(onCourtIds.map((id) => courtOf[id]))].sort((x, y) => x - y);
        const brokenIds = ids.filter((id) => id && (!activePlayers?.[id] || activePlayers[id].isResting));
        const missing = ids.filter((id) => !id).length;
        rows.push({ type, index, ids, onCourtIds, waitCourts, brokenIds, missing });
    };
    const auto = gameState?.autoMatches || {};
    Object.keys(auto).sort((a, b) => Number(a) - Number(b)).forEach((k, i) => { if (Array.isArray(auto[k])) push('auto', i, auto[k]); });
    const sched = gameState?.scheduledMatches || {};
    Object.keys(sched).sort((a, b) => Number(a) - Number(b)).forEach((k) => { if (Array.isArray(sched[k])) push('schedule', Number(k), sched[k]); });
    return rows;
}

// ===================================================================================
// [대기 시간 예측] "내 경기는 약 몇 분 뒤에 시작하나" — 코트를 하나씩 돌려 보는 시뮬레이션
// -----------------------------------------------------------------------------------
//  입력: 코트 수, 설정된 평균 경기 시간(분), 지금 경기중인 코트들의 시작 시각, 예정 경기 순서
//  방법:
//   ① 각 코트가 '언제 비는지'를 구한다 — 경기중이면 시작 시각 + 평균 경기 시간
//      (이미 그 시간을 넘긴 코트는 "30초 뒤" 로 본다 — 곧 끝난다는 뜻)
//   ② 예정 경기를 순서대로(자동 매칭 → 경기 예정) 하나씩 가장 먼저 비는 코트에 넣는다.
//      그 경기에 '아직 경기중인 선수'가 있으면 그 선수의 코트가 빌 때까지는 시작할 수 없다.
//      경기를 넣은 코트는 다시 '시작 + 평균 경기 시간' 뒤에 빈다.
//   ③ 그렇게 내 경기 차례가 오는 시각이 곧 예상 시작 시각이다.
//  대기 명단에만 있는 선수(아직 경기가 안 잡힌 사람)에게는 "예정 경기가 다 들어간 뒤
//  가장 먼저 비는 코트"까지의 시간을 돌려준다 — 관리자가 바로 다음 경기에 넣어 줄 때의 최단값.
// ===================================================================================
const DEFAULT_GAME_MIN = 8;

/** config/season.gameMinutes → 3~40분 사이의 숫자. 없거나 이상하면 기본 8분 */
function gameMinutesOf(seasonConfig) {
    const v = Number(seasonConfig?.gameMinutes);
    if (!Number.isFinite(v)) return DEFAULT_GAME_MIN;
    return Math.min(40, Math.max(3, Math.round(v)));
}

/**
 * @param {object} params
 * @param {object} params.gameState
 * @param {object} params.activePlayers
 * @param {number} [params.now]
 * @param {number} [params.gameMin]  평균 경기 시간(분)
 * @returns {{ byKey: Object<string, {startAt:number, courtIndex:number, waitMin:number}>, nextFreeAt:number|null, nextFreeMin:number|null, courtFreeAt:number[] }}
 */
function estimateSchedule({ gameState, activePlayers, now = Date.now(), gameMin = DEFAULT_GAME_MIN }) {
    const gameMs = Math.max(1, gameMin) * 60000;
    const courts = Array.isArray(gameState?.inProgressCourts) ? gameState.inProgressCourts : [];
    const numCourts = Number.isInteger(gameState?.numInProgressCourts) && gameState.numInProgressCourts > 0
        ? gameState.numInProgressCourts : courts.length;
    const courtFreeAt = [];
    const courtOf = {};
    for (let i = 0; i < numCourts; i += 1) {
        const c = courts[i];
        const busy = !!(c && Array.isArray(c.players) && c.players.some(Boolean));
        if (!busy) { courtFreeAt[i] = now; continue; }
        const start = new Date(c.startTime).getTime();
        const end = Number.isFinite(start) ? start + gameMs : now + gameMs;
        courtFreeAt[i] = Math.max(now + 30000, end);
        c.players.forEach((id) => { if (id) courtOf[id] = i; });
    }

    const byKey = {};
    if (numCourts > 0) {
        const rows = listUpcomingMatches(gameState, activePlayers);
        for (const r of rows) {
            const readyAt = Math.max(now, ...r.ids.filter((id) => id && courtOf[id] !== undefined).map((id) => courtFreeAt[courtOf[id]]));
            let best = 0;
            for (let i = 1; i < numCourts; i += 1) if (courtFreeAt[i] < courtFreeAt[best]) best = i;
            const startAt = Math.max(courtFreeAt[best], readyAt);
            byKey[`${r.type}:${r.index}`] = { startAt, courtIndex: best, waitMin: Math.max(0, Math.round((startAt - now) / 60000)) };
            courtFreeAt[best] = startAt + gameMs;
            r.ids.forEach((id) => { if (id) courtOf[id] = best; });
        }
    }
    const nextFreeAt = numCourts > 0 ? Math.min(...courtFreeAt) : null;
    return {
        byKey,
        nextFreeAt,
        nextFreeMin: nextFreeAt === null ? null : Math.max(0, Math.round((nextFreeAt - now) / 60000)),
        courtFreeAt,
    };
}

export { getMyStatus, splitLineup, listUpcomingMatches, estimateSchedule, gameMinutesOf, DEFAULT_GAME_MIN, TYPICAL_GAME_MIN };
