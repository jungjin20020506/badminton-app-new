// ===================================================================================
// 콕스타 자동 매칭 엔진 v3
// -----------------------------------------------------------------------------------
// [v3에서 무엇이 달라졌나 — 일주일 실사용 피드백 반영]
//  1) '팀 대 팀'이 아니라 '4명 묶음'으로 계산한다.
//     실제 운영에서는 코트에 들어간 4명이 팀을 랜덤으로 짜기 때문에,
//     "누가 같은 팀이었고 누가 상대였나"는 의미가 없다.
//     → 겹침 판정: 같은 팀이었든 상대였든 똑같이 '오늘 만난 사람'으로 본다.
//     → 급수 밸런스: 양 팀 합 비교 대신, 4명 급수가 서로 얼마나 벌어졌는지를 본다.
//       (급수 폭이 크면 랜덤 팀에서 한쪽으로 쏠린 경기가 나올 수 있으므로)
//
//  2) 우선순위를 갈아엎었다.
//     예전:  경기 수 공평  >  안 친 사람  >  급수 밸런스
//     지금:  ① 겹침 방지 — 두 갈래다
//                 ⓐ 오늘 한 번도 안 친 사람과 붙여주기 (FRESH_PAIR)
//                 ⓑ 바로 직전 경기에서 같이 친 사람은 피하기 (RECENT_MET_STEPS)
//               둘 다 중요하지만 성격이 다르다. ⓐ는 '새로운 만남을 늘리는' 쪽,
//               ⓑ는 '방금 그 사람과 또'라는 지루함을 막는 쪽이다.
//               ⓑ는 직전 경기에만 세게 걸고 두세 경기 지나면 0으로 푼다 —
//               몇 경기 쉬었다가 다시 만나는 건 자연스러운 일이므로.
//            ② 오래 기다린 사람 먼저
//            ③ 급수 밸런스
//            ④ 경기 수 (2경기 차이까지는 너그럽게)
//            ⑤ 급수 다양성 (A조가 낮은 급수 사이에 계속 끼지 않게)
//
//  3) 경기 수보다 대기 시간이 중요해졌다.
//     5경기 친 사람과 6경기 친 사람이 있을 때, 6경기 친 사람이 훨씬 오래
//     기다렸다면 6경기 친 사람이 먼저 들어간다. 대신 3경기 이상 밀리면
//     '구출 가중치'가 붙어서 굶는 사람은 생기지 않는다.
//
// [v2에서 이어받은 것]
//  · 후보 = 접속한 전원(대기석 + 경기중). 다음 경기가 이미 잡힌 사람만 제외.
//  · 경기중인 사람은 '지금 치는 경기'를 가짜 기록으로 붙여 경기 수 +1, 재회 방지.
//  · 베스트 2 / 보통 2 / 아쉬움 2 선택지를 이유와 함께 관리자에게 보여준다.
// ===================================================================================


// ===================================================================================
// 1. 기본 유틸
// ===================================================================================

/**
 * k개짜리 조합을 모두 만든다. (예: 8명 중 4명 뽑는 모든 경우)
 * @param {Array} arr 원본 배열
 * @param {number} k 뽑을 개수
 * @returns {Array<Array>}
 */
function getAllCombinations(arr, k) {
    const result = [];
    if (k > arr.length || k <= 0) return result;
    if (k === arr.length) return [arr];
    if (k === 1) return arr.map(item => [item]);

    function backtrack(startIndex, currentCombo) {
        if (currentCombo.length === k) {
            result.push([...currentCombo]);
            return;
        }
        for (let i = startIndex; i < arr.length; i++) {
            currentCombo.push(arr[i]);
            backtrack(i + 1, currentCombo);
            currentCombo.pop();
        }
    }
    backtrack(0, []);
    return result;
}

/** 급수를 숫자로 바꾼다. 숫자가 작을수록 잘 치는 사람이다. (A조=1 … D조=4) */
const LEVEL_BALANCE_MAP = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 3 };

/**
 * 점수 가중치 모음.
 * 여기 숫자만 바꾸면 매칭 성향이 바뀐다. 각 줄의 주석이 "이 숫자가 몇 점짜리인지" 설명한다.
 *
 * [우선순위 감각 잡기 — 대표 값 비교]
 *   · 바로 직전 경기에서 만난 짝 1쌍     ≈ -197점 (RECENT_MET_STEPS[0] + MET_AGAIN)
 *   · 2경기 전에 만난 짝 1쌍             ≈ -57점  (RECENT_MET_STEPS[1] + MET_AGAIN)
 *   · 4경기 전에 만난 짝 1쌍             ≈ -17점  (MET_AGAIN만 — 최근성 감점 없음)
 *   · 30분 기다린 사람 1명               ≈ +90점 (15분×2 + 15×4)
 *   · 급수 폭 3(A조와 D조가 한 코트)     = -150점
 *   · 1경기 덜 친 사람 1명               = +15점 (2경기까지는 이 정도로 너그럽게)
 *   · 3경기째 밀린 사람 1명              = +80점 (구출 가중치 발동)
 */
const W = {
    // ── ① 겹침 방지 (1순위) — 팀·상대 구분 없이 '오늘 만난 사람' 기준 ──
    FRESH_PAIR: 18,      // 오늘 한 번도 안 만난 짝 1쌍당 +18 (최대 6쌍 = +108)
    // 재회 감점은 만난 횟수의 '제곱'으로 커진다: 2회째 -68, 3회째 -153, 4회째부터 -272 (상한).
    // 왜 제곱인가: 쌍당 일정 감점이면 "이미 4번 겹친 짝을 또 겹치게 하는 것"이
    // "새로운 짝 2개를 한 번씩 겹치게 하는 것"보다 싸게 계산되어, 특정 두 사람이
    // 매 경기 같이 뽑히는 사이클이 생긴다 (A조 여자 2명이 8경기 연속 같이 뽑히는
    // 현상을 시뮬레이션에서 확인). 사람의 감각은 반대다 — 여러 명과 두 번씩은
    // 참아도 같은 사람과 다섯 번은 못 참는다.
    // 왜 4회에서 상한인가: 상한 없이 계속 커지면, 급수별 인원이 적은 날(같은 급수끼리는
    // 재회가 불가피)에 재회를 피하려고 A조와 D조를 한 코트에 섞는 폭주가 생긴다.
    MET_AGAIN: 17,       // 재회 1쌍당 -17 × (만난 횟수, 최대 4)²
    MET_CAP: 4,          // 재회 감점 계산에 인정하는 최대 만남 횟수
    // 재회 '최근성' 감점 — 직전 경기일수록 크고, 몇 경기 지나면 괜찮아진다.
    // [0]=바로 직전 경기에서 만난 짝 -140, [1]=2경기 전 -30, [2]=3경기 전 0, 그 이후도 0.
    //
    // 왜 계단인가: 예전에는 "최근 2경기 안"을 한 덩어리(-80)로 봤는데, 실사용 감각은
    // 그렇지 않다. 방금 같이 친 사람과 곧바로 또 붙으면 확실히 재미없지만,
    // 두세 경기 쉬고 다시 만나는 건 오히려 자연스럽다. 그래서 직전만 크게 때리고
    // 그 뒤로는 빠르게 0으로 떨어뜨린다.
    // ("한 번도 안 친 사람 우선"은 FRESH_PAIR와 MET_AGAIN이 따로 담당한다 —
    //  이 값은 '이미 만난 사람들 중에서 누가 더 최근이었나'만 가른다)
    //
    // 왜 -180인가 (scripts/tune-recency.mjs로 10개 씨앗 × 5개 시나리오 측정):
    //   직전 재회 비율이 성수기 31.1%→22.5%, 급수혼합 21.2%→14.9%, 혼복 23.6%→18.0%로
    //   줄었고, 코트 가동률·경기 수 편차는 사실상 그대로였다.
    //   ★ 단, 이 값만 올리면 엔진이 재회를 피하려고 급수가 동떨어진 사람을 끼워 넣는
    //     쪽으로 도망간다. 그래서 LONELY_LEVEL을 25 → 55로 같이 올려 그 도피로를 막았다.
    //     둘은 한 세트다 — 하나만 바꾸지 말 것.
    //
    // ※ 인원이 빠듯한 날(12명 이하에 코트를 꽉 채우는 경우)은 전원이 매 경기 코트에
    //   들어가므로 직전 재회를 피할 방법이 물리적으로 없다. 그 상황에서 이 값을 더 올려도
    //   재회는 안 줄고 급수만 어긋난다 — 시뮬레이션에서 확인됨.
    RECENT_MET_STEPS: [180, 40, 0],

    // ── ② 대기 시간 (2순위) — 오래 기다릴수록 1분의 가치가 커진다 ──
    WAIT_PER_MIN: 2,       // 대기 1분당 +2 (처음 WAIT_KNEE분까지)
    WAIT_LONG_PER_MIN: 4,  // WAIT_KNEE분을 넘긴 뒤부터는 1분당 +4 (점점 급해짐)
    WAIT_KNEE: 15,         // 이 분수를 넘기면 '오래 기다리는 중'으로 본다
    WAIT_CAP: 60,          // 대기 시간 인정 상한 (분)

    // ── ③ 급수 밸런스 (3순위) — 팀을 랜덤으로 짜므로 4명 전체 기준 ──
    // 급수 폭 3(A조와 D조가 한 코트)은 '절대 재미없는 경기'라서 재회 감점 상한(-272)과
    // 견줄 만큼 크게 잡는다. 안 그러면 겹침을 피하려고 A+D를 섞는 경기가 나온다.
    SPREAD_PENALTY: [0, 8, 30, 150], // 4명 중 최고↔최저 급수 차이가 0/1/2/3일 때 감점
    // 나머지 3명 평균과 급수가 LONELY_GAP 이상 차이 나는 '혼자 동떨어진' 선수: 차이 1당 -55.
    // 25에서 55로 올린 이유: RECENT_MET_STEPS를 세게 잡자, 엔진이 직전 재회를 피하려고
    // "급수가 혼자 뜨는 사람"을 끼워 넣는 쪽으로 도망갔다. 이 둘은 한 세트로 움직인다.
    // (재회 감점만 올리고 이걸 그대로 두면 2급수 이상 차이 나는 경기가 늘어난다)
    LONELY_LEVEL: 55,

    // ── ④ 경기 수 (4순위) — 2경기 차이까지는 너그럽게, 그 이상은 구출 ──
    GAME_TOLERANCE: 2,   // 이 경기 수 차이까지는 "비슷하게 쳤다"로 본다
    GAME_GAP_SOFT: 15,   // 최다 경기자와의 차이 중 2경기까지: 1경기당 +15
    GAME_GAP_HARD: 80,   // 3경기째부터: 1경기당 +80 (많이 밀린 사람 구출 — 급수가 안 맞아도 굶기지는 않는다)
    COMBO_GAP_OVER: 15,  // 조합 안 경기 수 차이가 2를 넘는 부분 1경기당 -15

    // ── ⑤ 급수 다양성 · 매너리즘(ABAB) 해소 (5순위) ──
    THIRST_RELIEF: 20,   // 계속 급수가 안 맞던 사람에게 비슷한 급수 경기를 주면 +20
    THIRST_REPEAT: 15,   // 그런 사람에게 또 안 맞는 경기를 주면 -15

    // ── 바로 시작 가능한지 (예약의 대가) ──
    //  경기중인 선수를 예약에 넣으면, 같이 묶인 '대기 중인 선수'도 그 코트가 끝날 때까지
    //  발이 묶인다. 시뮬레이션에서 이걸 무시했더니 코트 가동률이 43경기 → 34경기로
    //  떨어졌다. 그래서 "얼마나 기다려야 하는지"를 분 단위로 계산해 감점한다.
    ON_COURT: 14,        // 경기중인 선수 1명당 -14 (같이 묶이는 대기 선수의 손해)
    WAIT_MIN: 4,         // 예상 대기 1분당 -4 (막 시작한 코트는 크게 감점)
    EXTRA_COURT: 12,     // 기다려야 하는 코트가 하나 더 늘 때마다 -12
    ALL_ON_COURT: 120,   // 4명 전원이 경기중이면 추가 -120
    FREE_COURT_MISS: 40, // 빈 코트가 있는데 굳이 예약을 만들 때 1명당 -40
    // 예약은 한 번에 하나만. 이미 '코트 끝나기를 기다리는 경기'가 목록에 있는데 또 만들면
    // 목록 전체가 대기 상태가 되어 코트가 논다. (시뮬레이션에서 가동률 8% 손실로 확인)
    SECOND_RESERVE: 90,  // 대기 중인 예약이 이미 있을 때, 경기중 선수 1명당 추가 -90

    // ── 절대 금지 ──
    SAME_FOUR: 1000,     // 직전 경기와 완전히 똑같은 4명 -1000 (사실상 후보에서 제외)
};

/**
 * 최근 몇 경기까지를 "방금 쳤다"로 볼지 (0 = 직전 경기).
 * ※ 점수 감점은 W.RECENT_MET_STEPS가 경기별 계단으로 따로 계산한다.
 *   이 값은 품질 등급(qualityOf)과 안내 문구에서 "방금 만난 짝"을 세는 기준.
 */
const RECENT_WINDOW = 2;
/** 급수 매너리즘을 판단할 때 몇 경기를 되돌아볼지 */
const THIRST_WINDOW = 3;
/** 급수 차이가 이 정도 이상이면 "나랑 급수가 안 맞는 경기"로 본다 */
const THIRST_GAP = 0.9;
/**
 * '혼자 동떨어짐' 판정 기준 — 나머지 3명 평균과 이 이상 차이 나야 감점한다.
 * 1칸 차이(예: A조 1명 + B조 3명)는 충분히 좋은 경기라서 봐준다.
 * 여기를 0.9처럼 낮추면 급수 소수자(예: A조 여자 2명)가 계속 서로만 묶이는
 * 부작용이 생긴다 — 시뮬레이션으로 확인됨. 낮추기 전에 스트레스 테스트를 돌릴 것.
 */
const LONELY_GAP = 1.5;

/** 조합 폭발 방지 — 한 성별에서 이 인원을 넘으면 '덜 친 순'으로 잘라서 계산한다 */
const MAX_POOL_SINGLE = 30;
const MAX_POOL_MIXED = 18;

/** 배드민턴 한 경기가 보통 몇 분 걸리는지 (남은 대기 시간 추정에 쓴다) */
const TYPICAL_GAME_MIN = 15;
/** 이제 막 시작한 코트(이 시간 미만)의 선수는 예약 후보에서 뺀다 — 너무 오래 기다려야 한다 */
const MIN_ELAPSED_TO_RESERVE = 5;

/**
 * 대기 시간을 점수로 바꾼다. (오래 기다릴수록 1분의 가치가 커지는 꺾인 직선)
 *   · 처음 15분: 1분당 +2  (잠깐 쉬는 건 자연스러운 일)
 *   · 15분 이후: 1분당 +4  (이제 슬슬 지루해진다 — "나 경기 안 한 지 오래됐는데요")
 *   · 60분에서 상한 (최대 +210)
 */
function waitBonus(waitMin) {
    const w = Math.min(Math.max(0, waitMin), W.WAIT_CAP);
    const base = Math.min(w, W.WAIT_KNEE);
    const long = Math.max(0, w - W.WAIT_KNEE);
    return base * W.WAIT_PER_MIN + long * W.WAIT_LONG_PER_MIN;
}

/**
 * 저장된 시각으로부터 지금까지 몇 분이 지났는지. 값이 없거나 깨졌으면 0.
 *
 * 왜 필요한가: 시각 값 하나만 깨져도 new Date(x).getTime()이 NaN을 내놓고,
 * 그 NaN이 점수 전체로 번져서 '베스트/보통/아쉬움' 순위가 조용히 무의미해진다.
 * (화면에는 아무 오류도 안 뜨기 때문에 알아채기 어렵다)
 * 지금은 모든 시각이 ISO 문자열로 저장되지만, 예전 기록이나 수동 편집이
 * 섞여 들어와도 매칭이 망가지지 않도록 여기서 한 번 걸러낸다.
 */
function minutesSince(timestamp, now) {
    if (!timestamp) return 0;
    const ms = new Date(timestamp).getTime();
    if (!Number.isFinite(ms)) return 0;
    return Math.max(0, (now - ms) / 60000);
}


// ===================================================================================
// 2. 매칭 컨텍스트 만들기
//    "지금 이 순간의 체육관 상황"을 매칭 계산용으로 한 번에 정리해 둔 것.
// ===================================================================================

/**
 * 선수 2명 사이의 만남 기록을 저장할 때 쓰는 키 (순서 상관없이 항상 같은 키)
 */
function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * [핵심] 매칭에 필요한 모든 정보를 한 번에 계산한다.
 *
 * @param {object} allPlayers - 전체 선수 데이터 { id: player }
 * @param {object} gameState  - 현재 게임 상태 (코트 / 자동매칭 / 경기예정)
 * @param {object} [opts]
 * @param {number} [opts.now] - 현재 시각 (테스트용으로 고정할 수 있게 인자로 받는다)
 * @returns {object} ctx
 */
function buildMatchContext(allPlayers, gameState, opts = {}) {
    const now = opts.now ?? Date.now();
    const courts = gameState?.inProgressCourts || [];
    const autoMatches = gameState?.autoMatches || {};
    const scheduledMatches = gameState?.scheduledMatches || {};

    // ── (1) 지금 코트에서 뛰는 선수 정리 ──
    //    누가 몇 번 코트인지, 지금 같은 팀은 누구고 상대는 누군지까지 뽑아둔다.
    const onCourtInfo = {};
    courts.forEach((court, courtIndex) => {
        if (!court || !Array.isArray(court.players)) return;
        const teamA = [court.players[0], court.players[1]].filter(Boolean);
        const teamB = [court.players[2], court.players[3]].filter(Boolean);
        court.players.filter(Boolean).forEach(id => {
            const inA = teamA.includes(id);
            onCourtInfo[id] = {
                courtIndex,
                startTime: court.startTime,
                partners: (inA ? teamA : teamB).filter(x => x !== id),
                opponents: inA ? teamB : teamA,
            };
        });
    });

    // ── (2) 이미 '다음 경기'가 잡혀 있는 선수 ──
    //    자동 매칭 목록과 경기 예정 목록에 이름이 올라간 사람은 후보에서 뺀다.
    //    (안 그러면 한 사람이 두 경기에 동시에 배정되는 사고가 난다)
    const queuedIds = new Set();
    const queuedWhere = {};
    Object.entries(autoMatches).forEach(([key, m]) => {
        (m || []).forEach(id => { if (id) { queuedIds.add(id); queuedWhere[id] = { type: 'auto', index: Number(key) }; } });
    });
    Object.entries(scheduledMatches).forEach(([key, m]) => {
        (m || []).forEach(id => { if (id) { queuedIds.add(id); queuedWhere[id] = { type: 'schedule', index: Number(key) }; } });
    });

    const levelValueOf = (id) => LEVEL_BALANCE_MAP[allPlayers?.[id]?.level] || 3;

    // ── (3) 선수별 통계 ──
    const stats = {};
    Object.values(allPlayers || {}).forEach(p => {
        if (!p || p.status !== 'active') return;

        const court = onCourtInfo[p.id] || null;
        const realHistory = Array.isArray(p.todayRecentGames) ? p.todayRecentGames : [];

        // 경기중이면 '지금 치는 경기'를 가짜 기록으로 맨 앞에 끼워 넣는다.
        // 이 한 줄 덕분에 경기 수 +1, 지금 파트너와 또 만나기 방지가 자동으로 처리된다.
        const history = court
            ? [{
                timestamp: court.startTime || new Date(now).toISOString(),
                partners: court.partners,
                opponents: court.opponents,
                isVirtual: true,
              }, ...realHistory]
            : realHistory;

        // 마지막으로 경기를 끝낸 시각 (없으면 입장 시각)
        const lastRealTs = realHistory[0]?.timestamp || p.entryTime;
        const waitMin = court
            ? 0 // 코트에서 뛰는 중이면 '기다리는 중'이 아니다
            : minutesSince(lastRealTs, now);

        // 경기중이라면 지금 몇 분째 뛰고 있고, 앞으로 몇 분쯤 남았는지 (예약 판단용)
        const elapsedMin = court ? minutesSince(court.startTime, now) : 0;
        const remainingMin = court ? Math.max(0, TYPICAL_GAME_MIN - elapsedMin) : 0;

        stats[p.id] = {
            id: p.id,
            name: p.name,
            gender: p.gender,
            level: p.level,
            levelValue: LEVEL_BALANCE_MAP[p.level] || 3,
            isGuest: !!p.isGuest,
            isResting: !!p.isResting,
            games: history.length,          // 진행 중인 경기까지 포함한 오늘 경기 수
            realGames: realHistory.length,  // 실제로 끝낸 경기 수 (화면 표시용)
            history,
            onCourt: !!court,
            courtIndex: court ? court.courtIndex : null,
            waitMin,
            elapsedMin,
            remainingMin,
            queued: queuedIds.has(p.id),
            queuedWhere: queuedWhere[p.id] || null,
            thirst: 0,
            thirstDir: null,
        };
    });

    // ── (4) 급수 매너리즘(ABAB) 계산 ──
    //    최근 경기들에서 "나 혼자 급수가 동떨어져 있었나"를 세어본다.
    //    계속 그랬다면 다음 경기는 비슷한 급수끼리 붙여줘야 한다.
    Object.values(stats).forEach(s => {
        const recent = s.history.slice(0, THIRST_WINDOW).filter(g => g && !g.isManual);
        if (recent.length === 0) return;

        let mismatch = 0;
        let strongerCount = 0;
        recent.forEach(g => {
            const others = [...(g.partners || []), ...(g.opponents || [])].filter(Boolean);
            if (others.length === 0) return;
            const avg = others.reduce((sum, id) => sum + levelValueOf(id), 0) / others.length;
            const gap = s.levelValue - avg; // 음수면 내가 더 잘 치는 쪽
            if (Math.abs(gap) >= THIRST_GAP) {
                mismatch += 1;
                if (gap < 0) strongerCount += 1;
            }
        });

        // 2경기 연속 어긋났으면 갈증 최대치(1)
        s.thirst = Math.min(1, mismatch / 2);
        s.thirstDir = mismatch === 0 ? null : (strongerCount * 2 >= mismatch ? 'stronger' : 'weaker');
    });

    // ── (5) 누가 누구와 몇 번 만났는지 색인 ──
    //    조합 하나를 채점할 때마다 기록을 뒤지면 느리므로 미리 표를 만들어 둔다.
    const pairs = new Map();
    const addPair = (a, b, field, idx, ts) => {
        if (!a || !b || a === b) return;
        const k = pairKey(a, b);
        let e = pairs.get(k);
        if (!e) {
            e = { together: 0, against: 0, recency: Infinity, seen: new Set() };
            pairs.set(k, e);
        }
        // 같은 경기를 양쪽 선수 기록에서 두 번 세지 않도록 timestamp로 중복 제거
        const sig = `${ts}|${field}`;
        if (!e.seen.has(sig)) {
            e.seen.add(sig);
            e[field] += 1;
        }
        if (idx < e.recency) e.recency = idx;
    };

    Object.values(stats).forEach(s => {
        s.history.forEach((g, idx) => {
            if (!g || g.isManual) return;
            const ts = g.timestamp || `i${idx}`;
            (g.partners || []).forEach(other => addPair(s.id, other, 'together', idx, ts));
            (g.opponents || []).forEach(other => addPair(s.id, other, 'against', idx, ts));
        });
    });

    // ── (6) 지금 비어 있는 코트가 몇 개인지 ──
    //    빈 코트가 있으면 "바로 시작할 수 있는 조합"을 우선 추천해야 한다.
    const courtCount = gameState?.numInProgressCourts ?? courts.length;
    let freeCourts = 0;
    for (let i = 0; i < courtCount; i += 1) {
        if (!courts[i]) freeCourts += 1;
    }

    return { now, stats, pairs, queuedIds, onCourtInfo, freeCourts };
}

/** 두 선수의 오늘 만남 기록을 꺼낸다. 만난 적 없으면 기본값을 돌려준다. */
function getPair(ctx, a, b) {
    return ctx.pairs.get(pairKey(a, b)) || { together: 0, against: 0, recency: Infinity };
}


// ===================================================================================
// 3. 팀 나누기 (2:2) — ★ 화면 표시용 제안일 뿐, 점수 계산에는 쓰지 않는다
//    실제로는 코트에 들어간 4명이 팀을 랜덤으로 짜기 때문에, 여기서 나눈 팀은
//    "이렇게 나누면 균형이 맞아요"라는 참고용 배치일 뿐이다.
//    (혼복은 남1+여1 팀 규칙이 있으므로 표시 순서가 실제로도 의미가 있다)
// ===================================================================================

/**
 * 4명을 두 팀으로 나눈다. (표시 순서 결정용)
 * 1순위: 두 팀의 급수 합 차이가 작을 것
 * 2순위: 같은 팀끼리 오늘 덜 만났을 것
 *
 * @param {Array} comboStats 4명 (stats 객체)
 * @param {object} ctx
 * @param {boolean} isMixed 혼복이면 반드시 남1+여1 vs 남1+여1
 * @returns {{order: Array, diff: number, spread: number}}
 */
function splitTeams(comboStats, ctx, isMixed) {
    const v = comboStats.map(p => p.levelValue);
    const spread = Math.max(...v) - Math.min(...v);

    // 혼복은 [남,남,여,여] 순으로 들어오므로 짝짓는 방법이 두 가지뿐이다
    const splitPlans = isMixed
        ? [[[0, 2], [1, 3]], [[0, 3], [1, 2]]]
        : [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];

    let best = null;
    for (const [t1, t2] of splitPlans) {
        const diff = Math.abs((v[t1[0]] + v[t1[1]]) - (v[t2[0]] + v[t2[1]]));
        // 같은 팀끼리 오늘 몇 번 같은 편이었는지 (적을수록 좋다)
        const partnerRepeat =
            getPair(ctx, comboStats[t1[0]].id, comboStats[t1[1]].id).together +
            getPair(ctx, comboStats[t2[0]].id, comboStats[t2[1]].id).together;

        const key = diff * 10 + partnerRepeat; // 급수 차이가 우선, 같으면 덜 만난 쪽
        if (!best || key < best.key) {
            best = {
                key,
                diff,
                order: [comboStats[t1[0]], comboStats[t1[1]], comboStats[t2[0]], comboStats[t2[1]]],
            };
        }
    }
    return { order: best.order, diff: best.diff, spread };
}


// ===================================================================================
// 4. 조합 하나 분석하기 (점수 + 이유)
// ===================================================================================

/**
 * 4인 조합을 채점하고, 왜 그런 점수인지 '사실'까지 함께 정리한다.
 * ★ 팀 나누기와 무관하게 '4명 묶음' 기준으로 채점한다. (코트에서 팀은 랜덤이므로)
 *
 * @param {Array} comboStats 4명 (stats 객체)
 * @param {object} ctx buildMatchContext 결과
 * @param {object} poolInfo { maxGames, minGames }
 * @param {boolean} isMixed
 */
function analyzeCombo(comboStats, ctx, poolInfo, isMixed) {
    // 팀 나누기는 화면에 보여줄 순서를 정할 뿐, 아래 점수 계산에는 쓰지 않는다
    const { order, spread: levelSpread } = splitTeams(comboStats, ctx, isMixed);
    const freeCourts = ctx.freeCourts ?? 0;

    let score = 0;

    // ── ① 겹침 방지 (1순위): 오늘 만난 사람과 또 안 묶이게 ──
    //    4명이 만드는 6쌍을 전부 보고, 같은 팀이었든 상대였든 '만난 것'으로 센다.
    let novelty = 0;
    const freshPairs = [];
    const metPairs = [];
    const recentPairs = [];
    const lastGamePairs = [];

    const pairList = getAllCombinations(comboStats, 2);
    for (const [p1, p2] of pairList) {
        const info = getPair(ctx, p1.id, p2.id);
        const meetings = info.together + info.against;

        if (meetings === 0) {
            novelty += W.FRESH_PAIR;
            freshPairs.push([p1.name, p2.name]);
            continue;
        }

        const isRecent = info.recency < RECENT_WINDOW;
        const cappedMeetings = Math.min(meetings, W.MET_CAP);
        novelty -= cappedMeetings * cappedMeetings * W.MET_AGAIN; // 만난 횟수의 제곱 — 위 W.MET_AGAIN 주석 참고
        // 최근성 감점: 바로 직전 경기(recency 0)가 가장 크고, 계단식으로 줄어 몇 경기 지나면 0
        novelty -= W.RECENT_MET_STEPS[info.recency] ?? 0;
        if (info.recency === 0) lastGamePairs.push([p1.name, p2.name]);
        if (isRecent) recentPairs.push([p1.name, p2.name]);
        metPairs.push({ names: [p1.name, p2.name], meetings, recent: isRecent });
    }
    score += novelty;

    // ── ② 대기 시간 (2순위): 오래 기다린 사람 먼저 ──
    let waitScore = 0;
    comboStats.forEach(p => { waitScore += waitBonus(p.waitMin); });
    score += waitScore;

    // ── ③ 급수 밸런스 (3순위): 4명 전체 기준 ──
    //    팀이 랜덤이므로 "급수 폭이 좁을수록 어떤 팀이 나와도 균형"이라는 원리로 본다.
    //    + 혼자 급수가 동떨어진 선수(예: A조 1명 + D조 3명)는 추가 감점.
    const spreadIdx = Math.min(W.SPREAD_PENALTY.length - 1, Math.max(0, Math.round(levelSpread)));
    let balance = -W.SPREAD_PENALTY[spreadIdx];
    const lonelyNames = [];
    comboStats.forEach(p => {
        const others = comboStats.filter(x => x.id !== p.id);
        const avg = others.reduce((sum, o) => sum + o.levelValue, 0) / others.length;
        const gap = Math.abs(p.levelValue - avg);
        if (gap >= LONELY_GAP) {
            balance -= gap * W.LONELY_LEVEL;
            lonelyNames.push(p.name);
        }
    });
    score += balance;

    // ── ④ 경기 수 (4순위): 2경기 차이까지는 너그럽게 ──
    //    비교 기준은 '같은 성별에서 가장 많이 친 사람' (혼복에서 남녀 슬롯 수가 다르므로)
    let gamesScore = 0;
    comboStats.forEach(p => {
        const genderMax = poolInfo.maxGamesBy?.[p.gender] ?? poolInfo.maxGames;
        const gap = Math.max(0, genderMax - p.games);
        gamesScore += Math.min(gap, W.GAME_TOLERANCE) * W.GAME_GAP_SOFT; // 2경기까지는 살짝만
        gamesScore += Math.max(0, gap - W.GAME_TOLERANCE) * W.GAME_GAP_HARD; // 3경기째부터 구출
    });
    const gamesList = comboStats.map(p => p.games);
    const gamesMin = Math.min(...gamesList);
    const gamesMax = Math.max(...gamesList);
    // 조합 안에서도 2경기 차이까지는 자연스러운 것 — 그 이상만 감점
    // (이 비교도 같은 성별끼리만 — 혼복에서 남녀 경기 수는 원래 다르게 쌓이므로)
    const gamesByGender = {};
    comboStats.forEach(p => {
        (gamesByGender[p.gender] = gamesByGender[p.gender] || []).push(p.games);
    });
    let comboGap = 0;
    Object.values(gamesByGender).forEach(list => {
        comboGap = Math.max(comboGap, Math.max(...list) - Math.min(...list));
    });
    gamesScore -= Math.max(0, comboGap - W.GAME_TOLERANCE) * W.COMBO_GAP_OVER;
    score += gamesScore;

    // ── ⑤ 급수 매너리즘 해소 (5순위, ABAB 방지) ──
    let thirstScore = 0;
    const thirstRelieved = [];
    comboStats.forEach(p => {
        if (p.thirst <= 0) return;
        const others = comboStats.filter(x => x.id !== p.id);
        const avg = others.reduce((sum, o) => sum + o.levelValue, 0) / others.length;
        const gap = Math.abs(p.levelValue - avg);
        if (gap < 0.6) {
            thirstScore += p.thirst * W.THIRST_RELIEF;
            thirstRelieved.push(p.name);
        } else if (gap >= THIRST_GAP) {
            thirstScore -= p.thirst * W.THIRST_REPEAT;
        }
    });
    score += thirstScore;

    // ── ⑥ 지금 바로 시작할 수 있는가 ──
    //  경기중 선수를 예약에 넣으면 같이 뽑힌 대기 선수까지 그 코트가 끝날 때까지 묶인다.
    //  그래서 "몇 분이나 기다려야 하는지"를 실제로 계산해서 감점한다.
    //  (막 시작한 코트 = 큰 감점 / 곧 끝나는 코트 = 작은 감점)
    const onCourtPlayers = comboStats.filter(p => p.onCourt);
    const waitCourts = [...new Set(onCourtPlayers.map(p => p.courtIndex))].sort((a, b) => a - b);
    // 가장 늦게 끝나는 코트를 기다려야 하므로 최댓값을 쓴다
    const waitEstimateMin = onCourtPlayers.length
        ? Math.max(...onCourtPlayers.map(p => p.remainingMin))
        : 0;

    let startability = 0;
    startability -= onCourtPlayers.length * W.ON_COURT;
    startability -= waitEstimateMin * W.WAIT_MIN;
    if (waitCourts.length > 1) startability -= (waitCourts.length - 1) * W.EXTRA_COURT;
    if (onCourtPlayers.length === 4) startability -= W.ALL_ON_COURT;
    // 빈 코트가 있는데 굳이 기다려야 하는 조합을 만들면 코트가 논다 → 크게 감점
    if (freeCourts > 0) startability -= onCourtPlayers.length * W.FREE_COURT_MISS;
    // 이미 대기 중인 예약이 목록에 있으면, 또 예약을 만들지 않도록 크게 감점
    if (poolInfo.pendingReservations > 0) startability -= onCourtPlayers.length * W.SECOND_RESERVE;
    score += startability;

    // ── ⑦ 직전 경기와 똑같은 4명이면 사실상 금지 ──
    //    4명 모두가 "서로 방금(직전 경기) 만났다"면 같은 경기를 그대로 재탕하는 것이다.
    const sameFour = pairList.every(([p1, p2]) => getPair(ctx, p1.id, p2.id).recency === 0);
    if (sameFour) score -= W.SAME_FOUR;

    // ── 사유 문장에 쓸 사실들 ──
    const poolSpread = poolInfo.maxGames - poolInfo.minGames;
    const leastPlayedNames = poolSpread > 0
        ? comboStats.filter(p => p.games === poolInfo.minGames).map(p => p.name)
        : [];

    // 오래 기다린 선수 (15분 이상, 오래 기다린 순)
    const longWaiters = comboStats
        .filter(p => !p.onCourt && p.waitMin >= W.WAIT_KNEE)
        .sort((a, b) => b.waitMin - a.waitMin)
        .map(p => ({ name: p.name, waitMin: Math.round(p.waitMin) }));

    const facts = {
        names: comboStats.map(p => p.name),
        gamesMin,
        gamesMax,
        allSameGames: gamesMin === gamesMax,
        leastPlayedNames,
        freshPairs,
        metPairs,
        recentPairs,
        lastGamePairs,
        levelSpread,
        lonelyNames,
        longWaiters,
        thirstRelieved,
        onCourtNames: onCourtPlayers.map(p => p.name),
        waitCourts,
        waitEstimateMin: Math.round(waitEstimateMin),
        sameFour,
    };

    return {
        score: Math.round(score),
        order,
        facts,
        parts: {
            novelty: Math.round(novelty),
            wait: Math.round(waitScore),
            balance: Math.round(balance),
            games: Math.round(gamesScore),
            thirst: Math.round(thirstScore),
            startability: Math.round(startability),
        },
    };
}


// ===================================================================================
// 5. 이유 문장 만들기
//    관리자가 0.5초 안에 이해할 수 있도록 짧게, 구체적인 이름과 숫자를 넣는다.
// ===================================================================================

// 사람 이름 뒤에 조사(은/는, 이/가)를 붙이면 "남8가"처럼 어색해지므로,
// 이름은 항상 문장 끝이나 콜론 뒤에 두는 방식으로 문구를 만든다.
function buildReasonLines(facts) {
    const lines = [];
    const nameList = (arr, limit = 3) => {
        const shown = arr.slice(0, limit).join('·');
        return arr.length > limit ? `${shown} 외 ${arr.length - limit}명` : shown;
    };

    // ① 겹침 이야기 (1순위 — 가장 먼저)
    //    팀·상대 구분 없이 "오늘 만난 적 있는 짝"으로 말한다.
    if (facts.sameFour) {
        lines.push({ tone: 'bad', text: '방금 끝난 경기와 완전히 같은 4명' });
    } else if (facts.lastGamePairs.length > 0) {
        const pairText = facts.lastGamePairs.map(p => p.join('·')).slice(0, 2).join(', ');
        lines.push({ tone: 'bad', text: `바로 직전 경기에서 만난 짝: ${pairText}` });
    } else if (facts.recentPairs.length > 0) {
        const pairText = facts.recentPairs.map(p => p.join('·')).slice(0, 2).join(', ');
        lines.push({ tone: 'bad', text: `최근 경기에서 만난 짝: ${pairText}` });
    } else if (facts.metPairs.length === 0) {
        lines.push({ tone: 'good', text: '4명 모두 오늘 처음 만나는 조합!' });
    } else if (facts.metPairs.length === 1) {
        lines.push({ tone: 'good', text: `만난 적 있는 짝: ${facts.metPairs[0].names.join('·')} (나머지 5쌍은 처음!)` });
    } else if (facts.metPairs.length === 2) {
        const pairText = facts.metPairs.map(m => m.names.join('·')).join(', ');
        lines.push({ tone: 'mid', text: `겹치는 짝: ${pairText} (나머지 4쌍은 처음)` });
    } else {
        lines.push({ tone: 'bad', text: `오늘 이미 만난 짝이 ${facts.metPairs.length}쌍 — 겹침이 많아요` });
    }

    // ② 오래 기다린 사람 (2순위 — 있을 때만 별도 줄로 강조)
    if (facts.longWaiters.length > 0) {
        const top = facts.longWaiters[0];
        const extra = facts.longWaiters.length > 1 ? ` 외 ${facts.longWaiters.length - 1}명` : '';
        lines.push({ tone: 'good', text: `오래 기다린 선수: ${top.name} (${top.waitMin}분째)${extra}` });
    }

    // ③ 급수 밸런스 (4명 전체 기준 — 팀은 코트에서 랜덤으로 짜므로)
    if (facts.thirstRelieved.length > 0) {
        lines.push({ tone: 'good', text: `급수 맞는 경기가 필요했던 선수: ${nameList(facts.thirstRelieved, 2)} ✨` });
    } else if (facts.levelSpread === 0) {
        lines.push({ tone: 'good', text: '전원 같은 급수 — 팽팽한 경기' });
    } else if (facts.levelSpread === 1) {
        lines.push({ tone: 'good', text: '급수가 비슷해서 어떻게 팀을 짜도 균형이 맞아요' });
    } else if (facts.levelSpread >= 3) {
        lines.push({ tone: 'bad', text: '급수 차이가 커요 (최고↔최저 3급수)' });
    } else if (facts.lonelyNames.length > 0) {
        lines.push({ tone: 'bad', text: `급수가 혼자 동떨어진 선수: ${nameList(facts.lonelyNames, 2)}` });
    } else {
        lines.push({ tone: 'mid', text: '급수는 그럭저럭 맞아요' });
    }

    // ④ 경기 수 (2경기 차이까지는 자연스러운 것으로 본다)
    if (facts.allSameGames) {
        lines.push({ tone: 'good', text: `4명 모두 ${facts.gamesMin}경기로 딱 같아요` });
    } else if (facts.leastPlayedNames.length > 0) {
        lines.push({ tone: 'good', text: `가장 적게 친 선수 포함: ${nameList(facts.leastPlayedNames, 2)} (${facts.gamesMin}경기)` });
    } else if (facts.gamesMax - facts.gamesMin > 2) {
        lines.push({ tone: 'bad', text: `경기 수 ${facts.gamesMin}~${facts.gamesMax}경기 — 차이가 커요` });
    } else {
        lines.push({ tone: 'mid', text: `경기 수 ${facts.gamesMin}~${facts.gamesMax}경기로 비슷` });
    }

    // ⑤ 경기중인 선수가 있으면 반드시 알려준다 (몇 분쯤 기다려야 하는지까지)
    if (facts.onCourtNames.length > 0) {
        const courtText = facts.waitCourts.map(c => `${c + 1}번`).join('·');
        const waitText = facts.waitEstimateMin > 0 ? ` (약 ${facts.waitEstimateMin}분)` : ' (곧 끝나요)';
        lines.push({ tone: 'wait', text: `${courtText} 코트 끝나야 시작${waitText} — 경기중: ${nameList(facts.onCourtNames, 4)}` });
    }

    return lines;
}

/**
 * 조합의 '진짜 품질'을 등급으로 매긴다. (순위와 별개로 보는 절대 평가)
 *
 * 순위만으로 '베스트'라고 부르면, 후보가 다 나쁜 상황에서도 1등이 금색으로 빛나서
 * 관리자가 오해한다. 그래서 절대 품질을 따로 계산해 두고,
 * 최선이 별로일 때는 화면 위에 "지금은 좋은 조합이 없어요" 안내를 띄운다.
 */
function qualityOf(facts) {
    if (facts.sameFour) return 'poor';
    if (facts.recentPairs.length >= 2) return 'poor';
    if (facts.metPairs.length >= 4) return 'poor';
    if (facts.recentPairs.length === 1) return 'fair';
    if (facts.metPairs.length >= 2) return 'fair';
    if (facts.levelSpread >= 3) return 'fair';
    return 'good';
}


// ===================================================================================
// 6. 선택지 생성 (베스트 2 / 보통 2 / 아쉬움 2)
// ===================================================================================

const TIERS = {
    best:   { key: 'best',   label: '베스트', emoji: '🏆' },
    normal: { key: 'normal', label: '보통',   emoji: '👍' },
    bad:    { key: 'bad',    label: '아쉬움', emoji: '⚠️' },
};

/** 두 조합이 몇 명이나 겹치는지 */
function overlapCount(idsA, idsB) {
    const setB = new Set(idsB);
    return idsA.reduce((n, id) => n + (setB.has(id) ? 1 : 0), 0);
}

/**
 * 조합 폭발 시 후보를 잘라내는 기준 — "급한 사람"부터 남긴다.
 * 점수 공식과 같은 감각으로: 대기 보너스가 크고, 경기를 덜 친 사람이 급한 사람.
 * (경기 수만으로 자르면 "6경기 쳤지만 40분 기다린 사람"이 잘려나가는 사고가 난다)
 */
function urgencyOf(p) {
    return waitBonus(p.waitMin) - p.games * W.GAME_GAP_SOFT;
}
function compareFairness(a, b) {
    return urgencyOf(b) - urgencyOf(a);
}

/**
 * [핵심] 후보 명단을 만든다.
 *
 * 예전에는 '대기석에 있는 사람'만 후보였다. 이제는 이렇게 바뀐다.
 *   포함: 접속(active) 중이고 휴식이 아닌 사람 전원 — 대기석에 있든, 코트에서 뛰는 중이든.
 *   제외: 이미 다음 경기가 잡힌 사람 (자동 매칭 목록 / 경기 예정 목록에 이름이 올라간 사람)
 *         → 한 사람이 두 경기에 동시에 들어가는 사고를 막는다.
 *
 * @param {object} ctx  buildMatchContext 결과
 * @param {string} mode '남' | '여' | '혼복'
 */
function buildCandidatePool(ctx, mode) {
    const isMixed = mode === '혼복';
    return Object.values(ctx.stats).filter(s =>
        !s.isResting &&
        !s.queued &&
        (isMixed ? (s.gender === '남' || s.gender === '여') : s.gender === mode)
    );
}

/**
 * [핵심] 관리자에게 보여줄 매칭 선택지를 만든다.
 *
 * @param {object} params
 * @param {Array}  params.pool     후보 선수들 (stats 객체 배열)
 * @param {object} params.ctx      buildMatchContext 결과
 * @param {string} params.mode     '남' | '여' | '혼복'
 * @param {number} [params.maxOnCourt]  한 조합에 넣을 수 있는 경기중 선수 최대 인원
 * @param {number} [params.pages]  만들 페이지 수 (한 페이지 = 6개)
 * @returns {object}
 */
function generateMatchOptions({ pool, ctx, mode, maxOnCourt = 2, pages = 3, pendingReservations = 0 }) {
    const isMixed = mode === '혼복';

    // ── 인원 체크 ──
    if (isMixed) {
        const m = pool.filter(p => p.gender === '남').length;
        const f = pool.filter(p => p.gender === '여').length;
        if (m < 2 || f < 2) {
            return { status: 'notEnough', isMixed, maleCount: m, femaleCount: f, poolSize: pool.length, pages: [] };
        }
    } else if (pool.length < 4) {
        return { status: 'notEnough', isMixed, poolSize: pool.length, pages: [] };
    }

    // ── 조합 만들기 (너무 많으면 '덜 친 순'으로 잘라서 계산) ──
    let combos;
    if (isMixed) {
        let males = pool.filter(p => p.gender === '남');
        let females = pool.filter(p => p.gender === '여');
        if (males.length > MAX_POOL_MIXED) males = [...males].sort(compareFairness).slice(0, MAX_POOL_MIXED);
        if (females.length > MAX_POOL_MIXED) females = [...females].sort(compareFairness).slice(0, MAX_POOL_MIXED);
        combos = [];
        for (const mp of getAllCombinations(males, 2)) {
            for (const fp of getAllCombinations(females, 2)) {
                combos.push([...mp, ...fp]); // [남,남,여,여] 순서 유지
            }
        }
    } else {
        let cands = pool;
        if (cands.length > MAX_POOL_SINGLE) cands = [...pool].sort(compareFairness).slice(0, MAX_POOL_SINGLE);
        combos = getAllCombinations(cands, 4);
    }

    // ── 경기중 선수를 몇 명까지 넣을지 거르기 ──
    //  ① 인원 제한 (설정의 민감도)
    //  ② 이제 막 시작한 코트의 선수는 제외 — 예약하면 15분을 통째로 기다려야 하고
    //     같이 뽑힌 대기 선수까지 발이 묶인다.
    //  조합이 6개도 안 나오면 제한을 한 단계씩 풀어준다. (매칭이 아예 안 되는 것보다 낫다)
    const pickUsable = (useElapsedGate) => {
        for (let limit = maxOnCourt; limit <= 4; limit += 1) {
            const filtered = combos.filter(c => {
                const oc = c.filter(p => p.onCourt);
                if (oc.length > limit) return false;
                if (useElapsedGate && oc.some(p => p.elapsedMin < MIN_ELAPSED_TO_RESERVE)) return false;
                return true;
            });
            if (filtered.length >= 6) return filtered;
            if (limit === 4 && filtered.length > 0) return filtered;
        }
        return [];
    };
    let usable = pickUsable(true);
    if (usable.length === 0) usable = pickUsable(false);
    if (usable.length === 0) usable = combos;

    // ── 채점 ──
    // 혼복은 남녀 슬롯 수가 달라 경기 수 자체가 다르게 쌓인다.
    // 남자는 남자 최다 기록과, 여자는 여자 최다 기록과 비교해야 공평하다.
    const maxGamesBy = {};
    pool.forEach(p => {
        maxGamesBy[p.gender] = Math.max(maxGamesBy[p.gender] ?? 0, p.games);
    });
    const poolInfo = {
        maxGames: pool.reduce((m, p) => Math.max(m, p.games), 0),
        minGames: pool.reduce((m, p) => Math.min(m, p.games), Infinity),
        maxGamesBy,
        pendingReservations,
    };

    let scored = usable.map(comboStats => {
        const r = analyzeCombo(comboStats, ctx, poolInfo, isMixed);
        return {
            ids: r.order.map(p => p.id),
            players: r.order,
            score: r.score,
            facts: r.facts,
            parts: r.parts,
        };
    });

    // 직전 경기 재탕은 후보에서 아예 뺀다 (다른 선택지가 하나라도 있으면)
    const withoutStale = scored.filter(s => !s.facts.sameFour);
    if (withoutStale.length > 0) scored = withoutStale;

    scored.sort((a, b) => b.score - a.score);
    const total = scored.length;

    // ── 티어 구간 나누기 ──
    //  베스트: 상위 35% / 보통: 35~75% / 아쉬움: 75~100%
    //  (인원이 적어 조합이 몇 개 없으면 구간이 겹치는데, 아래 pick 함수가 알아서 처리한다)
    const bands = [
        { tier: 'best',   from: 0,                          to: Math.max(1, Math.ceil(total * 0.35)) },
        { tier: 'normal', from: Math.floor(total * 0.35),   to: Math.max(2, Math.ceil(total * 0.75)) },
        { tier: 'bad',    from: Math.floor(total * 0.75),   to: total },
    ];

    const taken = new Set();
    const chosenAll = [];

    /** 구간 안에서, 이미 고른 것들과 최대한 안 겹치는 조합을 need개 고른다 */
    const pickFromBand = (from, to, need) => {
        const picked = [];
        for (let maxOv = 2; maxOv <= 4 && picked.length < need; maxOv += 1) {
            for (let i = from; i < to && picked.length < need; i += 1) {
                const cand = scored[i];
                if (!cand || taken.has(i)) continue;
                const clash = [...chosenAll, ...picked].some(o => overlapCount(o.ids, cand.ids) > maxOv);
                if (clash) continue;
                taken.add(i);
                picked.push({ ...cand, rank: i });
            }
        }
        return picked;
    };

    const resultPages = [];
    for (let page = 0; page < pages; page += 1) {
        const pageOptions = [];
        bands.forEach(band => {
            const picked = pickFromBand(band.from, band.to, 2);
            picked.forEach(opt => {
                const tierInfo = TIERS[band.tier];
                const option = {
                    ...opt,
                    tier: band.tier,
                    tierLabel: tierInfo.label,
                    tierEmoji: tierInfo.emoji,
                    quality: qualityOf(opt.facts),
                    reasons: buildReasonLines(opt.facts),
                    onCourtIds: opt.players.filter(p => p.onCourt).map(p => p.id),
                    waitCourts: opt.facts.waitCourts,
                    total,
                };
                pageOptions.push(option);
                chosenAll.push(option);
            });
        });
        if (pageOptions.length === 0) break;
        // 베스트 → 보통 → 아쉬움 순서로 정렬해서 보여준다
        const order = { best: 0, normal: 1, bad: 2 };
        pageOptions.sort((a, b) => (order[a.tier] - order[b.tier]) || (a.rank - b.rank));
        resultPages.push(pageOptions);
    }

    // ── 전체 품질 안내 ──
    //    가장 좋은 선택지조차 별로면, 관리자에게 "지금은 어쩔 수 없다"고 미리 알려준다.
    const topOption = resultPages[0]?.[0];
    const overallQuality = topOption ? topOption.quality : 'poor';
    const waitingCount = pool.filter(p => !p.onCourt).length;
    //  안내 문구는 '진짜 원인'을 짚어야 한다. 겹침이 하나도 없는데 급수 차이 때문에
    //  등급이 내려간 경우까지 "겹치는 사람이 있어요"라고 하면 관리자가 화면을 못 믿게 된다.
    let qualityHint = null;
    if (overallQuality !== 'good') {
        const f = topOption?.facts;
        const hasOverlap = !!f && (f.recentPairs.length > 0 || f.metPairs.length >= 2);
        if (waitingCount < 4) {
            qualityHint = '지금은 대기 중인 선수가 적어서 좋은 조합이 안 나와요. 경기가 하나 끝나면 훨씬 좋아집니다.';
        } else if (hasOverlap) {
            qualityHint = '지금 만들 수 있는 조합은 모두 겹치는 사람이 있어요. 급하지 않다면 경기가 끝난 뒤 다시 눌러보세요.';
        } else {
            qualityHint = '지금 남은 선수들끼리는 급수 차이가 큽니다. 비슷한 급수의 선수가 경기를 끝내면 더 좋은 조합이 나와요.';
        }
    }

    return {
        status: resultPages.length > 0 ? 'ok' : 'notEnough',
        isMixed,
        poolSize: pool.length,
        waitingCount,
        onCourtCount: pool.length - waitingCount,
        totalCombos: total,
        overallQuality,
        qualityHint,
        pages: resultPages,
    };
}


// ===================================================================================
// 7. 설정 프리셋
//    '민감도'는 이제 "경기중인 선수를 얼마나 적극적으로 다음 경기에 넣을지"를 정한다.
//    (예전의 점수 커트라인 방식은 없어졌다 — 이제 관리자가 직접 고르기 때문)
// ===================================================================================

const AUTO_MATCH_SENSITIVITIES = [
    {
        key: 'low', label: '낮음', maxOnCourt: 0, short: '바로 시작 우선',
        desc: '지금 대기 중인 사람들로만 짭니다. 만들면 바로 코트에 보낼 수 있어요.',
    },
    {
        key: 'normal', label: '보통', maxOnCourt: 1, short: '균형 (추천)',
        desc: '경기 수가 적은 사람이 코트에 있으면 1명까지 미리 예약해 둡니다.',
    },
    {
        key: 'high', label: '높음', maxOnCourt: 2, short: '공평 우선',
        desc: '경기중인 선수를 2명까지 넣어, 덜 친 사람이 밀리지 않게 합니다.',
    },
    {
        key: 'max', label: '최고', maxOnCourt: 4, short: '공평 최대',
        desc: '경기중이어도 상관없이 가장 공평한 조합을 만듭니다. 대신 기다려야 해요.',
    },
];

function getSensitivity(key) {
    return AUTO_MATCH_SENSITIVITIES.find(s => s.key === key) || AUTO_MATCH_SENSITIVITIES[1];
}


export {
    // 엔진
    buildMatchContext,
    buildCandidatePool,
    generateMatchOptions,
    analyzeCombo,
    splitTeams,
    buildReasonLines,
    qualityOf,
    // 유틸 · 상수
    getAllCombinations,
    LEVEL_BALANCE_MAP,
    W as MATCH_WEIGHTS,
    TIERS,
    // 설정
    AUTO_MATCH_SENSITIVITIES,
    getSensitivity,
};
