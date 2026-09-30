// ===================================================================================
// 공용 상수·헬퍼 (다른 어떤 모듈도 import하지 않는 최하층)
// ===================================================================================

// ===================================================================================
// [관리자 권한] 관리자 이름 목록
// -----------------------------------------------------------------------------------
// 예전에는 코드에 이름을 박아두어 관리자를 바꾸려면 배포를 다시 해야 했다.
// 이제는 config/season 문서의 adminNames 배열이 기준이며,
// 설정 ▸ 👑 관리자 권한 에서 관리자가 직접 부여/해임할 수 있다.
// (adminNames가 아직 없는 기존 모임은 아래 기본 관리자가 그대로 적용된다)
// ===================================================================================
const DEFAULT_ADMIN_NAMES = ["나채빈", "정형진", "윤지혜", "이상민", "이정문", "오미리"];

/**
 * [관리자 권한] 현재 관리자 이름 목록을 구한다.
 * 실수로 빈 배열이 저장돼 아무도 관리자가 아니게 되는 사고를 막기 위해 빈 배열은 무시한다.
 * @param {object} seasonConfig - config/season 문서 데이터
 * @returns {Array<string>} 관리자 이름 배열
 */
function getAdminNames(seasonConfig) {
    const list = seasonConfig?.adminNames;
    if (Array.isArray(list) && list.length > 0) return list;
    return DEFAULT_ADMIN_NAMES;
}

// [관리자 권한] seasonConfig를 props로 받지 않는 곳(PlayerCard의 👑 아이콘 등)에서 쓰는 캐시.
// config 스냅샷이 올 때마다 갱신된다.
let adminNamesCache = DEFAULT_ADMIN_NAMES;
const isAdminName = (name) => adminNamesCache.includes(name);

// [관리자 권한] config 리스너(lib/firebase.js)가 관리자 목록 캐시를 갱신할 때 사용
const setAdminNamesCache = (list) => { adminNamesCache = list; };

// ===================================================================================
// 상수 및 Helper 함수
// ===================================================================================
const PLAYERS_PER_MATCH = 4;
// [청백전] S조는 청백전 입장 화면에서만 고를 수 있는 최상위 급수 (A조보다 위)
const LEVEL_ORDER = { 'S조': 0, 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 5 };

// ===================================================================================
// [청백전] 경기 방식 · 팀 상수
// -----------------------------------------------------------------------------------
// config/season.matchMode 가 'team'이면 청백전 모드다.
//   · 입장할 때 이름·급수(S~D)·성별·팀(청/백)을 직접 고른다 (명단/게스트 개념 없음)
//   · 선수 문서에 team('청'|'백'), todayWins, todayLosses 가 쌓인다
//   · gameState/live.teamScores = { blue, white } 가 팀 점수판이다
// ===================================================================================
const MATCH_MODE_NORMAL = 'normal';
const MATCH_MODE_TEAM = 'team';
const TEAM_BLUE = '청';
const TEAM_WHITE = '백';
const TEAMS = [TEAM_BLUE, TEAM_WHITE];
const TEAM_META = {
    [TEAM_BLUE]:  { key: 'blue',  label: '청팀', short: '청', color: '#3B82F6', soft: 'rgba(59,130,246,.22)',  text: '#93C5FD' },
    [TEAM_WHITE]: { key: 'white', label: '백팀', short: '백', color: '#E5E7EB', soft: 'rgba(229,231,235,.20)', text: '#F3F4F6' },
};
/** 청백전 모드인지 (seasonConfig 기준) */
const isTeamMode = (seasonConfig) => seasonConfig?.matchMode === MATCH_MODE_TEAM;
/** 선수의 팀 ('청' | '백' | null) */
const getTeamOf = (player) => (player && TEAMS.includes(player.team) ? player.team : null);
/** 점수판 기본값 */
const emptyTeamScores = () => ({ blue: 0, white: 0 });
/** 팀 이름 → 점수판 키 */
const teamScoreKey = (team) => (team === TEAM_BLUE ? 'blue' : team === TEAM_WHITE ? 'white' : null);
/** 오늘 승/패 (없으면 0) */
const getWinLoss = (player) => ({
    wins: Math.max(0, Number(player?.todayWins) || 0),
    losses: Math.max(0, Number(player?.todayLosses) || 0),
});

const generateId = (name) => name.replace(/\s+/g, '_');

const filterTodayGames = (games) => {
    if (!games || games.length === 0) return [];
    const today = new Date().toDateString();
    return new Date(games[0].timestamp).toDateString() === today ? games : [];
};

const getLevelColor = (level, isGuest) => {
    if (isGuest) return '#00BFFF';
    switch (level) {
        case 'S조': return '#E879F9'; // [청백전] S조 — 마젠타
        case 'A조': return '#FF4F4F';
        case 'B조': return '#FF9100';
        case 'C조': return '#FFD600';
        case 'D조': return '#00E676';
        default: return '#A1A1AA';
    }
};

const calculateLocations = (gameState, players) => {
    const locations = {};
    if (!gameState || !players) return locations;
    Object.keys(players).forEach(pId => locations[pId] = { location: 'waiting' });

    if (gameState.scheduledMatches) {
        Object.keys(gameState.scheduledMatches).forEach(matchKey => {
            const match = gameState.scheduledMatches[matchKey];
            if (match) {
                match.forEach((playerId, slotIndex) => {
                    if (playerId) locations[playerId] = { location: 'schedule', matchIndex: parseInt(matchKey, 10), slotIndex: slotIndex };
                });
            }
        });
    }

    // [자동매칭] 자동 매칭 목록에 있는 선수도 'waiting'이 아님
    if (gameState.autoMatches) {
        Object.keys(gameState.autoMatches).forEach(matchKey => {
            const match = gameState.autoMatches[matchKey];
            if (match) {
                match.forEach((playerId, slotIndex) => {
                    if (playerId) locations[playerId] = { location: 'auto', matchIndex: parseInt(matchKey, 10), slotIndex: slotIndex };
                });
            }
        });
    }

    if (gameState.inProgressCourts) {
        gameState.inProgressCourts.forEach((court, courtIndex) => {
            if (court && court.players) {
                court.players.forEach((playerId, slotIndex) => {
                    if (playerId) locations[playerId] = { location: 'court', matchIndex: courtIndex, slotIndex: slotIndex };
                });
            }
        });
    }
    return locations;
};


// ===================================================================================
// [자동 복구] 시작할 수 없게 된 예약 경기 정리
// -----------------------------------------------------------------------------------
// 예약해 둔 경기에 들어 있던 선수가 중간에 나가거나(퇴장) 휴식으로 바뀌면,
// 그 경기는 영원히 START를 누를 수 없다. 그대로 두면 목록이 막혀서
// "그 선수들은 계속 예약 상태 → 새 매칭 후보에서도 빠짐 → 경기가 안 만들어짐"
// 이라는 교착에 빠진다. (실제 시뮬레이션에서 재현된 문제)
//
// 그래서 자동 매칭 목록에서는 그런 경기를 통째로 해체하고,
// 남은 선수들을 대기 명단으로 돌려보낸다. 관리자가 아무것도 안 해도 스스로 풀린다.
// (관리자가 손으로 짠 '경기 예정' 목록은 의도를 존중해서 해당 칸만 비운다)
// ===================================================================================

/** 이 선수가 지금 경기에 들어갈 수 있는 상태인가 */
const isPlayerUsable = (player) => !!player && player.status === 'active' && !player.isResting;

/**
 * @param {object} gameState 현재 게임 상태
 * @param {object} allPlayers 전체 선수 데이터 (나간 선수 포함)
 * @returns {{changed: boolean, newState: object, dissolvedCount: number, clearedNames: Array<string>}}
 */
const repairMatchQueues = (gameState, allPlayers) => {
    const newState = JSON.parse(JSON.stringify(gameState || {}));
    let changed = false;
    let dissolvedCount = 0;
    const clearedNames = [];

    // (1) 자동 매칭 — 못 뛰는 선수가 한 명이라도 있으면 그 경기를 해체한다
    const autoMatches = newState.autoMatches || {};
    const keptMatches = [];
    Object.keys(autoMatches)
        .sort((a, b) => Number(a) - Number(b))
        .forEach(key => {
            const match = autoMatches[key];
            if (!Array.isArray(match)) return;
            const broken = match.filter(Boolean).filter(id => !isPlayerUsable(allPlayers?.[id]));
            if (broken.length > 0) {
                changed = true;
                dissolvedCount += 1;
                broken.forEach(id => clearedNames.push(allPlayers?.[id]?.name || '나간 선수'));
                return; // 목록에 다시 담지 않는다 = 해체
            }
            keptMatches.push(match);
        });
    if (changed) {
        const reindexed = {};
        keptMatches.forEach((m, i) => { reindexed[String(i)] = m; });
        newState.autoMatches = reindexed;
    }

    // (2) 경기 예정(수동) — 관리자가 짠 배치이므로 해당 칸만 비운다
    const scheduled = newState.scheduledMatches || {};
    Object.keys(scheduled).forEach(key => {
        const match = scheduled[key];
        if (!Array.isArray(match)) return;
        match.forEach((id, slotIndex) => {
            if (id && !isPlayerUsable(allPlayers?.[id])) {
                match[slotIndex] = null;
                changed = true;
                clearedNames.push(allPlayers?.[id]?.name || '나간 선수');
            }
        });
    });

    return { changed, newState, dissolvedCount, clearedNames };
};


export {
    DEFAULT_ADMIN_NAMES, getAdminNames, isAdminName, setAdminNamesCache,
    PLAYERS_PER_MATCH, LEVEL_ORDER, generateId, filterTodayGames, getLevelColor, calculateLocations,
    isPlayerUsable, repairMatchQueues,
    // [청백전]
    MATCH_MODE_NORMAL, MATCH_MODE_TEAM, TEAM_BLUE, TEAM_WHITE, TEAMS, TEAM_META,
    isTeamMode, getTeamOf, emptyTeamScores, teamScoreKey, getWinLoss,
};