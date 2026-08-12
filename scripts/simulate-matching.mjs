// ===================================================================================
// 자동 매칭 시뮬레이터 / 검증 스크립트
// -----------------------------------------------------------------------------------
// 실제 앱과 똑같은 매칭 엔진(src/lib/matching.js)을 그대로 불러다가,
// 가상의 체육관에서 하루를 통째로 돌려보고 문제가 없는지 확인한다.
//
//   실행:  node scripts/simulate-matching.mjs
//
// 확인 항목
//   1) 경기 수가 고르게 분배되는가 (최다 - 최소 차이)
//   2) 같은 사람과 반복해서 치지 않는가
//   3) 급수가 안 맞는 경기(ABAB)가 줄어드는가
//   4) 예외 상황(인원 부족 / 전원 경기중 / 휴식 / 혼복 / 이중 배정)에서 터지지 않는가
// ===================================================================================

import {
    buildMatchContext,
    buildCandidatePool,
    generateMatchOptions,
    getSensitivity,
} from '../src/lib/matching.js';
import { repairMatchQueues } from '../src/lib/helpers.js';

// ───────────────────────────────────────────────────────────────────────────────────
// 가상 체육관
// ───────────────────────────────────────────────────────────────────────────────────

const LEVELS = ['A조', 'B조', 'C조', 'D조'];
const START_MS = new Date('2026-08-12T19:00:00+09:00').getTime();

/** 재현 가능한 난수 (돌릴 때마다 결과가 달라지면 검증이 안 되므로 씨앗을 고정한다) */
function makeRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function makeGym({ maleCount, femaleCount, courts = 4, seed = 42, levelMix = null }) {
    const rand = makeRandom(seed);
    const allPlayers = {};
    let n = 0;

    const addPlayers = (count, gender, prefix) => {
        for (let i = 0; i < count; i += 1) {
            const level = levelMix
                ? levelMix[n % levelMix.length]
                : LEVELS[Math.floor(rand() * LEVELS.length)];
            const id = `${prefix}${i + 1}`;
            allPlayers[id] = {
                id,
                name: `${prefix}${i + 1}`,
                gender,
                level,
                status: 'active',
                isResting: false,
                entryTime: new Date(START_MS).toISOString(),
                todayRecentGames: [],
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

/** 경기 시작 — 자동 매칭 목록의 한 경기를 빈 코트로 보낸다 (앱의 handleStartMatch와 같은 규칙) */
function startMatch(gym, matchKey, courtIndex, nowMs) {
    const players = gym.gameState.autoMatches[matchKey];
    if (!players || players.filter(Boolean).length !== 4) return false;
    // 경기중이거나 휴식/퇴장한 선수가 끼어 있으면 시작 불가 (앱과 동일한 방어)
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
    // 앱과 동일하게 번호를 다시 매긴다
    const reindexed = {};
    Object.values(gym.gameState.autoMatches).forEach((m, i) => { reindexed[String(i)] = m; });
    gym.gameState.autoMatches = reindexed;
    return true;
}

/** 경기 종료 — 앱의 handleEndMatch와 똑같이 각 선수 기록에 경기를 하나씩 추가한다 */
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

/** 관리자가 '매칭 만들기'를 눌러 선택지를 받고 하나를 고르는 동작 */
function adminGenerate(gym, mode, nowMs, sensitivityKey, choose = 'best', poolMode = 'all') {
    const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: nowMs });
    let pool = buildCandidatePool(ctx, mode);
    // poolMode 'waitingOnly' = 예전(v1) 방식 재현: 대기석에 앉아 있는 사람만 후보
    if (poolMode === 'waitingOnly') pool = pool.filter(p => !p.onCourt);
    const sens = getSensitivity(sensitivityKey);
    // 이미 '코트 끝나기를 기다리는' 예약이 몇 개나 목록에 있는지 (앱과 동일한 계산)
    const onCourtIds = new Set(
        gym.gameState.inProgressCourts.filter(Boolean).flatMap(c => c.players).filter(Boolean)
    );
    const pendingReservations = Object.values(gym.gameState.autoMatches)
        .filter(m => (m || []).some(id => id && onCourtIds.has(id))).length;
    const result = generateMatchOptions({
        pool, ctx, mode, maxOnCourt: sens.maxOnCourt, pages: 3, pendingReservations,
    });
    if (result.status !== 'ok') return { result, added: false };

    const page = result.pages[0];
    let picked;
    if (choose === 'best') picked = page.find(o => o.tier === 'best') || page[0];
    else if (choose === 'normal') picked = page.find(o => o.tier === 'normal') || page[0];
    else if (choose === 'bad') picked = page.find(o => o.tier === 'bad') || page[page.length - 1];
    else picked = page[Math.floor(Math.random() * page.length)];

    // 앱과 동일: 이미 큐에 들어간 선수가 있으면 추가하지 않는다
    const queued = new Set(Object.values(gym.gameState.autoMatches).flat().filter(Boolean));
    if (picked.ids.some(id => queued.has(id))) return { result, added: false, conflict: true };

    const nextIndex = Object.keys(gym.gameState.autoMatches).length;
    gym.gameState.autoMatches[String(nextIndex)] = [...picked.ids];
    return { result, added: true, picked };
}

// ───────────────────────────────────────────────────────────────────────────────────
// 하루 전체 시뮬레이션
// ───────────────────────────────────────────────────────────────────────────────────

function runSession({
    maleCount, femaleCount, courts = 4, minutes = 180, seed = 7,
    sensitivity = 'high', mode = '남', choose = 'best', levelMix = null,
    restEvents = [], leaveEvents = [], joinEvents = [], poolMode = 'all',
}) {
    const gym = makeGym({ maleCount, femaleCount, courts, seed, levelMix });
    // 늦게 오는 선수는 시작 시점에 '아직 입장 안 함'으로 둔다
    joinEvents.forEach(e => {
        gym.allPlayers[e.id] = {
            id: e.id, name: e.id, gender: e.gender || '남', level: e.level || 'B조',
            status: 'inactive', isResting: false,
            entryTime: new Date(START_MS).toISOString(), todayRecentGames: [],
        };
    });
    const rand = gym.rand;
    const courtEnd = Array(courts).fill(null);
    const log = { generated: 0, failed: 0, started: 0, finished: 0, conflicts: 0, repaired: 0, reserved: 0, errors: [] };
    const QUEUE_TARGET = 2; // 관리자는 자동 매칭 목록을 항상 2경기쯤 채워둔다

    for (let t = 0; t < minutes; t += 1) {
        const nowMs = START_MS + t * 60000;

        // 예정된 휴식/퇴장 이벤트 처리
        restEvents.filter(e => e.at === t).forEach(e => {
            const p = gym.allPlayers[e.id];
            if (p) p.isResting = e.resting;
        });
        leaveEvents.filter(e => e.at === t).forEach(e => {
            const p = gym.allPlayers[e.id];
            if (p) p.status = 'inactive';
        });
        joinEvents.filter(e => e.at === t).forEach(e => {
            const p = gym.allPlayers[e.id];
            if (p) { p.status = 'active'; p.entryTime = new Date(nowMs).toISOString(); }
        });

        // (1) 끝난 경기 정리
        for (let c = 0; c < courts; c += 1) {
            if (courtEnd[c] !== null && t >= courtEnd[c]) {
                endMatch(gym, c, nowMs);
                courtEnd[c] = null;
                log.finished += 1;
            }
        }

        // (1-b) [자동 복구] 앱과 동일하게, 못 뛰는 선수가 낀 예약 경기를 해체한다
        const repair = repairMatchQueues(gym.gameState, gym.allPlayers);
        if (repair.changed) {
            gym.gameState = repair.newState;
            log.repaired += repair.dissolvedCount;
        }

        // (2) 관리자가 자동 매칭 목록을 채운다
        let guard = 0;
        while (Object.keys(gym.gameState.autoMatches).length < QUEUE_TARGET && guard < 5) {
            guard += 1;
            try {
                const r = adminGenerate(gym, mode, nowMs, sensitivity, choose, poolMode);
                if (r.added) {
                    log.generated += 1;
                    if (r.picked?.onCourtIds?.length) log.reserved += 1;
                }
                else if (r.conflict) { log.conflicts += 1; break; }
                else { log.failed += 1; break; }
            } catch (err) {
                log.errors.push(`${t}분: 매칭 생성 중 오류 — ${err.message}`);
                break;
            }
        }

        // (3) 빈 코트에 시작 가능한 경기를 넣는다
        for (let c = 0; c < courts; c += 1) {
            if (gym.gameState.inProgressCourts[c]) continue;
            const keys = Object.keys(gym.gameState.autoMatches).sort((a, b) => Number(a) - Number(b));
            for (const key of keys) {
                if (startMatch(gym, key, c, nowMs)) {
                    courtEnd[c] = t + 12 + Math.floor(rand() * 7); // 12~18분짜리 경기
                    log.started += 1;
                    break;
                }
            }
        }
    }

    return { gym, log };
}

// ───────────────────────────────────────────────────────────────────────────────────
// 결과 분석
// ───────────────────────────────────────────────────────────────────────────────────

const LEVEL_VAL = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 3 };

function analyze(gym, mode) {
    const players = Object.values(gym.allPlayers).filter(p =>
        p.status === 'active' && (mode === '혼복' || p.gender === mode)
    );
    const counts = players.map(p => (p.todayRecentGames || []).length);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;

    // 같은 사람과 몇 번이나 다시 만났는지
    const meetCount = new Map();
    let totalMeetings = 0;
    players.forEach(p => {
        (p.todayRecentGames || []).forEach(g => {
            [...(g.partners || []), ...(g.opponents || [])].forEach(other => {
                const k = p.id < other ? `${p.id}|${other}` : `${other}|${p.id}`;
                meetCount.set(k, (meetCount.get(k) || 0) + 1);
            });
        });
    });
    // 양쪽에서 세었으므로 2로 나눈다
    const meetings = [...meetCount.values()].map(v => Math.round(v / 2));
    meetings.forEach(v => { totalMeetings += v; });
    const maxRepeat = meetings.length ? Math.max(...meetings) : 0;
    const pairsUsed = meetings.length;
    const possiblePairs = (players.length * (players.length - 1)) / 2;

    // 연속으로 같은 팀이 된 경우 (직전 경기 파트너와 또 파트너)
    let backToBackPartner = 0;
    players.forEach(p => {
        const gs = p.todayRecentGames || [];
        for (let i = 0; i + 1 < gs.length; i += 1) {
            const cur = new Set(gs[i].partners || []);
            (gs[i + 1].partners || []).forEach(id => { if (cur.has(id)) backToBackPartner += 1; });
        }
    });

    // 급수가 안 맞는 경기 비율 (ABAB 문제)
    let mismatched = 0;
    let totalGames = 0;
    players.forEach(p => {
        const my = LEVEL_VAL[p.level] || 3;
        (p.todayRecentGames || []).forEach(g => {
            const others = [...(g.partners || []), ...(g.opponents || [])].filter(Boolean);
            if (!others.length) return;
            totalGames += 1;
            const avgOther = others.reduce((s, id) => s + (LEVEL_VAL[gym.allPlayers[id]?.level] || 3), 0) / others.length;
            if (Math.abs(my - avgOther) >= 0.9) mismatched += 1;
        });
    });

    return {
        playerCount: players.length,
        min, max, avg: Number(avg.toFixed(2)), spread: max - min,
        maxRepeat,
        pairCoverage: possiblePairs ? Number((pairsUsed / possiblePairs * 100).toFixed(1)) : 0,
        backToBackPartner,
        mismatchRate: totalGames ? Number((mismatched / totalGames * 100).toFixed(1)) : 0,
        counts: counts.slice().sort((a, b) => a - b),
    };
}

// ───────────────────────────────────────────────────────────────────────────────────
// 실행
// ───────────────────────────────────────────────────────────────────────────────────

let failures = 0;
const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
};

console.log('═'.repeat(76));
console.log(' 콕스타 자동 매칭 v2 — 시뮬레이션 검증');
console.log('═'.repeat(76));

// ── 시나리오 1: 성수기 (남자 20명, 코트 4개, 3시간) ──
console.log('\n[1] 성수기 — 남자 20명 · 코트 4개 · 3시간 · 민감도 높음(경기중 2명까지)');
{
    const { gym, log } = runSession({ maleCount: 20, femaleCount: 0, minutes: 180, sensitivity: 'high', seed: 11 });
    const a = analyze(gym, '남');
    console.log(`     생성 ${log.generated} · 시작 ${log.started} · 종료 ${log.finished} · 실패 ${log.failed} · 오류 ${log.errors.length}`);
    console.log(`     경기 수: 최소 ${a.min} / 평균 ${a.avg} / 최대 ${a.max}  → 편차 ${a.spread}`);
    console.log(`     분포: [${a.counts.join(', ')}]`);
    console.log(`     같은 사람과 최다 재회 ${a.maxRepeat}회 · 짝 커버리지 ${a.pairCoverage}% · 연속 같은팀 ${a.backToBackPartner}회`);
    console.log(`     급수 안 맞는 경기 비율 ${a.mismatchRate}%`);
    check('오류 없이 완주', log.errors.length === 0, log.errors[0] || '');
    check('경기 수 편차 2 이하', a.spread <= 2, `편차 ${a.spread}`);
    check('직전 파트너와 또 같은 팀 = 0', a.backToBackPartner === 0, `${a.backToBackPartner}회`);
    check('코트 가동률 75% 이상', log.started >= 36, `${log.started}경기 / 이론상 48경기`);
}

// ── 시나리오 2: 핵심 비교 — 사용자가 말한 바로 그 불만 상황 ──
//    "경기를 적게 친 사람이 마침 코트에 있으면, 그 사이에 대기석 사람들끼리 다음 경기가
//     짜여서 계속 밀린다."
//    이걸 재현하려면 경기 수가 크게 차이 나는 사람이 있어야 한다. → 늦게 온 선수 4명.
console.log('\n[2] 핵심 비교 — 늦게 온 선수는 얼마나 빨리 따라잡는가');
console.log('    (남자 16명으로 시작 → 90분 뒤 4명 추가 입장 → 총 180분)');
{
    const latecomers = [
        { at: 90, id: '지각1', gender: '남', level: 'B조' },
        { at: 90, id: '지각2', gender: '남', level: 'C조' },
        { at: 90, id: '지각3', gender: '남', level: 'B조' },
        { at: 95, id: '지각4', gender: '남', level: 'C조' },
    ];
    const runs = [
        { key: 'high', poolMode: 'waitingOnly', title: '대기석에서만 뽑기 (예전 v1 방식)' },
        { key: 'high', poolMode: 'all', title: '경기중 선수도 후보에 포함 (새 방식)' },
    ].map(cfg => {
        const { gym, log } = runSession({
            maleCount: 16, femaleCount: 0, minutes: 180,
            sensitivity: cfg.key, poolMode: cfg.poolMode, seed: 11, joinEvents: latecomers,
        });
        const a = analyze(gym, '남');
        const lateGames = latecomers.map(l => (gym.allPlayers[l.id].todayRecentGames || []).length);
        const earlyGames = Object.values(gym.allPlayers)
            .filter(p => !p.id.startsWith('지각'))
            .map(p => (p.todayRecentGames || []).length);
        return { cfg, log, a, lateGames, earlyGames };
    });

    runs.forEach(({ cfg, log, a, lateGames, earlyGames }) => {
        const lateAvg = (lateGames.reduce((x, y) => x + y, 0) / lateGames.length).toFixed(1);
        const earlyAvg = (earlyGames.reduce((x, y) => x + y, 0) / earlyGames.length).toFixed(1);
        console.log(`     ${cfg.title}`);
        console.log(`       총 ${log.started}경기 · 예약(경기중 포함) ${log.reserved}건 · "만들 조합 없음" ${log.failed}회`);
        console.log(`       늦게 온 4명: [${lateGames.join(', ')}] 평균 ${lateAvg}경기`);
        console.log(`       처음부터 있던 16명 평균 ${earlyAvg}경기 · 전체 편차 ${a.spread}`);
    });

    const [oldWay, newWay] = runs;
    const lateAvg = (r) => r.lateGames.reduce((x, y) => x + y, 0) / r.lateGames.length;
    check('새 방식에서 늦게 온 선수가 더(또는 같게) 친다',
        lateAvg(newWay) >= lateAvg(oldWay), `예전 ${lateAvg(oldWay).toFixed(1)}경기 → 새 ${lateAvg(newWay).toFixed(1)}경기`);
    check('전체 경기 수 편차가 줄어든다',
        newWay.a.spread <= oldWay.a.spread, `예전 편차 ${oldWay.a.spread} → 새 편차 ${newWay.a.spread}`);
    check('늦게 온 선수가 한 명도 굶지 않음 (전원 3경기 이상)',
        Math.min(...newWay.lateGames) >= 3, `최소 ${Math.min(...newWay.lateGames)}경기`);
    check('새 방식은 "만들 조합 없음" 실패가 없다',
        newWay.log.failed === 0, `${newWay.log.failed}회`);
    // [의도된 맞교환] 미리 예약을 잡아두면 그 선수들이 다른 경기에 못 들어가므로
    // 코트 회전이 아주 조금 느려진다. 대신 공평해지고, 선수들이 자기 차례를 미리 안다.
    // 손실이 10%를 넘으면 과한 것이므로 경고한다.
    const lossPct = (1 - newWay.log.started / oldWay.log.started) * 100;
    console.log(`     → 맞교환: 코트 회전 ${lossPct.toFixed(1)}% 손실로 편차 ${oldWay.a.spread} → ${newWay.a.spread} 개선`);
    check('회전율 손실 10% 이내 (예약 때문에 코트가 과하게 놀지 않음)',
        lossPct <= 10, `${lossPct.toFixed(1)}% 손실`);
}

// ── 시나리오 3: 급수가 크게 갈리는 날 (ABAB 문제) ──
console.log('\n[3] 급수 편차 큰 날 — A조4·B조4·C조4·D조4 (ABAB 매너리즘 확인)');
{
    const levelMix = ['A조', 'A조', 'A조', 'A조', 'B조', 'B조', 'B조', 'B조', 'C조', 'C조', 'C조', 'C조', 'D조', 'D조', 'D조', 'D조'];
    const { gym, log } = runSession({ maleCount: 16, femaleCount: 0, minutes: 180, sensitivity: 'high', seed: 5, levelMix });
    const a = analyze(gym, '남');
    console.log(`     경기 수 편차 ${a.spread} · 급수 안 맞는 경기 ${a.mismatchRate}%`);
    // 급수를 전혀 고려하지 않고 무작위로 짜면 이 비율이 대략 45~55%가 나온다
    check('오류 없이 완주', log.errors.length === 0);
    check('급수 안 맞는 경기 40% 미만', a.mismatchRate < 40, `${a.mismatchRate}%`);
    check('경기 수 편차 2 이하', a.spread <= 2, `편차 ${a.spread}`);
}

// ── 시나리오 4: 혼복 ──
console.log('\n[4] 혼복 — 남 10명 · 여 8명 · 3시간');
{
    const { gym, log } = runSession({ maleCount: 10, femaleCount: 8, minutes: 180, sensitivity: 'high', mode: '혼복', seed: 3 });
    const a = analyze(gym, '혼복');
    console.log(`     생성 ${log.generated} · 시작 ${log.started} · 실패 ${log.failed} · 오류 ${log.errors.length}`);
    console.log(`     경기 수: 최소 ${a.min} / 평균 ${a.avg} / 최대 ${a.max} → 편차 ${a.spread}`);
    // 혼복은 각 경기에 남2·여2가 들어가므로 남녀 인원이 다르면 편차가 생길 수밖에 없다
    const males = Object.values(gym.allPlayers).filter(p => p.gender === '남').map(p => p.todayRecentGames.length);
    const females = Object.values(gym.allPlayers).filter(p => p.gender === '여').map(p => p.todayRecentGames.length);
    console.log(`     남자 편차 ${Math.max(...males) - Math.min(...males)} · 여자 편차 ${Math.max(...females) - Math.min(...females)}`);
    check('오류 없이 완주', log.errors.length === 0, log.errors[0] || '');
    check('남녀 각각 편차 2 이하',
        (Math.max(...males) - Math.min(...males)) <= 2 && (Math.max(...females) - Math.min(...females)) <= 2);
    check('모든 경기가 남2·여2 구성', (() => {
        return Object.values(gym.allPlayers).every(p => {
            return (p.todayRecentGames || []).every(g => {
                const ids = [p.id, ...(g.partners || []), ...(g.opponents || [])];
                const m = ids.filter(id => gym.allPlayers[id]?.gender === '남').length;
                return m === 2;
            });
        });
    })());
    check('혼복 팀은 남1+여1', (() => {
        return Object.values(gym.allPlayers).every(p =>
            (p.todayRecentGames || []).every(g => {
                const teamGenders = [p.gender, ...(g.partners || []).map(id => gym.allPlayers[id]?.gender)];
                return teamGenders.filter(x => x === '남').length === 1;
            })
        );
    })());
}

// ── 시나리오 5: 예외 상황 ──
console.log('\n[5] 예외 상황 — 터지지 않는지');
{
    // 5-1. 딱 4명
    {
        const gym = makeGym({ maleCount: 4, femaleCount: 0, seed: 1 });
        const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS });
        const pool = buildCandidatePool(ctx, '남');
        const r = generateMatchOptions({ pool, ctx, mode: '남', maxOnCourt: 2 });
        check('딱 4명 — 선택지 1개 생성', r.status === 'ok' && r.pages[0].length === 1, `조합 ${r.totalCombos}개`);
    }
    // 5-2. 3명 (부족)
    {
        const gym = makeGym({ maleCount: 3, femaleCount: 0, seed: 1 });
        const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS });
        const pool = buildCandidatePool(ctx, '남');
        const r = generateMatchOptions({ pool, ctx, mode: '남', maxOnCourt: 2 });
        check('3명 — 인원 부족으로 안내', r.status === 'notEnough' && r.poolSize === 3);
    }
    // 5-3. 전원 경기중 (코트 2개에 8명 전부)
    {
        const gym = makeGym({ maleCount: 8, femaleCount: 0, courts: 2, seed: 1 });
        gym.gameState.inProgressCourts[0] = { players: ['남1', '남2', '남3', '남4'], startTime: new Date(START_MS).toISOString() };
        gym.gameState.inProgressCourts[1] = { players: ['남5', '남6', '남7', '남8'], startTime: new Date(START_MS).toISOString() };
        const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS + 5 * 60000 });
        const pool = buildCandidatePool(ctx, '남');
        const r = generateMatchOptions({ pool, ctx, mode: '남', maxOnCourt: 2 });
        check('전원 경기중 — 그래도 예약 선택지 생성', r.status === 'ok' && r.pages[0].length > 0, `${r.pages[0]?.length ?? 0}개`);
        const anyOption = r.pages[0][0];
        check('전원 경기중 옵션에 대기 안내 문구 있음',
            anyOption.reasons.some(l => l.tone === 'wait'),
            anyOption.reasons.map(l => l.text).join(' / '));
        check('같은 코트 4명 재탕은 후보에서 제외됨', !r.pages.flat().some(o => o.facts.sameFour));
    }
    // 5-4. 휴식 선수는 후보에서 빠지는가
    {
        const gym = makeGym({ maleCount: 6, femaleCount: 0, seed: 1 });
        gym.allPlayers['남1'].isResting = true;
        const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS });
        const pool = buildCandidatePool(ctx, '남');
        check('휴식 선수 제외', pool.length === 5 && !pool.some(p => p.id === '남1'));
    }
    // 5-5. 이미 큐에 있는 선수는 후보에서 빠지는가 (이중 배정 방지)
    {
        const gym = makeGym({ maleCount: 12, femaleCount: 0, seed: 1 });
        gym.gameState.autoMatches['0'] = ['남1', '남2', '남3', '남4'];
        gym.gameState.scheduledMatches['0'] = ['남5', '남6', null, null];
        const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS });
        const pool = buildCandidatePool(ctx, '남');
        const ids = pool.map(p => p.id);
        check('자동매칭 큐 선수 제외', !['남1', '남2', '남3', '남4'].some(id => ids.includes(id)));
        check('경기예정 큐 선수 제외', !['남5', '남6'].some(id => ids.includes(id)));
        check('나머지 6명만 후보', pool.length === 6, `${pool.length}명`);
    }
    // 5-6. 경기중 선수는 경기 수가 +1로 계산되는가
    {
        const gym = makeGym({ maleCount: 8, femaleCount: 0, seed: 1 });
        gym.allPlayers['남1'].todayRecentGames = [{ timestamp: new Date(START_MS).toISOString(), partners: ['남2'], opponents: ['남3', '남4'] }];
        gym.gameState.inProgressCourts[0] = { players: ['남1', '남5', '남6', '남7'], startTime: new Date(START_MS).toISOString() };
        const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS + 60000 });
        check('경기중 선수 경기수 = 끝낸 경기 + 1', ctx.stats['남1'].games === 2 && ctx.stats['남1'].realGames === 1,
            `games=${ctx.stats['남1'].games}, real=${ctx.stats['남1'].realGames}`);
        check('경기중 선수는 대기시간 0', ctx.stats['남1'].waitMin === 0);
        // 지금 같은 코트에 있는 남5와 또 붙는 조합은 감점을 받아야 한다
        const pool = buildCandidatePool(ctx, '남');
        const r = generateMatchOptions({ pool, ctx, mode: '남', maxOnCourt: 4 });
        const withBoth = r.pages.flat().filter(o => o.ids.includes('남1') && o.ids.includes('남5'));
        const withoutBoth = r.pages.flat().filter(o => o.ids.includes('남1') && !o.ids.includes('남5'));
        check('지금 같은 코트 동료와 또 붙는 조합은 점수가 낮음',
            withBoth.length === 0 || withoutBoth.length === 0 ||
            Math.max(...withBoth.map(o => o.score)) < Math.max(...withoutBoth.map(o => o.score)));
    }
    // 5-7. 경기 도중 선수가 나가도 매칭이 계속 되는가
    {
        const { gym, log } = runSession({
            maleCount: 14, femaleCount: 0, minutes: 120, sensitivity: 'high', seed: 9,
            leaveEvents: [{ at: 40, id: '남3' }, { at: 70, id: '남7' }],
            restEvents: [{ at: 30, id: '남5', resting: true }, { at: 90, id: '남5', resting: false }],
        });
        console.log(`     시작 ${log.started}경기 · 자동 해체 ${log.repaired}건 · 매칭 실패 ${log.failed}회`);
        check('중간 퇴장·휴식이 있어도 오류 없음', log.errors.length === 0, log.errors[0] || '');
        check('막힌 예약 경기가 자동으로 해체됨', log.repaired > 0, `${log.repaired}건`);
        check('중간 퇴장·휴식이 있어도 경기가 계속 돌아감', log.started >= 20, `${log.started}경기`);
    }
    // 5-8. 자동 복구가 없으면 실제로 교착에 빠지는지 (복구 로직의 존재 이유 확인)
    {
        const gym = makeGym({ maleCount: 12, femaleCount: 0, seed: 2 });
        gym.gameState.autoMatches['0'] = ['남1', '남2', '남3', '남4'];
        gym.allPlayers['남1'].status = 'inactive'; // 남1이 나가버림
        const before = buildCandidatePool(
            buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS }), '남'
        ).length;
        const repair = repairMatchQueues(gym.gameState, gym.allPlayers);
        gym.gameState = repair.newState;
        const after = buildCandidatePool(
            buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS }), '남'
        ).length;
        check('나간 선수가 낀 예약 경기는 해체되고 남은 선수가 후보로 복귀',
            repair.changed && before === 8 && after === 11, `복구 전 후보 ${before}명 → 복구 후 ${after}명`);
    }
}

// ── 시나리오 6: 선택지 품질 (티어가 실제로 구분되는가) ──
console.log('\n[6] 선택지 품질 — 베스트/보통/아쉬움이 실제로 구분되는가');
{
    const { gym } = runSession({ maleCount: 16, femaleCount: 0, minutes: 90, sensitivity: 'high', seed: 21 });
    const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS + 90 * 60000 });
    const pool = buildCandidatePool(ctx, '남');
    const r = generateMatchOptions({ pool, ctx, mode: '남', maxOnCourt: 2, pages: 3 });

    const page = r.pages[0];
    console.log(`     후보 조합 ${r.totalCombos}개 → 선택지 ${page.length}개 (총 ${r.pages.length}페이지)`);
    page.forEach(o => {
        const names = o.players.map(p => `${p.name}(${p.level.replace('조', '')}·${p.games}G)`);
        console.log(`     ${o.tierEmoji} ${o.tierLabel.padEnd(3)} [${o.score.toString().padStart(4)}점] ${names[0]}+${names[1]} vs ${names[2]}+${names[3]}`);
        o.reasons.forEach(l => console.log(`            · ${l.text}`));
    });

    const bestScores = page.filter(o => o.tier === 'best').map(o => o.score);
    const badScores = page.filter(o => o.tier === 'bad').map(o => o.score);
    check('6개 선택지 생성', page.length === 6, `${page.length}개`);
    check('티어 구성이 2/2/2', ['best', 'normal', 'bad'].every(t => page.filter(o => o.tier === t).length === 2));
    check('베스트가 아쉬움보다 점수 높음', Math.min(...bestScores) > Math.max(...badScores),
        `best 최저 ${Math.min(...bestScores)} vs bad 최고 ${Math.max(...badScores)}`);
    check('모든 선택지에 이유 문장 있음', page.every(o => o.reasons.length >= 2));
    check('선택지끼리 4명 전부 똑같은 건 없음', (() => {
        const sigs = page.map(o => [...o.ids].sort().join(','));
        return new Set(sigs).size === sigs.length;
    })());
    check('여러 페이지 제공', r.pages.length >= 2, `${r.pages.length}페이지`);
    check('페이지끼리도 중복 조합 없음', (() => {
        const sigs = r.pages.flat().map(o => [...o.ids].sort().join(','));
        return new Set(sigs).size === sigs.length;
    })());
}

// ── 시나리오 7: 속도 ──
console.log('\n[7] 속도 — 저사양 휴대폰에서도 즉시 반응해야 함');
{
    const gym = makeGym({ maleCount: 30, femaleCount: 0, seed: 4 });
    // 기록을 넉넉히 채워 최악의 조건을 만든다
    Object.values(gym.allPlayers).forEach((p, i) => {
        p.todayRecentGames = Array.from({ length: 6 }, (_, k) => ({
            timestamp: new Date(START_MS - k * 900000).toISOString(),
            partners: [`남${((i + k) % 30) + 1}`],
            opponents: [`남${((i + k + 7) % 30) + 1}`, `남${((i + k + 13) % 30) + 1}`],
        }));
    });
    const t0 = process.hrtime.bigint();
    const ctx = buildMatchContext(gym.allPlayers, gym.gameState, { now: START_MS });
    const pool = buildCandidatePool(ctx, '남');
    const r = generateMatchOptions({ pool, ctx, mode: '남', maxOnCourt: 2, pages: 3 });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`     30명 · 조합 ${r.totalCombos}개 · ${ms.toFixed(1)}ms`);
    check('300ms 이내', ms < 300, `${ms.toFixed(1)}ms`);
}

console.log('\n' + '═'.repeat(76));
if (failures === 0) {
    console.log(' 🎉 모든 검증 통과');
} else {
    console.log(` ❌ 실패 ${failures}건 — 위 로그를 확인하세요`);
}
console.log('═'.repeat(76));
process.exit(failures === 0 ? 0 : 1);
