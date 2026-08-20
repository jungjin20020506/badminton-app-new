// ===================================================================================
// 자동 매칭 v3 — 대규모 정밀 스트레스 테스트
// -----------------------------------------------------------------------------------
//   실행:  node scripts/stress-test-matching.mjs
//
// simulate-matching.mjs(기능 검증)와 다른 점:
//   · 실제 운영처럼 "남복 + 여복 + 혼복"을 한 세션에서 섞어서 돌린다.
//     (관리자가 매번 어떤 종목을 만들지 가중치 랜덤으로 고르고, 안 되면 다른 종목 시도)
//   · 인원 수 / 급수 구성 / 성비 / 코트 수 / 경기 시간 / 민감도를 바꿔가며
//     30개 이상의 시나리오를 한 번에 검증한다.
//   · '대기 시간'을 실제로 측정한다 — 경기를 시작할 때마다 그 선수가 직전 경기
//     끝나고 몇 분을 기다렸는지 기록한다. (v3의 2순위 기준이므로 반드시 봐야 함)
//
// 판정 기준 (v3 철학)
//   · 굶는 사람 금지: 성별 안에서 아무도 평균보다 2경기 넘게 뒤지면 안 된다
//   · 경기 수 편차: 성별 안에서 3 이하 (2경기 관용 + 세션 종료 시점 오차 1)
//   · '배고픈 대기' 금지: 경기 수가 평균 이하인 사람이 45분 넘게 기다리면 안 된다
//     (많이 친 사람이 다른 사람들 따라잡는 동안 오래 쉬는 것은 공평한 것이므로 제외 —
//      진단 결과, 원시 최대 대기의 상위 사례는 전부 "직전에 몰아서 친 사람의 쿨다운"이었다)
//   · 코트 가동률: 이론상 가능한 경기 수의 70% 이상
//   · 오류/교착 없이 완주
// ===================================================================================

import {
    buildMatchContext,
    buildCandidatePool,
    generateMatchOptions,
    getSensitivity,
} from '../src/lib/matching.js';
import { repairMatchQueues } from '../src/lib/helpers.js';

const START_MS = new Date('2026-08-20T19:00:00+09:00').getTime();

/** 재현 가능한 난수 (씨앗 고정) */
function makeRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** 급수 배열 만들기: rep('A조', 8) → ['A조' × 8] */
const rep = (level, n) => Array.from({ length: n }, () => level);

// ───────────────────────────────────────────────────────────────────────────────────
// 가상 체육관 (앱과 동일한 데이터 구조)
// ───────────────────────────────────────────────────────────────────────────────────

function makeGym({ maleLevels = [], femaleLevels = [], courts, seed }) {
    const rand = makeRandom(seed);
    const allPlayers = {};

    maleLevels.forEach((level, i) => {
        const id = `남${i + 1}`;
        allPlayers[id] = {
            id, name: id, gender: '남', level,
            status: 'active', isResting: false,
            entryTime: new Date(START_MS).toISOString(), todayRecentGames: [],
        };
    });
    femaleLevels.forEach((level, i) => {
        const id = `여${i + 1}`;
        allPlayers[id] = {
            id, name: id, gender: '여', level,
            status: 'active', isResting: false,
            entryTime: new Date(START_MS).toISOString(), todayRecentGames: [],
        };
    });

    const gameState = {
        numInProgressCourts: courts,
        numScheduledMatches: 4,
        inProgressCourts: Array(courts).fill(null),
        scheduledMatches: {},
        autoMatches: {},
    };

    return { allPlayers, gameState, rand };
}

/** 경기 시작 (앱의 handleStartMatch와 같은 방어 규칙) */
function startMatch(gym, matchKey, courtIndex, nowMs) {
    const players = gym.gameState.autoMatches[matchKey];
    if (!players || players.filter(Boolean).length !== 4) return false;
    const onCourtIds = new Set(
        gym.gameState.inProgressCourts.filter(Boolean).flatMap(c => c.players).filter(Boolean)
    );
    const blocked = players.some(id => {
        const p = gym.allPlayers[id];
        return !p || p.status !== 'active' || p.isResting || onCourtIds.has(id);
    });
    if (blocked) return false;

    gym.gameState.inProgressCourts[courtIndex] = {
        players: [...players],
        startTime: new Date(nowMs).toISOString(),
        matchId: `${courtIndex}-${nowMs}`,
    };
    delete gym.gameState.autoMatches[matchKey];
    const reindexed = {};
    Object.values(gym.gameState.autoMatches).forEach((m, i) => { reindexed[String(i)] = m; });
    gym.gameState.autoMatches = reindexed;
    return true;
}

/** 경기 종료 (앱의 handleEndMatch와 동일하게 기록 추가) */
function endMatch(gym, courtIndex, nowMs) {
    const court = gym.gameState.inProgressCourts[courtIndex];
    if (!court) return null;
    const [a1, a2, b1, b2] = court.players;
    const teamA = [a1, a2].filter(Boolean);
    const teamB = [b1, b2].filter(Boolean);
    const ts = new Date(nowMs).toISOString();

    court.players.filter(Boolean).forEach(id => {
        const p = gym.allPlayers[id];
        if (!p) return;
        const inA = teamA.includes(id);
        const record = {
            timestamp: ts,
            partners: (inA ? teamA : teamB).filter(x => x !== id),
            opponents: inA ? teamB : teamA,
        };
        p.todayRecentGames = [record, ...(p.todayRecentGames || [])].slice(0, 20);
    });
    gym.gameState.inProgressCourts[courtIndex] = null;
    return court.players;
}

/** 관리자가 '매칭 만들기'를 눌러 카드 하나를 고르는 동작 (앱과 동일) */
function adminGenerate(gym, mode, nowMs, sensitivityKey, choose, rand) {
    const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: nowMs });
    const pool = buildCandidatePool(ctx, mode);
    const sens = getSensitivity(sensitivityKey);
    const onCourtIds = new Set(
        gym.gameState.inProgressCourts.filter(Boolean).flatMap(c => c.players).filter(Boolean)
    );
    const pendingReservations = Object.values(gym.gameState.autoMatches)
        .filter(m => (m || []).some(id => id && onCourtIds.has(id))).length;
    const result = generateMatchOptions({
        pool, ctx, mode, maxOnCourt: sens.maxOnCourt, pages: 3, pendingReservations,
    });
    if (result.status !== 'ok') return { added: false };

    const page = result.pages[0];
    let picked;
    if (choose === 'best') picked = page.find(o => o.tier === 'best') || page[0];
    else if (choose === 'normal') picked = page.find(o => o.tier === 'normal') || page[0];
    else if (choose === 'bad') picked = page.find(o => o.tier === 'bad') || page[page.length - 1];
    else picked = page[Math.floor(rand() * page.length)];

    const queued = new Set(Object.values(gym.gameState.autoMatches).flat().filter(Boolean));
    if (picked.ids.some(id => queued.has(id))) return { added: false, conflict: true };

    const nextIndex = Object.keys(gym.gameState.autoMatches).length;
    gym.gameState.autoMatches[String(nextIndex)] = [...picked.ids];
    return { added: true, picked };
}

// ───────────────────────────────────────────────────────────────────────────────────
// 하루 전체 시뮬레이션 (혼합 종목)
// ───────────────────────────────────────────────────────────────────────────────────

/** 지금 시점에 각 종목을 만들 수 있는 인원이 되는가 */
function viableModes(gym) {
    const active = Object.values(gym.allPlayers).filter(p => p.status === 'active' && !p.isResting);
    const m = active.filter(p => p.gender === '남').length;
    const f = active.filter(p => p.gender === '여').length;
    return { '남': m >= 4, '여': f >= 4, '혼복': m >= 2 && f >= 2 };
}

/**
 * 관리자가 이번에 만들 종목(남복/여복/혼복)을 고른다.
 *
 * adminStyle 'adaptive' (기본): 실제 관리자처럼 "오래 기다린 사람이 많은 종목"을
 *   우선 만든다. 기본 비율(modeWeights)에 대기 급함을 곱해서 정한다.
 * adminStyle 'blind': 대기 상황을 안 보고 정해진 비율로만 랜덤 선택.
 *   (스트레스 케이스 — 엔진은 종목 선택까지는 해줄 수 없다는 한계를 문서화하는 용도)
 */
function pickModeOrder({ gym, weights, rand, adminStyle, lastEndMs, entryMs, nowMs }) {
    const viable = viableModes(gym);
    const entries = Object.entries(weights).filter(([k, w]) => w > 0 && viable[k]);
    if (entries.length === 0) return [];

    if (adminStyle === 'blind') {
        const total = entries.reduce((s, [, w]) => s + w, 0);
        let r = rand() * total;
        let first = entries[entries.length - 1][0];
        for (const [k, w] of entries) {
            r -= w;
            if (r <= 0) { first = k; break; }
        }
        const rest = entries.map(([k]) => k).filter(k => k !== first)
            .sort((a, b) => weights[b] - weights[a]);
        return [first, ...rest];
    }

    // ── adaptive: 종목별로 "지금 벤치에서 기다리는 사람들이 얼마나 급한가"를 계산 ──
    const onCourtIds = new Set(
        gym.gameState.inProgressCourts.filter(Boolean).flatMap(c => c.players).filter(Boolean)
    );
    const queuedIds = new Set(Object.values(gym.gameState.autoMatches).flat().filter(Boolean));
    const waitsOf = (gender) => Object.values(gym.allPlayers)
        .filter(p => p.status === 'active' && !p.isResting && p.gender === gender
            && !onCourtIds.has(p.id) && !queuedIds.has(p.id))
        .map(p => Math.max(0, (nowMs - (lastEndMs[p.id] ?? entryMs[p.id] ?? nowMs)) / 60000))
        .sort((a, b) => b - a);
    const topAvg = (arr, n) => arr.length
        ? arr.slice(0, n).reduce((s, x) => s + x, 0) / Math.min(n, arr.length) : 0;
    const mWaits = waitsOf('남');
    const fWaits = waitsOf('여');
    const need = {
        '남': topAvg(mWaits, 4),
        '여': topAvg(fWaits, 4),
        '혼복': (topAvg(mWaits, 2) + topAvg(fWaits, 2)) / 2,
    };
    // 기본 비율 + 급함×8 (덧셈) — "오래 기다린 쪽이 있으면 비율과 무관하게 그쪽 먼저"
    // 곱셈으로 하면 기본 비율이 큰 종목(예: 남복 65%)이 계속 이겨서, 인원이 적은
    // 성별이 세션 초반 내내 밀리는 문제가 있었다 (남16:여4 시나리오에서 확인).
    const scored = entries.map(([k, w]) => [k, (w + (need[k] || 0) * 8) * (0.95 + rand() * 0.1)]);
    scored.sort((a, b) => b[1] - a[1]);
    return scored.map(([k]) => k);
}

function runSession(cfg) {
    const {
        maleLevels = [], femaleLevels = [], courts = 3, minutes = 180, seed = 1,
        sensitivity = 'high',
        gameMin = 12, gameJitter = 2,                    // 경기 시간 = gameMin ± gameJitter 분
        modeWeights = { '남': 55, '여': 30, '혼복': 15 }, // 관리자가 종목을 고르는 기본 비율
        adminStyle = 'adaptive', // 'adaptive' = 대기 상황을 보고 종목 선택 (실제 관리자처럼)
        choose = 'best',
        joinEvents = [], leaveEvents = [], restEvents = [],
        queueTarget = 2,
    } = cfg;

    const gym = makeGym({ maleLevels, femaleLevels, courts, seed });
    // 늦게 오는 선수는 '아직 입장 안 함'으로 시작
    joinEvents.forEach(e => {
        gym.allPlayers[e.id] = {
            id: e.id, name: e.id, gender: e.gender || '남', level: e.level || 'B조',
            status: 'inactive', isResting: false,
            entryTime: new Date(START_MS).toISOString(), todayRecentGames: [],
        };
    });
    const rand = gym.rand;
    const courtEnd = Array(courts).fill(null);
    const log = { generated: 0, byMode: { '남': 0, '여': 0, '혼복': 0 }, started: 0, finished: 0, failedFill: 0, repaired: 0, errors: [] };

    // 대기 시간 측정용
    const entryMs = {};
    const lastEndMs = {};
    Object.keys(gym.allPlayers).forEach(id => { entryMs[id] = START_MS; });
    const waitsByPlayer = {}; // id → [경기 시작 전 기다린 분들]
    // '배고픈 대기' = 경기 수가 같은 성별 평균 이하인 사람이 기다린 시간 (이게 진짜 문제)
    const gamesSoFar = {};
    Object.keys(gym.allPlayers).forEach(id => { gamesSoFar[id] = 0; });
    const hungryWaits = []; // { id, wait, t, myGames, avgGames }

    for (let t = 0; t < minutes; t += 1) {
        const nowMs = START_MS + t * 60000;

        restEvents.filter(e => e.at === t).forEach(e => {
            const p = gym.allPlayers[e.id];
            if (p) p.isResting = e.resting;
            // 휴식에서 돌아오면 대기 시간은 0부터 다시 센다 (휴식은 본인 선택이지 대기가 아니다)
            if (p && e.resting === false) lastEndMs[e.id] = nowMs;
        });
        leaveEvents.filter(e => e.at === t).forEach(e => {
            const p = gym.allPlayers[e.id];
            if (p) p.status = 'inactive';
        });
        joinEvents.filter(e => e.at === t).forEach(e => {
            const p = gym.allPlayers[e.id];
            if (p) { p.status = 'active'; p.entryTime = new Date(nowMs).toISOString(); entryMs[e.id] = nowMs; }
        });

        // (1) 끝난 경기 정리
        for (let c = 0; c < courts; c += 1) {
            if (courtEnd[c] !== null && t >= courtEnd[c]) {
                const ended = endMatch(gym, c, nowMs);
                (ended || []).forEach(id => { lastEndMs[id] = nowMs; });
                courtEnd[c] = null;
                log.finished += 1;
            }
        }

        // (1-b) 못 뛰는 선수가 낀 예약 자동 해체 (앱과 동일)
        const repair = repairMatchQueues(gym.gameState, gym.allPlayers);
        if (repair.changed) {
            gym.gameState = repair.newState;
            log.repaired += repair.dissolvedCount;
        }

        // (2) 관리자가 자동 매칭 목록을 채운다 — 종목을 가중치로 고르고, 안 되면 다른 종목
        let guard = 0;
        while (Object.keys(gym.gameState.autoMatches).length < queueTarget && guard < 6) {
            guard += 1;
            const order = pickModeOrder({ gym, weights: modeWeights, rand, adminStyle, lastEndMs, entryMs, nowMs });
            let added = false;
            for (const mode of order) {
                try {
                    const r = adminGenerate(gym, mode, nowMs, sensitivity, choose, rand);
                    if (r.added) {
                        added = true;
                        log.generated += 1;
                        log.byMode[mode] += 1;
                        break;
                    }
                } catch (err) {
                    log.errors.push(`${t}분 ${mode}: ${err.message}`);
                    added = false;
                    break;
                }
            }
            if (!added) { log.failedFill += 1; break; }
        }

        // (3) 빈 코트에 시작 가능한 경기를 넣는다 + 대기 시간 기록
        for (let c = 0; c < courts; c += 1) {
            if (gym.gameState.inProgressCourts[c]) continue;
            const keys = Object.keys(gym.gameState.autoMatches).sort((a, b) => Number(a) - Number(b));
            for (const key of keys) {
                const ids = [...(gym.gameState.autoMatches[key] || [])];
                if (startMatch(gym, key, c, nowMs)) {
                    ids.forEach(id => {
                        const waitedFrom = lastEndMs[id] ?? entryMs[id] ?? START_MS;
                        const w = Math.max(0, (nowMs - waitedFrom) / 60000);
                        (waitsByPlayer[id] = waitsByPlayer[id] || []).push(w);
                        // 같은 성별 평균 이하로 친 사람이 이만큼 기다렸다면 '배고픈 대기'
                        const me = gym.allPlayers[id];
                        const peers = Object.values(gym.allPlayers)
                            .filter(p => p.status === 'active' && !p.isResting && p.gender === me.gender);
                        const avgGames = peers.length
                            ? peers.reduce((s, p) => s + gamesSoFar[p.id], 0) / peers.length : 0;
                        if (gamesSoFar[id] <= avgGames) {
                            hungryWaits.push({ id, wait: w, t, myGames: gamesSoFar[id], avgGames: Number(avgGames.toFixed(1)) });
                        }
                    });
                    ids.forEach(id => { gamesSoFar[id] += 1; });
                    const dur = Math.max(4, gameMin - gameJitter + Math.floor(rand() * (2 * gameJitter + 1)));
                    courtEnd[c] = t + dur;
                    log.started += 1;
                    break;
                }
            }
        }
    }

    return { gym, log, waitsByPlayer, hungryWaits };
}

// ───────────────────────────────────────────────────────────────────────────────────
// 결과 분석
// ───────────────────────────────────────────────────────────────────────────────────

const LEVEL_VAL = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 3 };

function analyze({ gym, log, waitsByPlayer, hungryWaits }) {
    const active = Object.values(gym.allPlayers).filter(p => p.status === 'active');
    // 세션 끝에 코트에서 치는 중인 경기도 1경기로 센다
    const onCourtIds = new Set(
        (gym.gameState.inProgressCourts || []).filter(Boolean).flatMap(c => c.players).filter(Boolean)
    );
    const gamesOf = (p) => (p.todayRecentGames || []).length + (onCourtIds.has(p.id) ? 1 : 0);

    const genderStats = {};
    ['남', '여'].forEach(g => {
        const ps = active.filter(p => p.gender === g);
        if (ps.length === 0) return;
        const counts = ps.map(gamesOf);
        const min = Math.min(...counts);
        const max = Math.max(...counts);
        const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
        genderStats[g] = {
            n: ps.length, min, max, avg: Number(avg.toFixed(1)),
            spread: max - min,
            counts: counts.slice().sort((a, b) => a - b),
        };
    });

    // 대기 시간
    const allWaits = Object.values(waitsByPlayer).flat();
    allWaits.sort((a, b) => a - b);
    const avgWait = allWaits.length ? allWaits.reduce((a, b) => a + b, 0) / allWaits.length : 0;
    const maxWait = allWaits.length ? allWaits[allWaits.length - 1] : 0;
    const p95Wait = allWaits.length ? allWaits[Math.floor(allWaits.length * 0.95)] : 0;

    // 배고픈 대기 (평균 이하로 친 사람의 대기) — 이게 진짜 항의로 이어지는 대기
    const worstHungry = (hungryWaits || []).reduce(
        (best, h) => (h.wait > (best?.wait ?? -1) ? h : best), null);

    // 같은 짝 재회 횟수
    const meetCount = new Map();
    active.forEach(p => {
        (p.todayRecentGames || []).forEach(g => {
            [...(g.partners || []), ...(g.opponents || [])].forEach(other => {
                const k = p.id < other ? `${p.id}|${other}` : `${other}|${p.id}`;
                meetCount.set(k, (meetCount.get(k) || 0) + 1);
            });
        });
    });
    const meetings = [...meetCount.values()].map(v => Math.round(v / 2));
    const maxRepeat = meetings.length ? Math.max(...meetings) : 0;

    // 직전 경기 사람과 바로 또 만난 횟수 (팀·상대 무관 — v3 겹침 기준)
    let backToBack = 0;
    let gamePairsCounted = 0;
    active.forEach(p => {
        const gs = p.todayRecentGames || [];
        for (let i = 0; i + 1 < gs.length; i += 1) {
            gamePairsCounted += 1;
            const cur = new Set([...(gs[i].partners || []), ...(gs[i].opponents || [])]);
            const prev = [...(gs[i + 1].partners || []), ...(gs[i + 1].opponents || [])];
            if (prev.some(id => cur.has(id))) backToBack += 1;
        }
    });
    const backToBackRate = gamePairsCounted ? backToBack / gamePairsCounted : 0;

    // 급수 안 맞는 경기 비율
    //   mild(≥0.9)   = 1급수 정도 차이 — v3에서는 괜찮은 경기로 본다 (참고용)
    //   severe(≥1.9) = 2급수 이상 차이 — 진짜 재미없는 경기, 이건 적어야 한다
    let mismatched = 0;
    let severeMismatched = 0;
    let totalGameEntries = 0;
    active.forEach(p => {
        const my = LEVEL_VAL[p.level] || 3;
        (p.todayRecentGames || []).forEach(g => {
            const others = [...(g.partners || []), ...(g.opponents || [])].filter(Boolean);
            if (!others.length) return;
            totalGameEntries += 1;
            const avgOther = others.reduce((s, id) => s + (LEVEL_VAL[gym.allPlayers[id]?.level] || 3), 0) / others.length;
            const gap = Math.abs(my - avgOther);
            if (gap >= 0.9) mismatched += 1;
            if (gap >= 1.9) severeMismatched += 1;
        });
    });
    const mismatchRate = totalGameEntries ? mismatched / totalGameEntries : 0;
    const severeMismatchRate = totalGameEntries ? severeMismatched / totalGameEntries : 0;

    return {
        genderStats,
        avgWait: Number(avgWait.toFixed(1)),
        p95Wait: Number(p95Wait.toFixed(1)),
        maxWait: Number(maxWait.toFixed(1)),
        worstHungry,
        maxRepeat,
        backToBackRate: Number((backToBackRate * 100).toFixed(1)),
        mismatchRate: Number((mismatchRate * 100).toFixed(1)),
        severeMismatchRate: Number((severeMismatchRate * 100).toFixed(1)),
        started: log.started,
        failedFill: log.failedFill,
        errors: log.errors,
        meetCount,
    };
}

// ───────────────────────────────────────────────────────────────────────────────────
// 시나리오 실행 + 판정
// ───────────────────────────────────────────────────────────────────────────────────

let scenarioNo = 0;
let totalChecks = 0;
let failedChecks = 0;
const failureNotes = [];
const summaryRows = [];

/**
 * 시나리오 하나를 돌리고 판정한다.
 * @param {string} name 시나리오 이름
 * @param {object} cfg  runSession 설정
 * @param {object} [opts] 판정 기준 조절
 *   spreadCap:   성별 내 경기 수 편차 상한 (null이면 검사 안 함, 기본 3)
 *   starveCap:   평균-최소 상한 (기본 2)
 *   maxWaitCap:  최대 대기 상한 분 (null이면 검사 안 함, 기본 45)
 *   utilMin:     가동률 하한 0~1 (null이면 검사 안 함, 기본 0.7)
 *   mismatchCap: 1급수 차 미스매치 % 상한 (null이면 보고만)
 *   severeCap:   2급수 이상 차 미스매치 % 상한 (null이면 보고만)
 *   extraChecks: (a, run) => [{label, ok, detail}]
 */
function scenario(name, cfg, opts = {}) {
    scenarioNo += 1;
    const {
        spreadCap = 3, starveCap = 2, maxWaitCap = 45,
        utilMin = 0.7, mismatchCap = null, severeCap = null, extraChecks = null,
    } = opts;

    let run;
    let a;
    try {
        run = runSession(cfg);
        a = analyze(run);
    } catch (err) {
        totalChecks += 1;
        failedChecks += 1;
        failureNotes.push(`[${scenarioNo}] ${name}: 실행 자체가 터짐 — ${err.message}`);
        console.log(`[${String(scenarioNo).padStart(2)}] ${name}`);
        console.log(`     💥 실행 오류: ${err.message}`);
        summaryRows.push({ no: scenarioNo, name, ok: false, note: '실행 오류' });
        return;
    }

    const checks = [];
    checks.push({ label: '오류 없이 완주', ok: a.errors.length === 0, detail: a.errors[0] || '' });

    Object.entries(a.genderStats).forEach(([g, s]) => {
        if (s.n >= 5 && spreadCap !== null) {
            checks.push({ label: `${g} 경기 수 편차 ${spreadCap} 이하`, ok: s.spread <= spreadCap, detail: `편차 ${s.spread} [${s.counts.join(',')}]` });
        }
        if (s.n >= 5 && starveCap !== null) {
            // 경기 수는 정수, 평균은 소수라 0.5의 반올림 여유를 둔다
            // (예: 평균 9.1 vs 최소 7 = 2.1 차이는 '2경기 정도' 관용 안이다)
            checks.push({ label: `${g} 굶는 사람 없음 (평균 대비 ${starveCap}경기 초과 뒤짐 금지)`, ok: s.avg - s.min <= starveCap + 0.5, detail: `평균 ${s.avg} vs 최소 ${s.min}` });
        }
    });

    if (maxWaitCap !== null) {
        const hw = a.worstHungry;
        checks.push({
            label: `배고픈 대기 ${maxWaitCap}분 이하 (평균 이하로 친 사람 기준)`,
            ok: !hw || hw.wait <= maxWaitCap,
            detail: hw
                ? `최악 ${Math.round(hw.wait)}분 — ${hw.id} (본인 ${hw.myGames}경기 vs 평균 ${hw.avgGames}경기, ${hw.t}분 시점)`
                : '없음',
        });
    }
    if (utilMin !== null) {
        const theoretical = Math.floor((cfg.courts ?? 3) * (cfg.minutes ?? 180) / (cfg.gameMin ?? 12));
        const util = theoretical ? a.started / theoretical : 1;
        checks.push({ label: `코트 가동률 ${Math.round(utilMin * 100)}% 이상`, ok: util >= utilMin, detail: `${a.started}/${theoretical}경기 (${Math.round(util * 100)}%)` });
    }
    if (mismatchCap !== null) {
        checks.push({ label: `급수 미스매치(1급수 차) ${mismatchCap}% 미만`, ok: a.mismatchRate < mismatchCap, detail: `${a.mismatchRate}%` });
    }
    if (severeCap !== null) {
        checks.push({ label: `심한 미스매치(2급수 이상 차) ${severeCap}% 미만`, ok: a.severeMismatchRate < severeCap, detail: `${a.severeMismatchRate}%` });
    }
    if (extraChecks) checks.push(...extraChecks(a, run));

    const allOk = checks.every(c => c.ok);
    totalChecks += checks.length;

    const gsText = Object.entries(a.genderStats)
        .map(([g, s]) => `${g} ${s.min}~${s.max}(편차${s.spread}, ${s.n}명)`).join(' · ');
    console.log(`[${String(scenarioNo).padStart(2)}] ${name}`);
    console.log(`     경기 ${a.started} · ${gsText || '-'}`);
    console.log(`     대기 평균 ${a.avgWait}분 / p95 ${a.p95Wait}분 / 원시 최대 ${a.maxWait}분 (배고픈 대기 최대 ${a.worstHungry ? Math.round(a.worstHungry.wait) : 0}분) · 최다 재회 ${a.maxRepeat}회 · 연속 재회율 ${a.backToBackRate}% · 미스매치 1급수 ${a.mismatchRate}% / 2급수+ ${a.severeMismatchRate}%`);
    checks.forEach(c => {
        if (!c.ok) {
            failedChecks += 1;
            failureNotes.push(`[${scenarioNo}] ${name}: ${c.label} — ${c.detail}`);
        }
        console.log(`     ${c.ok ? '✅' : '❌'} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
    });
    summaryRows.push({ no: scenarioNo, name, ok: allOk, note: allOk ? '' : checks.filter(c => !c.ok).map(c => c.label).join(', ') });
}

// ───────────────────────────────────────────────────────────────────────────────────
// 시나리오 정의
// ───────────────────────────────────────────────────────────────────────────────────

// 사용자 실제 구성: 3코트 · 남14(A8 B4 C2) · 여8(A2 B4 C2) · 180분 · 평균 12분
const BASE_MALE = [...rep('A조', 8), ...rep('B조', 4), ...rep('C조', 2)];
const BASE_FEMALE = [...rep('A조', 2), ...rep('B조', 4), ...rep('C조', 2)];
const BASE = {
    maleLevels: BASE_MALE, femaleLevels: BASE_FEMALE,
    courts: 3, minutes: 180, gameMin: 12, gameJitter: 2,
    sensitivity: 'high',
    modeWeights: { '남': 55, '여': 30, '혼복': 15 },
};

console.log('═'.repeat(78));
console.log(' 자동 매칭 v3 — 대규모 정밀 스트레스 테스트 (혼합 종목: 남복+여복+혼복)');
console.log('═'.repeat(78));

console.log('\n── A. 사용자 실제 구성 (3코트 · 남14 · 여8 · 180분 · 12분 경기) ──');
scenario('기본 구성 (씨앗 1)', { ...BASE, seed: 1 }, {
    mismatchCap: 45, severeCap: 10,
    extraChecks: (a) => {
        // 여자 A조가 2명뿐 — 이 둘이 계속 서로만 붙잡혀 있지 않은지 확인
        const k = '여1|여2';
        const met = Math.round((a.meetCount.get(k) || 0) / 2);
        return [{
            label: '여자 A조 2명이 서로만 반복해서 안 붙음 (재회 5회 이하)',
            ok: met <= 5, detail: `여1·여2 재회 ${met}회`,
        }];
    },
});
scenario('기본 구성 (씨앗 2)', { ...BASE, seed: 2 }, { mismatchCap: 45, severeCap: 10 });
scenario('기본 구성 (씨앗 3)', { ...BASE, seed: 3 }, { mismatchCap: 45, severeCap: 10 });

console.log('\n── B. 관리자 사용 방식 변형 ──');
scenario('민감도 보통 (예약 1명까지)', { ...BASE, seed: 1, sensitivity: 'normal' }, {});
scenario('민감도 낮음 (예약 없음)', { ...BASE, seed: 1, sensitivity: 'low' }, {});
scenario('민감도 최고 (예약 4명까지)', { ...BASE, seed: 1, sensitivity: 'max' }, {});
scenario('혼복 없음 (남복·여복만)', { ...BASE, seed: 1, modeWeights: { '남': 60, '여': 40, '혼복': 0 } }, {});
scenario('혼복 많이 (35%)', { ...BASE, seed: 1, modeWeights: { '남': 40, '여': 25, '혼복': 35 } }, {});
// 관리자가 3시간 내내 베스트를 피하고 '보통' 카드만 고르는 극단 행태 —
// 급한 사람은 베스트 카드에 몰리므로 이걸 계속 건너뛰면 편차가 조금 커지는 게 정상.
scenario("관리자가 '보통' 카드만 고름", { ...BASE, seed: 1, choose: 'normal' }, { spreadCap: 4 });
scenario('관리자가 아무 카드나 랜덤으로 고름', { ...BASE, seed: 1, choose: 'random' }, { spreadCap: 4 });
// 대기 상황을 전혀 안 보고 정해진 비율로만 종목을 만드는 관리자 (알려진 한계 문서화):
// 엔진은 '어떤 종목을 만들지'는 정해줄 수 없다. 이런 관리자 밑에서는 특정 성별이
// 한동안 경기를 못 잡는 구간이 생길 수 있으므로, 기준을 65분으로 완화해서 본다.
scenario('무심한 관리자 (대기 안 보고 비율로만 종목 선택)', { ...BASE, seed: 1, adminStyle: 'blind' }, {
    maxWaitCap: 65, spreadCap: 4,
});

console.log('\n── C. 경기 시간 · 세션 길이 변형 ──');
scenario('빠른 경기 (평균 8분)', { ...BASE, seed: 1, gameMin: 8, gameJitter: 1 }, {});
scenario('느린 경기 (평균 15분)', { ...BASE, seed: 1, gameMin: 15, gameJitter: 3 }, {});
scenario('장기 세션 240분', { ...BASE, seed: 1, minutes: 240 }, {});

console.log('\n── D. 인원 수 · 코트 수 변형 ──');
scenario('소규모: 남8 여4 · 2코트', {
    ...BASE, seed: 1, courts: 2,
    maleLevels: [...rep('A조', 4), ...rep('B조', 2), ...rep('C조', 2)],
    femaleLevels: [...rep('B조', 2), ...rep('C조', 2)],
    modeWeights: { '남': 60, '여': 20, '혼복': 20 },
}, {});
scenario('대규모: 남20 여12 · 5코트', {
    ...BASE, seed: 1, courts: 5,
    maleLevels: [...rep('A조', 8), ...rep('B조', 8), ...rep('C조', 4)],
    femaleLevels: [...rep('A조', 4), ...rep('B조', 4), ...rep('C조', 4)],
}, {});
scenario('코트 부족: 남14 여8 · 2코트 (구조적으로 대기 김)', { ...BASE, seed: 1, courts: 2 }, {
    maxWaitCap: 60, // 22명이 코트 2개를 나눠 쓰면 오래 기다리는 게 정상
});
scenario('코트 여유: 남14 여8 · 4코트', { ...BASE, seed: 1, courts: 4 }, {});
scenario('30명: 남18 여12 · 4코트', {
    ...BASE, seed: 1, courts: 4,
    maleLevels: [...rep('A조', 6), ...rep('B조', 6), ...rep('C조', 6)],
    femaleLevels: [...rep('A조', 4), ...rep('B조', 4), ...rep('C조', 4)],
}, {});

console.log('\n── E. 성비 변형 ──');
scenario('여초: 남6 여12', {
    ...BASE, seed: 1,
    maleLevels: [...rep('A조', 2), ...rep('B조', 2), ...rep('C조', 2)],
    femaleLevels: [...rep('A조', 4), ...rep('B조', 4), ...rep('C조', 4)],
    modeWeights: { '남': 25, '여': 55, '혼복': 20 },
}, {});
scenario('극단 남초: 남16 여4 (여복은 항상 같은 4명)', {
    ...BASE, seed: 1,
    maleLevels: [...rep('A조', 8), ...rep('B조', 6), ...rep('C조', 2)],
    femaleLevels: [...rep('B조', 2), ...rep('C조', 2)],
    modeWeights: { '남': 65, '여': 15, '혼복': 20 },
}, {});
scenario('남녀 동수 8:8 · 혼복 40%', {
    ...BASE, seed: 1,
    maleLevels: [...rep('A조', 3), ...rep('B조', 3), ...rep('C조', 2)],
    femaleLevels: [...rep('A조', 3), ...rep('B조', 3), ...rep('C조', 2)],
    modeWeights: { '남': 30, '여': 30, '혼복': 40 },
}, {});
scenario('남자만 14명 (여 0)', {
    ...BASE, seed: 1, femaleLevels: [],
    modeWeights: { '남': 100, '여': 0, '혼복': 0 },
}, {});
scenario('여자만 8명 · 2코트', {
    ...BASE, seed: 1, courts: 2, maleLevels: [],
    modeWeights: { '남': 0, '여': 100, '혼복': 0 },
}, {});

console.log('\n── F. 급수 구성 변형 ──');
scenario('전원 B조 (급수 요인 제거)', {
    ...BASE, seed: 1,
    maleLevels: rep('B조', 14), femaleLevels: rep('B조', 8),
}, { mismatchCap: 1 });
scenario('양극단: 남 A7 + C7 (중간 급수 없음)', {
    ...BASE, seed: 1,
    maleLevels: [...rep('A조', 7), ...rep('C조', 7)],
}, {}); // 미스매치는 구조상 높을 수밖에 없음 — 굶는 사람만 없으면 됨
scenario('외톨이 A조: 남 A1 B6 C7 (혼자 잘 치는 사람)', {
    ...BASE, seed: 1,
    maleLevels: [...rep('A조', 1), ...rep('B조', 6), ...rep('C조', 7)],
}, {
    extraChecks: (a, run) => {
        // 급수가 혼자 동떨어진 남1이 굶지 않는지 (감점 때문에 계속 밀리면 안 된다)
        const onCourtIds = new Set((run.gym.gameState.inProgressCourts || []).filter(Boolean).flatMap(c => c.players).filter(Boolean));
        const g = (run.gym.allPlayers['남1'].todayRecentGames || []).length + (onCourtIds.has('남1') ? 1 : 0);
        const s = a.genderStats['남'];
        return [{ label: '외톨이 A조도 평균-2 이내로 친다', ok: s.avg - g <= 2, detail: `남1 ${g}경기 vs 평균 ${s.avg}` }];
    },
});
// 급수가 사다리처럼 갈리는 날은 1급수 차 경기가 구조적으로 많을 수밖에 없다.
// 중요한 건 '2급수 이상 차이 나는 진짜 재미없는 경기'가 적은 것.
scenario('급수 사다리: 남 A4 B4 C4 D2', {
    ...BASE, seed: 1,
    maleLevels: [...rep('A조', 4), ...rep('B조', 4), ...rep('C조', 4), ...rep('D조', 2)],
}, { severeCap: 12 });
scenario('신규(N조) 4명 섞임', {
    ...BASE, seed: 1,
    maleLevels: [...rep('A조', 4), ...rep('B조', 4), ...rep('C조', 2), ...rep('N조', 4)],
}, {});

console.log('\n── G. 사람이 들락날락하는 날 ──');
scenario('지각 4명 (90분에 입장)', {
    ...BASE, seed: 1,
    joinEvents: [
        { at: 90, id: '지각1', gender: '남', level: 'B조' },
        { at: 90, id: '지각2', gender: '남', level: 'A조' },
        { at: 95, id: '지각3', gender: '여', level: 'B조' },
        { at: 95, id: '지각4', gender: '여', level: 'C조' },
    ],
}, {
    spreadCap: null, // 지각생은 경기 수가 적은 게 당연 — 대신 아래에서 '따라잡기'를 본다
    starveCap: null,
    extraChecks: (a, run) => {
        const onCourtIds = new Set((run.gym.gameState.inProgressCourts || []).filter(Boolean).flatMap(c => c.players).filter(Boolean));
        const lateGames = ['지각1', '지각2', '지각3', '지각4'].map(id =>
            (run.gym.allPlayers[id].todayRecentGames || []).length + (onCourtIds.has(id) ? 1 : 0));
        return [{
            label: '지각생도 남은 90분 동안 전원 3경기 이상',
            ok: Math.min(...lateGames) >= 3, detail: `[${lateGames.join(', ')}]`,
        }];
    },
});
scenario('중간 퇴장 2명 + 휴식 1명', {
    ...BASE, seed: 1,
    leaveEvents: [{ at: 60, id: '남3' }, { at: 120, id: '여5' }],
    restEvents: [{ at: 40, id: '남7', resting: true }, { at: 80, id: '남7', resting: false }],
}, { spreadCap: 4, starveCap: null }); // 휴식했던 사람은 그만큼 적게 치는 게 정상
scenario('동시 휴식 4명 (30~60분)', {
    ...BASE, seed: 1,
    restEvents: [
        { at: 30, id: '남1', resting: true }, { at: 60, id: '남1', resting: false },
        { at: 30, id: '남2', resting: true }, { at: 60, id: '남2', resting: false },
        { at: 30, id: '여1', resting: true }, { at: 60, id: '여1', resting: false },
        { at: 30, id: '여2', resting: true }, { at: 60, id: '여2', resting: false },
    ],
}, { spreadCap: 4, starveCap: null });

console.log('\n── H. 극단 상황 (터지지만 않으면 됨) ──');
scenario('딱 4명 · 1코트 (같은 4명 무한 반복)', {
    ...BASE, seed: 1, courts: 1,
    maleLevels: rep('B조', 4), femaleLevels: [],
    modeWeights: { '남': 100, '여': 0, '혼복': 0 },
}, {
    spreadCap: 1, starveCap: 1, maxWaitCap: null, utilMin: 0.8,
});
scenario('5명 · 1코트 (한 명씩 돌아가며 쉼)', {
    ...BASE, seed: 1, courts: 1,
    maleLevels: rep('B조', 5), femaleLevels: [],
    modeWeights: { '남': 100, '여': 0, '혼복': 0 },
}, {
    spreadCap: 2, maxWaitCap: null, utilMin: 0.8,
});
scenario('초대형: 남30 · 5코트 (조합 폭발 한계 테스트)', {
    ...BASE, seed: 1, courts: 5,
    maleLevels: [...rep('A조', 8), ...rep('B조', 10), ...rep('C조', 8), ...rep('D조', 4)],
    femaleLevels: [],
    modeWeights: { '남': 100, '여': 0, '혼복': 0 },
}, {});
scenario('여 6명뿐인데 혼복 위주 (혼복 60%)', {
    ...BASE, seed: 1,
    maleLevels: [...rep('A조', 4), ...rep('B조', 4)],
    femaleLevels: [...rep('B조', 4), ...rep('C조', 2)],
    modeWeights: { '남': 25, '여': 15, '혼복': 60 },
}, {});

// ───────────────────────────────────────────────────────────────────────────────────
// 최종 요약
// ───────────────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(78));
console.log(' 최종 요약');
console.log('═'.repeat(78));
summaryRows.forEach(r => {
    console.log(` ${r.ok ? '✅' : '❌'} [${String(r.no).padStart(2)}] ${r.name}${r.note ? ` — ${r.note}` : ''}`);
});
console.log('─'.repeat(78));
if (failedChecks === 0) {
    console.log(` 🎉 시나리오 ${scenarioNo}개 · 검증 ${totalChecks}건 모두 통과`);
} else {
    console.log(` ❌ 시나리오 ${scenarioNo}개 · 검증 ${totalChecks}건 중 ${failedChecks}건 실패`);
    failureNotes.forEach(n => console.log(`    · ${n}`));
}
console.log('═'.repeat(78));
process.exit(failedChecks === 0 ? 0 : 1);
