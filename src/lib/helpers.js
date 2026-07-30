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
const LEVEL_ORDER = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 5 };

const generateId = (name) => name.replace(/\s+/g, '_');

const filterTodayGames = (games) => {
    if (!games || games.length === 0) return [];
    const today = new Date().toDateString();
    return new Date(games[0].timestamp).toDateString() === today ? games : [];
};

const getLevelColor = (level, isGuest) => {
    if (isGuest) return '#00BFFF';
    switch (level) {
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


export {
    DEFAULT_ADMIN_NAMES, getAdminNames, isAdminName, setAdminNamesCache,
    PLAYERS_PER_MATCH, LEVEL_ORDER, generateId, filterTodayGames, getLevelColor, calculateLocations,
};