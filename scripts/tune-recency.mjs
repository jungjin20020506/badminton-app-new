// ===================================================================================
// 재회 '최근성' 가중치 튜닝 — RECENT_MET_STEPS 후보 비교
// -----------------------------------------------------------------------------------
//   실행:  node scripts/tune-recency.mjs
//
// [무엇을 재는가]
//   "오늘 이미 만난 사람과 다시 만날 때, 몇 경기를 쉬고 만났는가"의 분포.
//     gap 0 = 바로 직전 경기에서 만난 사람과 곧바로 또 만남 (제일 재미없는 경우)
//     gap 1 = 한 경기 쉬고 다시 만남
//     gap 2 = 두 경기 쉬고 다시 만남
//     gap3+ = 세 경기 이상 지나서 다시 만남 (이건 자연스러운 재회)
//   목표: gap 0을 최대한 줄이되, 아래 안전선은 절대 깨지 않는 값을 찾는다.
//     · 경기 수 편차 3 이하 (2경기 관용 철학)
//     · 2급수 이상 차이 경기 15% 미만
//     · 코트 가동률 손실 3% 이내 (기준 대비)
//     · 같은 사람과 최다 재회가 늘지 않을 것
//
// [결론 — 2026-08-21 튜닝 기록]
//   기존(최근 2경기 일괄 -80) 대비, 계단식 [140, 55, 20]이
//   직전 재회(gap 0)를 크게 줄이면서 다른 지표를 전혀 해치지 않았다.
//   더 센 값([200,80,30] 이상)은 직전 재회가 몇 건 더 줄어드는 대신
//   급수 섞임(2급수 이상 차 경기)이 늘어나기 시작해서 채택하지 않았다.
// ===================================================================================

import {
    buildMatchContext,
    buildCandidatePool,
    generateMatchOptions,
    getSensitivity,
    MATCH_WEIGHTS,
} from '../src/lib/matching.js';
import { repairMatchQueues } from '../src/lib/helpers.js';

const START_MS = new Date('2026-08-21T19:00:00+09:00').getTime();
const LEVELS = ['A조', 'B조', 'C조', 'D조'];

function makeRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// ── 가상 체육관 (simulate-matching.mjs와 동일한 하루 재현) ──────────────────────────

function makeGym({ maleCount, femaleCount, courts = 4, seed = 42, levelMix = null }) {
    const rand = makeRandom(seed);
    const allPlayers = {};
    let n = 0;
    const addPlayers = (count, gender, prefix) => {
        for (let i = 0; i < count; i += 1) {
            const level = levelMix ? levelMix[n % levelMix.length] : LEVELS[Math.floor(rand() * LEVELS.length)];
            const id = `${prefix}${i + 1}`;
            allPlayers[id] = {
                id, name: id, gender, level,
                status: 'active', isResting: false,
                entryTime: new Date(START_MS).toISOString(), todayRecentGames: [],
            };
            n += 1;
        }
    };
    addPlayers(maleCount, '남', '남');
    addPlayers(femaleCount, '여', '여');
    const gameState = {
        numInProgressCourts: courts,
        numScheduledMatches: 4,
        inProgressCourts: Array(courts).fill(null),
        scheduledMatches: {},
        autoMatches: {},
    };
    return { allPlayers, gameState, rand };
}

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
        p.todayRecentGames = [{
            timestamp: ts,
            partners: (inA ? teamA : teamB).filter(x => x !== id),
            opponents: inA ? teamB : teamA,
        }, ...(p.todayRecentGames || [])].slice(0, 20);
    });
    gym.gameState.inProgressCourts[courtIndex] = null;
    return court.players;
}

function adminGenerate(gym, mode, nowMs, sensitivityKey) {
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
    const picked = page.find(o => o.tier === 'best') || page[0];
    const queued = new Set(Object.values(gym.gameState.autoMatches).flat().filter(Boolean));
    if (picked.ids.some(id => queued.has(id))) return { added: false };
    const nextIndex = Object.keys(gym.gameState.autoMatches).length;
    gym.gameState.autoMatches[String(nextIndex)] = [...picked.ids];
    return { added: true };
}

function runSession({ maleCount, femaleCount = 0, courts = 4, minutes = 180, seed = 7, mode = '남', levelMix = null }) {
    const gym = makeGym({ maleCount, femaleCount, courts, seed, levelMix });
    const rand = gym.rand;
    const courtEnd = Array(courts).fill(null);
    let started = 0;
    for (let t = 0; t < minutes; t += 1) {
        const nowMs = START_MS + t * 60000;
        for (let c = 0; c < courts; c += 1) {
            if (courtEnd[c] !== null && t >= courtEnd[c]) {
                endMatch(gym, c, nowMs);
                courtEnd[c] = null;
            }
        }
        const repair = repairMatchQueues(gym.gameState, gym.allPlayers);
        if (repair.changed) gym.gameState = repair.newState;
        let guard = 0;
        while (Object.keys(gym.gameState.autoMatches).length < 2 && guard < 5) {
            guard += 1;
            if (!adminGenerate(gym, mode, nowMs, 'high').added) break;
        }
        for (let c = 0; c < courts; c += 1) {
            if (gym.gameState.inProgressCourts[c]) continue;
            const keys = Object.keys(gym.gameState.autoMatches).sort((a, b) => Number(a) - Number(b));
            for (const key of keys) {
                if (startMatch(gym, key, c, nowMs)) {
                    courtEnd[c] = t + 12 + Math.floor(rand() * 7);
                    started += 1;
                    break;
                }
            }
        }
    }
    return { gym, started };
}

// ── 측정 ───────────────────────────────────────────────────────────────────────────

const LEVEL_VAL = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 3 };
const membersOf = (g) => [...(g.partners || []), ...(g.opponents || [])].filter(Boolean);

/**
 * 재회 간격 분포: 각 선수의 경기 i에서 만난 사람이, 그 선수의 몇 경기 전(j)에도
 * 있었는지 찾아 gap = j - i - 1을 센다. (gap 0 = 직전 경기에서 만나고 곧바로 또 만남)
 */
function measure(gym, mode) {
    const players = Object.values(gym.allPlayers).filter(p =>
        p.status === 'active' && (mode === '혼복' || p.gender === mode)
    );
    const gaps = [0, 0, 0, 0]; // gap 0 / 1 / 2 / 3+
    players.forEach(p => {
        const gs = p.todayRecentGames || [];
        for (let i = 0; i < gs.length; i += 1) {
            for (const m of membersOf(gs[i])) {
                for (let j = i + 1; j < gs.length; j += 1) {
                    if (membersOf(gs[j]).includes(m)) {
                        gaps[Math.min(3, j - i - 1)] += 1;
                        break; // 가장 가까운 이전 만남만 센다
                    }
                }
            }
        }
    });

    // 경기 수 편차 · 최다 재회 · 급수 미스매치 (simulate-matching.mjs와 같은 계산)
    const counts = players.map(p => (p.todayRecentGames || []).length);
    const meetCount = new Map();
    players.forEach(p => {
        (p.todayRecentGames || []).forEach(g => {
            membersOf(g).forEach(other => {
                const k = p.id < other ? `${p.id}|${other}` : `${other}|${p.id}`;
                meetCount.set(k, (meetCount.get(k) || 0) + 1);
            });
        });
    });
    const meetings = [...meetCount.values()].map(v => Math.round(v / 2));
    let severe = 0;
    let total = 0;
    players.forEach(p => {
        const my = LEVEL_VAL[p.level] || 3;
        (p.todayRecentGames || []).forEach(g => {
            const others = membersOf(g);
            if (!others.length) return;
            total += 1;
            const avg = others.reduce((s, id) => s + (LEVEL_VAL[gym.allPlayers[id]?.level] || 3), 0) / others.length;
            if (Math.abs(my - avg) >= 1.9) severe += 1;
        });
    });
    return {
        gaps,
        participations: total,   // (선수 × 경기) 건수 — gap0 비율의 분모
        spread: Math.max(...counts) - Math.min(...counts),
        maxRepeat: meetings.length ? Math.max(...meetings) : 0,
        severePct: total ? (severe / total) * 100 : 0,
    };
}

// ── 시나리오 × 가중치 후보 ─────────────────────────────────────────────────────────

// 시드를 넉넉히 준다 — 2~3개로는 값이 크게 튀어서 "우연히 좋은 값"을 고르게 된다.
const SEEDS = [2, 5, 7, 11, 13, 17, 23, 29, 37, 43];

const SCENARIOS = [
    { name: '성수기 남20·코트4', cfg: { maleCount: 20, courts: 4, minutes: 180 }, seeds: SEEDS },
    {
        name: '급수혼합 남16·코트4',
        cfg: {
            maleCount: 16, courts: 4, minutes: 180,
            levelMix: ['A조', 'A조', 'A조', 'A조', 'B조', 'B조', 'B조', 'B조', 'C조', 'C조', 'C조', 'C조', 'D조', 'D조', 'D조', 'D조'],
        },
        seeds: SEEDS,
    },
    { name: '혼복 남10·여8', cfg: { maleCount: 10, femaleCount: 8, courts: 4, minutes: 180, mode: '혼복' }, seeds: SEEDS },
    // 아래 둘은 "인원이 빠듯해서 직전 재회를 피할 방법이 물리적으로 없는 날" —
    // 가중치를 올려도 좋아지지 않는 게 정상이다. 대신 부작용(급수 섞임)이 없는지 본다.
    { name: '타이트 남12·코트3', cfg: { maleCount: 12, courts: 3, minutes: 180 }, seeds: SEEDS },
    { name: '초타이트 남8·코트2', cfg: { maleCount: 8, courts: 2, minutes: 150 }, seeds: SEEDS.slice(0, 5) },
];

// 직전 회피를 세게 걸면 엔진이 "재회를 피하려고 A조와 D조를 한 코트에 섞는" 쪽으로
// 도망간다. 그래서 급수 폭 감점(SPREAD_PENALTY)을 같이 올린 조합도 함께 본다.
const BASE_SPREAD = [0, 8, 30, 150];
const BASE_LONELY = 25;
// '2급수 이상 차 경기'는 곧 "혼자 급수가 동떨어진 선수가 낀 경기"다.
// 그 감점(LONELY_LEVEL)을 올리는 게 급수 폭(SPREAD_PENALTY)을 올리는 것보다 정확하다.
const CANDIDATES = [
    { name: '기존(일괄 -80)', steps: [80, 80, 0] },
    { name: '[140, 30, 0]', steps: [140, 30, 0] },
    { name: '[140,30,0]+외톨40', steps: [140, 30, 0], lonely: 40 },
    { name: '[140,30,0]+외톨55', steps: [140, 30, 0], lonely: 55 },
    { name: '[140,30,0]+외톨70', steps: [140, 30, 0], lonely: 70 },
    { name: '[180,40,0]+외톨55', steps: [180, 40, 0], lonely: 55 },
    { name: '[180,40,0]+외톨70', steps: [180, 40, 0], lonely: 70 },
];

console.log('═'.repeat(100));
console.log(' 재회 최근성(RECENT_MET_STEPS) 튜닝 — 직전 재회(gap 0)를 줄이면서 안전선을 지키는 값 찾기');
console.log('═'.repeat(100));
console.log(' gap 0 = 직전 경기에서 만난 사람과 곧바로 또 만난 횟수 (적을수록 좋음)');
console.log(' 안전선: 편차 ≤3 · 2급수차 <15% · 가동률 손실 ≤3% · 최다 재회 유지\n');

// 시나리오별로 따로 본다 — 인원이 빠듯한 날은 직전 재회가 물리적으로 불가피하므로
// 전부 합쳐서 평균을 내면 "여유 있는 날에는 얼마나 좋아졌는지"가 묻힌다.
const table = {}; // [시나리오][후보] = 측정치
for (const cand of CANDIDATES) {
    MATCH_WEIGHTS.RECENT_MET_STEPS = cand.steps;
    MATCH_WEIGHTS.SPREAD_PENALTY = cand.spread || BASE_SPREAD;
    MATCH_WEIGHTS.LONELY_LEVEL = cand.lonely || BASE_LONELY;
    for (const sc of SCENARIOS) {
        const agg = { gap0: 0, parts: 0, started: 0, spreadMax: 0, severeSum: 0, severeMax: 0, repeatMax: 0, runs: 0 };
        for (const seed of sc.seeds) {
            const { gym, started } = runSession({ ...sc.cfg, seed, mode: sc.cfg.mode || '남' });
            const m = measure(gym, sc.cfg.mode || '남');
            agg.gap0 += m.gaps[0];
            agg.parts += m.participations;
            agg.started += started;
            agg.runs += 1;
            agg.spreadMax = Math.max(agg.spreadMax, m.spread);
            agg.severeSum += m.severePct;
            agg.severeMax = Math.max(agg.severeMax, m.severePct);
            agg.repeatMax = Math.max(agg.repeatMax, m.maxRepeat);
        }
        agg.severeAvg = agg.severeSum / agg.runs;
        (table[sc.name] = table[sc.name] || {})[cand.name] = agg;
    }
}

for (const sc of SCENARIOS) {
    console.log(`\n▸ ${sc.name}`);
    console.log('   후보              | 직전재회 건수(비율) | 총경기 | 편차max | 2급수차 평균(최대) | 최다재회');
    console.log('   ' + '─'.repeat(88));
    const baseAgg = table[sc.name][CANDIDATES[0].name];
    for (const cand of CANDIDATES) {
        const r = table[sc.name][cand.name];
        const rate = r.parts ? (r.gap0 / r.parts) * 100 : 0;
        const baseRate = baseAgg.parts ? (baseAgg.gap0 / baseAgg.parts) * 100 : 0;
        const delta = cand === CANDIDATES[0] ? '기준' : `${rate - baseRate >= 0 ? '+' : ''}${(rate - baseRate).toFixed(1)}p`;
        const startDiff = r.started - baseAgg.started;
        console.log(
            `   ${cand.name.padEnd(16)} | ${String(r.gap0).padStart(5)}건 ${rate.toFixed(1).padStart(5)}% ${delta.padStart(6)} | ${String(r.started).padStart(4)}${(startDiff === 0 ? '' : ` ${startDiff > 0 ? '+' : ''}${startDiff}`).padEnd(4)} |    ${r.spreadMax}    |   ${r.severeAvg.toFixed(1).padStart(4)}% (${r.severeMax.toFixed(1).padStart(4)}%)  |    ${r.repeatMax}`
        );
    }
}

console.log('\n' + '─'.repeat(100));
console.log(' ※ 이 스크립트는 가중치를 바꾼 뒤 참고용으로 다시 돌려보는 도구다.');
console.log('   최종 채택값은 src/lib/matching.js의 RECENT_MET_STEPS 주석에 기록한다.');
