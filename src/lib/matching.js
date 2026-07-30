// ===================================================================================
// 자동 매칭 핵심 로직 (Helper Functions)
// ===================================================================================

/**
 * [자동매칭] k-combination (조합) 생성기
 * @param {Array} arr - 선수 배열
 * @param {number} k - 뽑을 인원 (4)
 * @returns {Array<Array>} 모든 4인 조합
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

/**
 * [자동매칭] 두 선수 간의 최근 경기 기록 확인
 * @param {object} p1 - 선수 1
 * @param {object} p2 - 선수 2
 * @param {Array} p1History - 선수 1의 최근 경기 기록 (p1.todayRecentGames)
 * @returns {{wasPartner: boolean, wasOpponent: boolean, wasRecent: boolean}}
 */
function checkHistory(p1, p2, p1History) {
    let wasPartner = false;
    let wasOpponent = false;
    let wasRecent = true;

    // 최근 5경기만 체크
    const recent5Games = p1History.slice(0, 5);
    if (recent5Games.length === 0) return { wasPartner, wasOpponent, wasRecent: false };

    let foundInRecent5 = false;
    for (const game of recent5Games) {
        if (game.partners.includes(p2.id)) {
            wasPartner = true;
            foundInRecent5 = true;
        }
        if (game.opponents.includes(p2.id)) {
            wasOpponent = true;
            foundInRecent5 = true;
        }
    }
    wasRecent = foundInRecent5;

    // "최근 파트너"와 "최근 상대"는 최근 2경기만 기준으로 함
    const recent2Games = p1History.slice(0, 2);
    wasPartner = recent2Games.some(game => game.partners.includes(p2.id));
    wasOpponent = recent2Games.some(game => game.opponents.includes(p2.id));

    return { wasPartner, wasOpponent, wasRecent };
}

/**
 * [자동매칭] "고인 물" 매치 (4명이 방금 같이 뛴 경기)인지 확인
 * @param {Array<object>} combo - 4인 조합
 * @param {object} allPlayers - 전체 선수 데이터
 * @returns {boolean}
 */
function wasStalePool(combo, allPlayers) {
    if (combo.length !== 4) return false;

    const histories = combo.map(p => allPlayers[p.id]?.todayRecentGames || []);
    const firstGameHistory = histories[0];
    if (!firstGameHistory || firstGameHistory.length === 0) return false;

    const lastGame = firstGameHistory[0];
    const lastGameTimestamp = lastGame.timestamp;
    const lastGamePartners = [combo[0].id, ...lastGame.partners];
    const lastGameOpponents = lastGame.opponents;
    const lastGameAllPlayers = [...lastGamePartners, ...lastGameOpponents];

    // 1. 4명의 선수가 모두 마지막 경기에 포함되어 있는지 확인
    const comboIds = combo.map(p => p.id);
    const allPlayersInLastGame = comboIds.every(id => lastGameAllPlayers.includes(id));
    if (!allPlayersInLastGame) return false;

    // 2. 다른 선수들의 마지막 경기도 동일한 경기인지 (타임스탬프로) 확인
    for (let i = 1; i < 4; i++) {
        const otherHistory = histories[i];
        if (!otherHistory || otherHistory.length === 0 || otherHistory[0].timestamp !== lastGameTimestamp) {
            return false;
        }
    }
    return true;
}

/**
 * [급수 밸런스] 급수를 숫자로 환산 (A조=1 ... D조=4)
 */
const LEVEL_BALANCE_MAP = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 3 };
function getLevelValue(player, allPlayers) {
    const lvl = allPlayers[player.id]?.level || player.level;
    return LEVEL_BALANCE_MAP[lvl] || 3;
}

/**
 * [급수 밸런스] 4인 조합을 2:2 팀으로 나눌 때, 팀 간 급수합 차이가
 * 가장 작아지는 분할(=가장 균형잡힌 팀)을 찾아 반환한다.
 * @returns {{ diff: number, spread: number, order: Array<object> }}
 *  - diff: 두 팀의 급수합 차이 (작을수록 밸런스 좋음)
 *  - spread: 조합 내 최고/최저 급수 차이
 *  - order: 균형잡힌 팀 순서로 재배열된 4인 (slot 0,1 = 팀A / 2,3 = 팀B)
 */
function getBestLevelSplit(combo, allPlayers) {
    if (combo.length !== 4) {
        return { diff: 0, spread: 0, order: combo };
    }
    const v = combo.map(p => getLevelValue(p, allPlayers));
    const splits = [
        [[0, 1], [2, 3]],
        [[0, 2], [1, 3]],
        [[0, 3], [1, 2]],
    ];
    let best = null;
    for (const [t1, t2] of splits) {
        const diff = Math.abs((v[t1[0]] + v[t1[1]]) - (v[t2[0]] + v[t2[1]]));
        if (!best || diff < best.diff) {
            best = { diff, order: [combo[t1[0]], combo[t1[1]], combo[t2[0]], combo[t2[1]]] };
        }
    }
    const spread = Math.max(...v) - Math.min(...v);
    return { diff: best.diff, spread, order: best.order };
}

/**
 * [자동매칭] 4인 조합의 "매치 점수" 계산
 * @param {Array<object>} combo - 4인 조합
 * @param {object} allPlayers - 전체 선수 데이터
 * @param {number} poolAvgGames - 이 풀의 평균 경기 수
 * @param {{now:number, maxGames:number}} [fairnessCtx] - 공평 강화용 컨텍스트(현재시각/최다 경기수)
 * @returns {number} 최종 매치 점수
 */
function calculateMatchScore(combo, allPlayers, poolAvgGames, fairnessCtx) {
    let score = 100;

    // 1. 공평 점수 (경기 수) — 실제 추적되는 todayRecentGames 길이를 사용
    //    (기존 todayWins/Losses는 앱에서 갱신되지 않아 항상 0이었음 → 버그 수정)
    const gamesOf = (p) => (allPlayers[p.id]?.todayRecentGames?.length ?? p.todayRecentGames?.length ?? 0);
    const matchTotalGames = combo.reduce((acc, p) => acc + gamesOf(p), 0);
    const matchAvgGames = matchTotalGames / 4;
    const fairnessScore = (poolAvgGames - matchAvgGames) * 50;
    score += fairnessScore;

    // 2. 조합 점수 (새로운 조합)
    if (wasStalePool(combo, allPlayers)) {
        return -1000; // "고인 물" 매치 킬러
    }

    let noveltyScore = 0;
    const pairs = getAllCombinations(combo, 2); // 6개의 모든 쌍 (1-2, 1-3, ...)

    for (const [p1, p2] of pairs) {
        const p1History = allPlayers[p1.id]?.todayRecentGames || [];
        const { wasPartner, wasOpponent, wasRecent } = checkHistory(p1, p2, p1History);

        if (wasPartner) {
            noveltyScore -= 40; // 최근 파트너 감점
        } else if (wasOpponent) {
            noveltyScore -= 20; // 최근 상대 감점
        } else if (!wasRecent) {
            noveltyScore += 10; // "완전 신선" 가점
        }
    }
    score += noveltyScore;

    // 3. 급수 밸런스 점수 (가중치 낮음 - 우선순위: 경기수 > 안친사람 > 급수)
    // 팀을 2:2로 나눴을 때 급수 차이가 크거나(A,A vs A,C 같은), 조합 내 급수 편차가
    // 큰 경우 약하게 감점한다. 다른 조건이 비슷할 때만 영향을 주도록 가중치를 낮게 둔다.
    const { diff: levelDiff, spread: levelSpread } = getBestLevelSplit(combo, allPlayers);
    score -= levelDiff * 10;   // 팀 간 급수 불균형 페널티 (A,A vs A,C → diff 2 → -20)
    score -= levelSpread * 2;  // 조합 전체 급수 편차 페널티

    // 4. 공평 강화 (대기 시간 + 절대 경기차)
    // 오래 기다렸거나(대기시간) 남들보다 적게 친(경기차) 선수를 끌어올려, "운 없이 계속
    // 밀리는" 사람을 방지한다. 가중치는 약하게 두어 다양성(안친사람)을 크게 해치지 않게 함.
    if (fairnessCtx) {
        let fairnessBoost = 0;
        for (const p of combo) {
            const pdata = allPlayers[p.id] || p;
            const games = pdata.todayRecentGames?.length ?? 0;
            const lastTs = pdata.todayRecentGames?.[0]?.timestamp || pdata.entryTime;
            const waitMin = lastTs ? Math.max(0, (fairnessCtx.now - new Date(lastTs).getTime()) / 60000) : 0;
            fairnessBoost += (fairnessCtx.maxGames - games) * 8 + waitMin * 0.8;
        }
        score += fairnessBoost;
    }

    return Math.round(score);
}

/**
 * [자동매칭] 풀에서 "한 경기"만 만든다. (수동 '매칭 만들기' 버튼 전용)
 *
 * 버튼을 누를 때마다 1경기씩 생성하므로, 왜 못 만들었는지를 UI에서 안내할 수 있도록
 * 실패 사유(status)와 최고 점수를 함께 돌려준다.
 *
 * @param {Array<object>} pool - 선수 풀 (해당 성별의 대기 선수)
 * @param {object} allPlayers - 전체 선수 데이터
 * @param {number} minScore - 최소 매칭 점수 (커트라인)
 * @param {{now:number, maxGames:number}} [fairnessCtx] - 공평 강화 컨텍스트
 * @returns {{status:'ok', match:Array<object>, score:number}
 *          |{status:'notEnough', poolSize:number}
 *          |{status:'belowMinScore', bestScore:number, minScore:number}}
 */
function findSingleBestMatch(pool, allPlayers, minScore, fairnessCtx) {
    const poolSize = pool ? pool.length : 0;
    if (poolSize < 4) return { status: 'notEnough', poolSize };

    const poolAvgGames = pool.reduce(
        (acc, p) => acc + (allPlayers[p.id]?.todayRecentGames?.length ?? p.todayRecentGames?.length ?? 0), 0
    ) / poolSize;

    const allCombos = getAllCombinations(pool, 4);
    if (allCombos.length === 0) return { status: 'notEnough', poolSize };

    // 점수가 가장 높은 조합 1개만 고른다 (점수 기준은 calculateMatchScore 그대로)
    let best = null;
    for (const combo of allCombos) {
        const score = calculateMatchScore(combo, allPlayers, poolAvgGames, fairnessCtx);
        if (!best || score > best.score) best = { combo, score };
    }

    // 최고 조합조차 커트라인에 못 미치면 → "매칭 난이도를 낮추세요" 안내용 결과 반환
    if (best.score < minScore) {
        return { status: 'belowMinScore', bestScore: best.score, minScore };
    }
    return { status: 'ok', match: best.combo, score: best.score };
}

/**
 * [혼복 매칭] 남자 2명 + 여자 2명 조합으로 "한 경기"를 만든다.
 * 점수 기준(공평·다양성·급수·고인물 차단)은 calculateMatchScore를 그대로 사용하고,
 * 조합만 남2+여2로 제한한다.
 * @returns findSingleBestMatch와 동일한 형태 (+notEnough일 때 남/여 인원수)
 */
function findSingleBestMixedMatch(malePool, femalePool, allPlayers, minScore, fairnessCtx) {
    const m = malePool ? malePool.length : 0;
    const f = femalePool ? femalePool.length : 0;
    if (m < 2 || f < 2) return { status: 'notEnough', maleCount: m, femaleCount: f };

    const pool = [...malePool, ...femalePool];
    const poolAvgGames = pool.reduce(
        (acc, p) => acc + (allPlayers[p.id]?.todayRecentGames?.length ?? p.todayRecentGames?.length ?? 0), 0
    ) / pool.length;

    // 남자 2명 조합 × 여자 2명 조합 = 모든 혼복 조합
    const malePairs = getAllCombinations(malePool, 2);
    const femalePairs = getAllCombinations(femalePool, 2);
    let best = null;
    for (const mp of malePairs) {
        for (const fp of femalePairs) {
            const combo = [...mp, ...fp];
            const score = calculateMatchScore(combo, allPlayers, poolAvgGames, fairnessCtx);
            if (!best || score > best.score) best = { combo, score };
        }
    }
    if (best.score < minScore) {
        return { status: 'belowMinScore', bestScore: best.score, minScore };
    }
    return { status: 'ok', match: best.combo, score: best.score };
}

/**
 * [혼복 매칭] 팀 나누기 — 혼복은 반드시 남1+여1 vs 남1+여1.
 * 두 가지 짝 조합 중 팀 간 급수합 차이가 작은 쪽을 골라
 * 슬롯 순서 [남A, 여A, 남B, 여B]로 반환한다. (0,1 = 팀A / 2,3 = 팀B)
 */
function getBestMixedLevelSplit(combo, allPlayers) {
    const [m1, m2, f1, f2] = combo; // findSingleBestMixedMatch가 [남,남,여,여] 순으로 만든다
    const v = (p) => getLevelValue(p, allPlayers);
    const d1 = Math.abs((v(m1) + v(f1)) - (v(m2) + v(f2))); // (m1,f1) vs (m2,f2)
    const d2 = Math.abs((v(m1) + v(f2)) - (v(m2) + v(f1))); // (m1,f2) vs (m2,f1)
    return d1 <= d2 ? [m1, f1, m2, f2] : [m1, f2, m2, f1];
}

/**
 * [자동매칭] 전체 접속 인원(해당 성별: 경기대기 + 경기예정 + 경기진행, 휴식 제외)에 따른
 * "최소 매칭 점수" 커트라인.
 *
 * 실제 매칭 로직(calculateMatchScore)을 그대로 포팅하여 인원수별로
 * 수천 회 세션을 시뮬레이션해서 도출한 값이다.
 *  - 인원이 많을수록 가능한 조합이 많아 "최대한 안 친 사람"끼리 짤 수 있으므로 커트라인을
 *    높여서(엄격) 좋은 조합이 모일 때까지 기다린다. (경기 성사율은 유지)
 *  - 인원이 적으면 나올 수 있는 경우의 수가 적으므로 커트라인을 낮춰(느슨) 바로 매칭한다.
 * 우선순위: 경기수(코트 가동/공평) > 안친사람(다양성) > 급수(밸런스)
 *
 * @param {number} totalPlayers - 해당 성별의 전체 접속 인원(휴식 제외)
 * @returns {number} 최소 매칭 점수 커트라인
 */
function getAutoMatchMinScore(totalPlayers) {
    const n = Math.max(0, Math.floor(totalPlayers || 0));
    if (n < 8) return -100; // 인원이 매우 적으면 거의 무조건 매칭(고인물 -1000만 회피)
    // 인원별 상세 커트라인 (시뮬레이션 기반, 8~25명은 1명 단위로 세분화)
    const TABLE = {
        8: -40, 9: 0, 10: 20, 11: 35, 12: 50, 13: 62, 14: 72, 15: 82,
        16: 92, 17: 98, 18: 104, 19: 108, 20: 112, 21: 116, 22: 120,
        23: 123, 24: 126, 25: 128,
    };
    if (TABLE[n] !== undefined) return TABLE[n];
    return 130; // 26명 이상은 130 고정(상한)
}

/**
 * [자동매칭] 민감도 프리셋. 인원별 기준점수(getAutoMatchMinScore)에 offset을 더해
 * "얼마나 깐깐하게 좋은 조합을 기다릴지"를 직관적으로 조절한다. (수천 회 시뮬레이션으로 확정)
 *  - 낮음: 회전율 우선(바로바로 경기), 대기시간 최소 · 반복 多
 *  - 보통: 균형 (추천 기본값)
 *  - 높음: 다양성 우선(최대한 안 친 사람)
 *  - 최고: 다양성 최대(살짝 더 깐깐)
 */
const AUTO_MATCH_SENSITIVITIES = [
    { key: 'low',    label: '낮음', offset: -60, short: '회전율 우선',  desc: '기다리지 않고 바로 경기를 만듭니다. 사람이 적거나 빨리 많이 치고 싶을 때.' },
    { key: 'normal', label: '보통', offset: -25, short: '균형 (추천)',   desc: '공평함과 다양성을 적절히 맞춥니다. 잘 모르겠으면 이걸 쓰세요.' },
    { key: 'high',   label: '높음', offset: 0,   short: '다양성 우선',   desc: '최대한 안 친 사람과 만나도록 더 신경 써서 매칭합니다.' },
    { key: 'max',    label: '최고', offset: 12,  short: '다양성 최대',   desc: '더 좋은 조합을 위해 살짝 더 깐깐하게 고릅니다. 사람이 많을 때 추천.' },
];
function getSensitivity(key) {
    return AUTO_MATCH_SENSITIVITIES.find(s => s.key === key) || AUTO_MATCH_SENSITIVITIES[1];
}



export {
    getAllCombinations, calculateMatchScore, getBestLevelSplit, getBestMixedLevelSplit,
    findSingleBestMatch, findSingleBestMixedMatch, getAutoMatchMinScore,
    AUTO_MATCH_SENSITIVITIES, getSensitivity,
};