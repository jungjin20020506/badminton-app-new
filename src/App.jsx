import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getFirestore, doc, getDoc, setDoc, onSnapshot, 
    collection, deleteDoc, updateDoc, writeBatch, runTransaction,
    query, getDocs, where
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from "firebase/functions";

// ===================================================================================
// Firebase & Service Logic (하나의 파일로 통합)
// ===================================================================================

// --- 1. Firebase 설정 ---
const firebaseConfig = {
  apiKey: "AIzaSyCKT1JZ8MkA5WhBdL3XXxtm_0wLbnOBi5I",
  authDomain: "project-104956788310687609.firebaseapp.com",
  projectId: "project-104956788310687609",
  storageBucket: "project-104956788310687609.firebasestorage.app",
  messagingSenderId: "384562806148",
  appId: "1:384956788310687609:web:d8bfb28928c13e671d1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

const playersRef = collection(db, "players"); 
const gameStateRef = doc(db, "gameState", "live");
const configRef = doc(db, "config", "season");
const monthlyRankingsRef = collection(db, "monthlyRankings");
const notificationsRef = collection(db, "notifications");

// --- 2. Service 로직 ---
let allPlayersData = {};
let gameStateData = null;
let seasonConfigData = null; 
const subscribers = new Set();

let resolveAllPlayers, resolveGameState, resolveSeasonConfig;
const allPlayersPromise = new Promise(resolve => { resolveAllPlayers = resolve; });
const gameStatePromise = new Promise(resolve => { resolveGameState = resolve; });
const seasonConfigPromise = new Promise(resolve => { resolveSeasonConfig = resolve; });
const readyPromise = Promise.all([allPlayersPromise, gameStatePromise, seasonConfigPromise]);

// --- 3. Firestore 리스너 설정 ---
const activePlayersQuery = query(playersRef, where("status", "==", "active"));
let isInitialLoad = true;
let inactivePlayersFetched = false;

onSnapshot(activePlayersQuery, async (snapshot) => {
    const activePlayers = {};
    snapshot.forEach(doc => activePlayers[doc.id] = doc.data());
    
    if (isInitialLoad && !inactivePlayersFetched) {
        const inactiveSnapshot = await getDocs(query(playersRef, where("status", "==", "inactive")));
        inactiveSnapshot.forEach(doc => {
            if (!activePlayers[doc.id]) {
                allPlayersData[doc.id] = doc.data();
            }
        });
        inactivePlayersFetched = true;
    }

    allPlayersData = { ...allPlayersData, ...activePlayers };
    
    Object.keys(allPlayersData).forEach(playerId => {
        const player = allPlayersData[playerId];
        if(player.status === 'active' && !activePlayers[playerId]){
            delete allPlayersData[playerId];
        }
    });


    if(resolveAllPlayers) { resolveAllPlayers(); resolveAllPlayers = null; }
    isInitialLoad = false;
    notifySubscribers();
});


onSnapshot(gameStateRef, (doc) => {
  if (doc.exists()) {
    gameStateData = doc.data();
  } else {
    gameStateData = { 
        scheduledMatches: {}, 
        inProgressCourts: Array(4).fill(null),
        autoMatches: {}, // 자동 매칭 데이터 추가
        numScheduledMatches: 4,
        numInProgressCourts: 4,
    };
  }
  if(resolveGameState) { resolveGameState(); resolveGameState = null; }
  notifySubscribers();
});

onSnapshot(configRef, (doc) => {
    if (doc.exists()) {
        seasonConfigData = doc.data();
    } else {
        seasonConfigData = { 
            announcement: "랭킹전 시즌에 오신 것을 환영합니다! 공지사항은 관리자 설정에서 변경할 수 있습니다.", 
            seasonId: "default-season",
            pointSystemInfo: "- 참석: +20 RP (3경기 완료시)\n- 승리: +30 RP\n- 패배: +10 RP\n- 3연승 보너스: +20 RP",
            // [자동매칭] 기본 설정값 추가
            autoMatchConfig: {
                isEnabled: false,
                maleCourts: 2,
                femaleCourts: 1,
                minMaleScore: 75,
                minFemaleScore: 100
            }
        };
    }
    // [자동매칭] 기존 설정에 autoMatchConfig가 없으면 기본값 병합
    if (seasonConfigData && !seasonConfigData.autoMatchConfig) {
        seasonConfigData.autoMatchConfig = {
            isEnabled: false,
            maleCourts: 2,
            femaleCourts: 1,
            minMaleScore: 75,
            minFemaleScore: 100
        };
    }

    if(resolveSeasonConfig) { resolveSeasonConfig(); resolveSeasonConfig = null; }
    notifySubscribers();
});

function notifySubscribers() {
  subscribers.forEach(callback => callback());
}

// --- 4. Service 객체 ---
const firebaseService = {
  getAllPlayers: () => allPlayersData,
  getGameState: () => gameStateData,
  getSeasonConfig: () => seasonConfigData,
  subscribe: (callback) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  },
};

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
 * [자동매칭] 4인 조합의 "매치 점수" 계산
 * @param {Array<object>} combo - 4인 조합
 * @param {object} allPlayers - 전체 선수 데이터
 * @param {number} poolAvgGames - 이 풀의 평균 경기 수
 * @returns {number} 최종 매치 점수
 */
function calculateMatchScore(combo, allPlayers, poolAvgGames) {
    let score = 100;

    // 1. 공평 점수 (경기 수)
    const matchTotalGames = combo.reduce((acc, p) => acc + (p.todayWins || 0) + (p.todayLosses || 0), 0);
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
    
    return Math.round(score);
}

/**
 * [자동매칭] 풀에서 '최소 점수'를 넘는 '겹치지 않는' 베스트 매치들을 찾음
 * @param {Array<object>} pool - 선수 풀 (남자/여자)
 * @param {object} allPlayers - 전체 선수 데이터
 * @param {number} minScore - 최소 매칭 점수 (커트라인)
 * @returns {Array<Array<object>>} 확정된 매치 배열
 */
function findBestMatches(pool, allPlayers, minScore) {
    if (pool.length < 4) return [];

    const poolAvgGames = pool.length > 0
        ? pool.reduce((acc, p) => acc + (p.todayWins || 0) + (p.todayLosses || 0), 0) / pool.length
        : 0;

    const allCombos = getAllCombinations(pool, 4);
    if (allCombos.length === 0) return [];

    const scoredCombos = allCombos.map(combo => ({
        combo,
        score: calculateMatchScore(combo, allPlayers, poolAvgGames)
    }));

    // 점수 높은 순으로 정렬
    scoredCombos.sort((a, b) => b.score - a.score);

    // 최소 점수(커트라인) 필터링
    const goodCombos = scoredCombos.filter(c => c.score >= minScore);

    // (Greedy Algorithm) 겹치지 않는 베스트 매치 선택
    const bestMatches = [];
    const usedPlayerIds = new Set();

    for (const { combo } of goodCombos) {
        const hasUsedPlayer = combo.some(player => usedPlayerIds.has(player.id));
        if (!hasUsedPlayer) {
            bestMatches.push(combo);
            combo.forEach(player => usedPlayerIds.add(player.id));
        }
    }

    return bestMatches;
}


// ===================================================================================
// 상수 및 Helper 함수
// ===================================================================================
const ADMIN_NAMES = ["나채빈", "정형진", "윤지혜", "이상민", "이정문", "신영은", "오미리"];
const PLAYERS_PER_MATCH = 4;
const RP_CONFIG = {
    ATTENDANCE: 20,
    WIN: 30,
    LOSS: 10,
    WIN_STREAK_BONUS: 20, // 3연승부터 1승마다 +20 RP
};
const LEVEL_ORDER = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 5 };

const generateId = (name) => name.replace(/\s+/g, '_');

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

// ===================================================================================
// 자식 컴포넌트들
// ===================================================================================
const PlayerCard = React.memo(({ player, context, isAdmin, onCardClick, onAction, onLongPress, isCurrentUser, isMovable = true, isSelectedForWin = false, isPlaying = false }) => {
    const pressTimerRef = useRef(null);
    const cardRef = useRef(null);

    const stableOnLongPress = useCallback(() => {
        if(onLongPress) onLongPress(player);
    }, [onLongPress, player]);

    const handlePressStart = useCallback((e) => {
        if (!isMovable || !isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(stableOnLongPress, 1000);
    }, [isAdmin, isMovable, stableOnLongPress]);
    
    const handlePressEnd = useCallback(() => {
        if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        const cardElement = cardRef.current;
        if (cardElement && isAdmin && isMovable) {
            const options = { passive: true };
            cardElement.addEventListener('touchstart', handlePressStart, options);
            cardElement.addEventListener('touchend', handlePressEnd);
            cardElement.addEventListener('touchcancel', handlePressEnd);
    
            return () => {
                cardElement.removeEventListener('touchstart', handlePressStart);
                cardElement.removeEventListener('touchend', handlePressEnd);
                cardElement.removeEventListener('touchcancel', handlePressEnd);
            };
        }
    }, [isAdmin, isMovable, handlePressStart, handlePressEnd]);
    
    const handleContextMenu = (e) => { e.preventDefault(); };
    
    const genderStyle = {
        boxShadow: `inset 4px 0 0 0 ${player.gender === '남' ? '#3B82F6' : '#EC4899'}`
    };

    const adminIcon = (player.role === 'admin' || ADMIN_NAMES.includes(player.name)) ? '👑' : '';
    const isWaiting = !context.location;
    const playerNameClass = `player-name text-white text-xs font-bold whitespace-nowrap leading-tight tracking-tighter`;
    const playerInfoClass = `player-info text-gray-400 text-[10px] leading-tight mt-px whitespace-nowrap`;
    
    const levelColor = getLevelColor(player.level, player.isGuest);
    
    const levelStyle = {
        color: levelColor,
        fontWeight: 'bold',
        fontSize: '14px',
        textShadow: `0 0 5px ${levelColor}`
    };

    const cardStyle = {
        ...genderStyle,
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'transparent',
        transition: 'all 0.2s ease-in-out',
        backgroundColor: '#2d3748',
        opacity: isPlaying ? 0.6 : 1,
    };

    if (context.selected || isSelectedForWin) {
        cardStyle.borderColor = '#34d399';
        cardStyle.transform = 'scale(1.1)';
        cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 15px 5px rgba(52, 211, 153, 0.9)`;
    }
    
    if (isCurrentUser) {
        cardStyle.borderColor = '#FBBF24';
        cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 12px 4px rgba(251, 191, 36, 0.9)`;
    }

    const isLongPressDisabled = context.location === 'court';
    const actionLabel = (isWaiting || context.location === 'auto') ? '선수 내보내기' : '대기자로 이동';
    
    const todayWins = player.todayWins || 0;
    const todayLosses = player.todayLosses || 0;

    return (
        <div 
            ref={cardRef}
            className={`player-card p-1 rounded-md relative flex flex-col justify-center text-center h-14 w-full ${player.isResting ? 'filter grayscale' : ''}`}
            style={cardStyle}
            onClick={isMovable && onCardClick ? () => onCardClick() : null}
            onMouseDown={isAdmin && isMovable && !isLongPressDisabled ? handlePressStart : null}
            onMouseUp={isAdmin && isMovable && !isLongPressDisabled ? handlePressEnd : null}
            onMouseLeave={isAdmin && isMovable && !isLongPressDisabled ? handlePressEnd : null}
            onContextMenu={handleContextMenu}
        >
            <div>
                <div className={playerNameClass}>{adminIcon}{player.name}</div>
                <div className={playerInfoClass}>
                    <span style={levelStyle}>{player.level.replace('조','')}</span>|
                    {`${todayWins}승 ${todayLosses}패`}
                </div>
            </div>
            {isAdmin && onAction && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onAction(player); }} 
                    className={`absolute -top-2 -right-2 p-1 text-gray-500 hover:text-yellow-400`}
                    aria-label={actionLabel}
                ><i className={"fas fa-times-circle fa-xs"}></i></button>
            )}
        </div>
    );
});
const EmptySlot = ({ onSlotClick }) => ( 
    <div 
        className="player-slot h-14 bg-black/30 rounded-md flex items-center justify-center text-gray-600 border-2 border-dashed border-gray-700 cursor-pointer hover:bg-gray-700/50 hover:border-yellow-400 transition-all"
        onClick={onSlotClick}
    >
        <span className="text-xl font-bold">+</span>
    </div> 
);
const CourtTimer = ({ court }) => {
    const [time, setTime] = useState('00:00');
    useEffect(() => {
        if (court && court.startTime) {
            const timerId = setInterval(() => {
                const now = new Date().getTime();
                const startTime = new Date(court.startTime).getTime();
                const diff = Math.floor((now - startTime) / 1000);
                const minutes = String(Math.floor(diff / 60)).padStart(2, '0');
                const seconds = String(diff % 60).padStart(2, '0');
                setTime(`${minutes}:${seconds}`);
            }, 1000);
            return () => clearInterval(timerId);
        } else { setTime('00:00'); }
    }, [court]);
    return <div className="text-center text-xs font-mono text-white mt-1 tracking-wider">{time}</div>;
};

const WaitingListSection = React.memo(({ maleWaitingPlayers, femaleWaitingPlayers, selectedPlayerIds, isAdmin, handleCardClick, handleDeleteFromWaiting, setModal, currentUser, inProgressPlayerIds, onClearAllWaitingPlayers }) => {
    const renderPlayerGrid = (players) => (
        <div className="grid grid-cols-5 gap-1">
            {players.map(player => (
                <PlayerCard 
                    key={player.id} 
                    player={player} 
                    context={{ location: null, selected: selectedPlayerIds.includes(player.id) }} 
                    isAdmin={isAdmin} 
                    onCardClick={() => handleCardClick(player.id)} 
                    onAction={handleDeleteFromWaiting} 
                    onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})} 
                    isCurrentUser={currentUser && player.id === currentUser.id}
                    isPlaying={inProgressPlayerIds.has(player.id)}
                />
            ))}
        </div>
    );
    
    const totalWaiting = maleWaitingPlayers.length + femaleWaitingPlayers.length;

    return (
        <section className="bg-gray-800/50 rounded-lg p-2">
            <div className="flex justify-between items-center mb-2">
                <h2 className="text-sm font-bold text-yellow-400 arcade-font flicker-text">
                    대기 명단 ({totalWaiting})
                </h2>
                {/* [신규 기능] 대기자 전체 내보내기 버튼 */}
                {isAdmin && totalWaiting > 0 && (
                    <button 
                        onClick={onClearAllWaitingPlayers} 
                        className="arcade-button text-xs bg-red-800 text-white py-1 px-2 rounded-md"
                    >
                        전체 내보내기
                    </button>
                )}
            </div>
            <div className="flex flex-col gap-2">
                {renderPlayerGrid(maleWaitingPlayers)}
                {maleWaitingPlayers.length > 0 && femaleWaitingPlayers.length > 0 && (
                    <hr className="border-dashed border-gray-600 my-1" />
                )}
                {renderPlayerGrid(femaleWaitingPlayers)}
            </div>
        </section>
    );
});


const ScheduledMatchesSection = React.memo(({ numScheduledMatches, scheduledMatches, players, selectedPlayerIds, isAdmin, handleCardClick, handleReturnToWaiting, setModal, handleSlotClick, handleStartMatch, currentUser, handleClearScheduledMatches, handleDeleteScheduledMatch, inProgressPlayerIds }) => {
    const pressTimerRef = useRef(null);

    const handlePressStart = (matchIndex) => {
        if (!isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(() => {
            handleDeleteScheduledMatch(matchIndex);
        }, 800);
    };

    const handlePressEnd = () => {
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };

    const hasMatches = Object.values(scheduledMatches).some(m => m && m.some(p => p !== null));

    return (
        <section>
            <div className="flex justify-between items-center mb-2 px-1">
                <h2 className="text-lg font-bold text-cyan-400 arcade-font">경기 예정 (수동)</h2>
                {isAdmin && hasMatches && (
                    <button onClick={handleClearScheduledMatches} className="arcade-button text-xs bg-red-800 text-white py-1 px-2 rounded-md">전체삭제</button>
                )}
            </div>
            <div id="scheduled-matches" className="flex flex-col gap-2">
                {Array.from({ length: numScheduledMatches }).map((_, matchIndex) => {
                    const match = scheduledMatches[String(matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                    const playerCount = match.filter(p => p).length;
                    return (
                        <div key={`schedule-${matchIndex}`} className="flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1">
                            <div 
                                className="flex-shrink-0 w-6 text-center cursor-pointer"
                                onMouseDown={() => handlePressStart(matchIndex)}
                                onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
                                onTouchStart={() => handlePressStart(matchIndex)}
                                onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
                            >
                                <p className="font-bold text-lg text-white arcade-font">{matchIndex + 1}</p>
                            </div>
                            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                {Array(PLAYERS_PER_MATCH).fill(null).map((_, slotIndex) => {
                                    const playerId = match[slotIndex];
                                    const player = players[playerId];
                                    const context = {location: 'schedule', matchIndex, slotIndex, selected: selectedPlayerIds.includes(playerId)};
                                    return player ? ( <PlayerCard key={playerId} player={player} context={context} isAdmin={isAdmin} onCardClick={() => handleCardClick(playerId)} onAction={handleReturnToWaiting} onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})} isCurrentUser={currentUser && player.id === currentUser.id} isPlaying={inProgressPlayerIds.has(playerId)} /> ) : ( <EmptySlot key={`schedule-empty-${matchIndex}-${slotIndex}`} onSlotClick={() => handleSlotClick({ location: 'schedule', matchIndex, slotIndex })} /> )
                                })}
                            </div>
                            <div className="flex-shrink-0 w-14 text-center">
                                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === PLAYERS_PER_MATCH && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== PLAYERS_PER_MATCH || !isAdmin} onClick={() => handleStartMatch(matchIndex, 'schedule')}>START</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});

// [자동매칭] 자동 매칭 섹션 컴포넌트 (UI 변경)
const AutoMatchesSection = React.memo(({ autoMatches, players, isAdmin, handleStartAutoMatch, handleReturnToWaiting, handleClearAutoMatches, handleDeleteAutoMatch, currentUser, handleAutoMatchCardClick, selectedAutoMatchSlot, inProgressPlayerIds, handleAutoMatchSlotClick, isAutoMatchOn }) => {
    const pressTimerRef = useRef(null);

    const handlePressStart = (matchIndex) => {
        if (!isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(() => {
            handleDeleteAutoMatch(matchIndex);
        }, 800);
    };

    const handlePressEnd = () => {
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };
    
    const matchList = Object.entries(autoMatches);

    return (
        <section>
            <div className="flex justify-between items-center mb-2 px-1">
                 <h2 className={`text-lg font-bold text-green-400 arcade-font ${isAutoMatchOn ? 'flicker-text' : ''}`}>
                    🤖 자동 매칭 {isAutoMatchOn ? '(ON)' : '(OFF)'}
                 </h2>
                 {isAdmin && matchList.length > 0 && (
                    <button onClick={handleClearAutoMatches} className="arcade-button text-xs bg-red-800 text-white py-1 px-2 rounded-md">전체삭제</button>
                 )}
            </div>
            {isAutoMatchOn && matchList.length === 0 && (
                <div className="text-center text-gray-500 p-4 bg-gray-800/60 rounded-lg">
                    <p>자동 매칭 대기 중...</p>
                    <p className="text-xs mt-1">대기 선수가 4명 이상이고, '최소 점수'를 넘는<br/>좋은 조합이 발견되면 자동으로 생성됩니다.</p>
                </div>
            )}
            <div id="auto-matches" className="flex flex-col gap-2">
                {matchList.map(([matchIndex, match]) => {
                    const playerCount = match.filter(p => p).length;
                    return (
                        <div key={`auto-match-${matchIndex}`} className="flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1">
                            <div 
                                className="flex-shrink-0 w-6 text-center cursor-pointer"
                                onMouseDown={() => handlePressStart(matchIndex)}
                                onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
                                onTouchStart={() => handlePressStart(matchIndex)}
                                onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
                            >
                                <p className="font-bold text-lg text-white arcade-font">{parseInt(matchIndex, 10) + 1}</p>
                            </div>
                            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                {match.map((playerId, slotIndex) => {
                                    const player = players[playerId];
                                    const cardKey = playerId ? `${playerId}-${matchIndex}-${slotIndex}` : `auto-empty-${matchIndex}-${slotIndex}`;
                                    const isSelected = selectedAutoMatchSlot && selectedAutoMatchSlot.matchIndex === matchIndex && selectedAutoMatchSlot.slotIndex === slotIndex;
                                    return player ? 
                                        (<PlayerCard key={cardKey} player={player} context={{location: 'auto', selected: isSelected}} isAdmin={isAdmin} onCardClick={() => handleAutoMatchCardClick(matchIndex, slotIndex)} onAction={handleReturnToWaiting} isCurrentUser={currentUser && player.id === currentUser.id} isPlaying={inProgressPlayerIds.has(playerId)} />) : 
                                        (<EmptySlot key={cardKey} onSlotClick={() => handleAutoMatchSlotClick(matchIndex, slotIndex)} />)
                                })}
                            </div>
                            <div className="flex-shrink-0 w-14 text-center">
                                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === 4 && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== 4 || !isAdmin} onClick={() => handleStartAutoMatch(matchIndex, 'auto')}>START</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});

const InProgressCourt = React.memo(({ courtIndex, court, players, isAdmin, handleEndMatch, currentUser, courtMove, setCourtMove, handleMoveOrSwapCourt }) => {
    const pressTimerRef = useRef(null);
    const courtRef = useRef(null);

    const handlePressStart = useCallback(() => {
        if (!isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(() => {
            setCourtMove({ sourceIndex: courtIndex });
            pressTimerRef.current = null;
        }, 800);
    }, [isAdmin, courtIndex, setCourtMove]);

    const handlePressEnd = useCallback(() => {
        if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
        }
    }, []);
    
    const handleClick = useCallback(() => {
        if (!isAdmin || courtMove.sourceIndex === null) return;
        
        if (courtMove.sourceIndex === courtIndex) {
            setCourtMove({ sourceIndex: null });
        } else {
            handleMoveOrSwapCourt(courtMove.sourceIndex, courtIndex);
        }
    }, [isAdmin, courtIndex, courtMove, handleMoveOrSwapCourt, setCourtMove]);

    useEffect(() => {
        const element = courtRef.current;
        if (element && isAdmin) {
            const options = { passive: true };
            element.addEventListener('mousedown', handlePressStart);
            element.addEventListener('mouseup', handlePressEnd);
            element.addEventListener('mouseleave', handlePressEnd);
            element.addEventListener('touchstart', handlePressStart, options);
            element.addEventListener('touchend', handlePressEnd);
            element.addEventListener('touchcancel', handlePressEnd);

            return () => {
                element.removeEventListener('mousedown', handlePressStart);
                element.removeEventListener('mouseup', handlePressEnd);
                element.removeEventListener('mouseleave', handlePressEnd);
                element.removeEventListener('touchstart', handlePressStart, options);
                element.removeEventListener('touchend', handlePressEnd);
                element.removeEventListener('touchcancel', handlePressEnd);
            };
        }
    }, [isAdmin, handlePressStart, handlePressEnd]);
    
    const isSource = courtMove.sourceIndex === courtIndex;
    const courtContainerClass = `flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1 transition-all duration-300 ${isSource ? 'border-2 border-yellow-400 scale-105 shadow-lg shadow-yellow-400/30' : 'border-2 border-transparent'} ${isAdmin ? 'cursor-pointer' : ''}`;

    return (
        <div ref={courtRef} className={courtContainerClass} onClick={handleClick}>
            <div className="flex-shrink-0 w-6 flex flex-col items-center justify-center">
                <p className="font-bold text-lg text-white arcade-font">{courtIndex + 1}</p>
                <p className="font-semibold text-[8px] text-gray-400 arcade-font">코트</p>
            </div>
            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                {(court?.players || Array(PLAYERS_PER_MATCH).fill(null)).map((playerId, slotIndex) => {
                    const player = players[playerId];
                    return player ? ( <PlayerCard key={playerId} player={player} context={{ location: 'court', matchIndex: courtIndex }} isAdmin={isAdmin} isCurrentUser={currentUser && player.id === currentUser.id} isMovable={false} /> ) : ( <EmptySlot key={`court-empty-${courtIndex}-${slotIndex}`} /> )
                })}
            </div>
            <div className="flex-shrink-0 w-14 text-center">
                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${court && isAdmin ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={!court || !isAdmin} onClick={(e) => { e.stopPropagation(); handleEndMatch(courtIndex); }}>FINISH</button>
                <CourtTimer court={court} />
            </div>
        </div>
    );
});


const InProgressCourtsSection = React.memo(({ numInProgressCourts, inProgressCourts, players, isAdmin, handleEndMatch, currentUser, courtMove, setCourtMove, handleMoveOrSwapCourt }) => {
    return (
        <section>
            <h2 className="text-lg font-bold mb-2 text-red-500 px-1 arcade-font">경기 진행</h2>
            <div id="in-progress-courts" className="flex flex-col gap-2">
                {Array.from({ length: numInProgressCourts }).map((_, courtIndex) => (
                    <InProgressCourt 
                        key={`court-${courtIndex}`}
                        courtIndex={courtIndex}
                        court={inProgressCourts[courtIndex]}
                        players={players}
                        isAdmin={isAdmin}
                        handleEndMatch={handleEndMatch}
                        currentUser={currentUser}
                        courtMove={courtMove}
                        setCourtMove={setCourtMove}
                        handleMoveOrSwapCourt={handleMoveOrSwapCourt}
                    />
                ))}
            </div>
        </section>
    );
});

// ===================================================================================
// Main App Component
// ===================================================================================
export default function App() {
    const [allPlayers, setAllPlayers] = useState({});
    const [gameState, setGameState] = useState(null);
    const [seasonConfig, setSeasonConfig] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);
    const [modal, setModal] = useState({ type: null, data: null });
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState('main');
    const [courtMove, setCourtMove] = useState({ sourceIndex: null });
    const [resetNotification, setResetNotification] = useState(null);
    const [selectedAutoMatchSlot, setSelectedAutoMatchSlot] = useState(null);

    // [모바일 UI 개선] 화면 너비와 활성 탭 상태를 관리합니다.
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [activeTab, setActiveTab] = useState('matching');

    const isAdmin = currentUser && ADMIN_NAMES.includes(currentUser.name);
    const autoMatches = gameState?.autoMatches || {};
    // [자동매칭] 자동매칭 스케줄러 참조
    const schedulerIntervalRef = useRef(null);
    const isSchedulerRunningRef = useRef(false);

    const activePlayers = useMemo(() => {
        return Object.values(allPlayers).filter(p => p.status === 'active').reduce((acc, p) => {
            acc[p.id] = p;
            return acc;
        }, {});
    }, [allPlayers]);

    // [자동매칭] playerLocations가 자동 매칭 목록도 인식하도록 수정
    const playerLocations = useMemo(() => {
        if (!gameState) return {};
        return calculateLocations(gameState, activePlayers);
    }, [gameState, activePlayers]);
    
    // [자동매칭] 자동 매칭 풀(대기 선수)
    const waitingPlayers = useMemo(() => Object.values(activePlayers)
        .filter(p => playerLocations[p.id]?.location === 'waiting' && !p.isResting) // 휴식 중인 선수 제외
        .sort((a, b) => {
            const levelA = LEVEL_ORDER[a.level] || 99;
            const levelB = LEVEL_ORDER[b.level] || 99;
            if (levelA !== levelB) return levelA - levelB;
            return new Date(a.entryTime) - new Date(b.entryTime);
        }), [activePlayers, playerLocations]);
    
    const maleWaitingPlayers = useMemo(() => waitingPlayers.filter(p => p.gender === '남'), [waitingPlayers]);
    const femaleWaitingPlayers = useMemo(() => waitingPlayers.filter(p => p.gender === '여'), [waitingPlayers]);


    const inProgressPlayerIds = useMemo(() => {
        if (!gameState?.inProgressCourts) return new Set();
        return new Set(
            gameState.inProgressCourts
                .filter(court => court && court.players) 
                .flatMap(court => court.players)       
                .filter(playerId => playerId)             
        );
    }, [gameState]);

    // [모바일 UI 개선] 화면 크기 변경을 감지하는 로직입니다.
    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);


    useEffect(() => {
        if (!currentUser || !isAdmin) {
            if (resetNotification) setResetNotification(null);
            return;
        }
    
        const adminId = currentUser.id;
        const notifDocRef = doc(notificationsRef, adminId);

        const unsubscribe = onSnapshot(notifDocRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                if (data.status === 'pending' || data.status === 'error') {
                    setResetNotification({ id: doc.id, ...data });
                } else {
                    setResetNotification(null);
                }
            } else {
                setResetNotification(null);
            }
        });

        return () => unsubscribe();

    }, [currentUser, isAdmin, resetNotification]);

    useEffect(() => {
        const initializeApp = async () => {
            await readyPromise;
            
            const playersFromDB = firebaseService.getAllPlayers();
            setAllPlayers(playersFromDB); 
            
            const savedUserId = localStorage.getItem('badminton-currentUser-id');
            if (savedUserId && playersFromDB[savedUserId] && playersFromDB[savedUserId].status === 'active') {
                setCurrentUser(playersFromDB[savedUserId]);
            } else if (savedUserId) {
                localStorage.removeItem('badminton-currentUser-id');
            }
            
            setGameState(firebaseService.getGameState());
            setSeasonConfig(firebaseService.getSeasonConfig());
            setIsLoading(false);

            const unsubscribe = firebaseService.subscribe(() => {
                const updatedPlayers = firebaseService.getAllPlayers();
                setAllPlayers(updatedPlayers);
                setGameState(firebaseService.getGameState());
                setSeasonConfig(firebaseService.getSeasonConfig());

                setCurrentUser(prevUser => {
                    if (!prevUser) return null;
                    const updatedUser = updatedPlayers[prevUser.id];
                    if (!updatedUser || updatedUser.status !== 'active') {
                        localStorage.removeItem('badminton-currentUser-id');
                        return null;
                    }
                    return JSON.stringify(prevUser) !== JSON.stringify(updatedUser) ? updatedUser : prevUser;
                });
            });
            return unsubscribe;
        };

        const unsubscribePromise = initializeApp();
        return () => {
            unsubscribePromise.then(unsubscribe => unsubscribe && unsubscribe());
        };
    }, []);

    useEffect(() => {
        if (isLoading || !seasonConfig || (modal && modal.type) || resetNotification) return;
        const today = new Date().toDateString();
        const lastSeen = localStorage.getItem(`seen-${seasonConfig.seasonId}`);
        if (lastSeen !== today) {
            setModal({ type: 'season', data: seasonConfig });
        }
    }, [isLoading, seasonConfig, modal, resetNotification]);
    
    const updateGameState = useCallback(async (updateFunction, customErrorMessage) => {
        try {
            await runTransaction(db, async (transaction) => {
                const gameStateDoc = await transaction.get(gameStateRef);
                if (!gameStateDoc.exists()) {
                    const initialState = {
                        scheduledMatches: {},
                        inProgressCourts: Array(4).fill(null),
                        autoMatches: {},
                        numScheduledMatches: 4,
                        numInProgressCourts: 4,
                    };
                    const { newState } = updateFunction(initialState);
                    transaction.set(gameStateRef, newState);
                } else {
                    const currentState = gameStateDoc.data();
                    const { newState } = updateFunction(currentState);
                    transaction.set(gameStateRef, newState);
                }
            });
        } catch (err) {
            console.error("Transaction failed: ", err);
            // 동시성 문제로 인한 오류는 사용자에게 알리지 않음
            if (err.message.includes("다른 관리자에 의해 슬롯이 이미 채워졌습니다.")) {
                console.log("Slot already filled, operation cancelled silently.");
            } else {
                setModal({ type: 'alert', data: { title: '작업 실패', body: customErrorMessage || err.message }});
            }
        }
    }, []);

    const findPlayerLocation = useCallback((playerId) => playerLocations[playerId] || { location: 'waiting' }, [playerLocations]);
    
    const handleReturnToWaiting = useCallback(async (player) => {
        const loc = findPlayerLocation(player.id);
        if (!loc || loc.location === 'waiting') return;

        const updateFunction = (currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            if (loc.location === 'schedule') {
                newState.scheduledMatches[String(loc.matchIndex)][loc.slotIndex] = null;
            }
            // [자동매칭] 자동 매칭 목록에서도 대기자로 이동
            if (loc.location === 'auto') {
                newState.autoMatches[String(loc.matchIndex)][loc.slotIndex] = null;
            }
            return { newState };
        };
        
        await updateGameState(updateFunction, '선수를 대기 명단으로 옮기는 데 실패했습니다.');
    }, [findPlayerLocation, updateGameState]);
    
    const handleDeleteFromWaiting = useCallback((player) => {
        setModal({ type: 'confirm', data: { title: '선수 내보내기', body: `${player.name} 선수를 내보낼까요? (기록은 유지됩니다)`,
            onConfirm: async () => { 
                await updateDoc(doc(playersRef, player.id), { status: 'inactive' }).catch(error => {
                    setModal({ type: 'alert', data: { title: '오류', body: '선수 내보내기에 실패했습니다.' }});
                });
                setModal({ type: null, data: null });
            }
        }});
    }, []);
    
    // [신규 기능] 대기자 전체 내보내기
    const handleClearAllWaitingPlayers = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '대기자 전체 내보내기',
            body: `정말로 '경기대기' 중인 모든 선수(${waitingPlayers.length}명)를 내보내시겠습니까? 선수들이 현황판에서 퇴장됩니다.`,
            onConfirm: async () => {
                if (waitingPlayers.length === 0) {
                    setModal({ type: 'alert', data: { title: '오류', body: '내보낼 선수가 없습니다.' }});
                    return;
                }
                
                try {
                    const batch = writeBatch(db);
                    waitingPlayers.forEach(player => {
                        const playerDocRef = doc(playersRef, player.id);
                        batch.update(playerDocRef, { status: 'inactive' });
                    });
                    await batch.commit();
                    setModal({ type: 'alert', data: { title: '완료', body: '대기 중인 모든 선수를 내보냈습니다.' }});
                } catch (error) {
                    setModal({ type: 'alert', data: { title: '오류', body: '선수들을 내보내는 중 오류가 발생했습니다.' }});
                    console.error("Failed to clear all waiting players:", error);
                }
            }
        }});
    }, [waitingPlayers]);

    const handleEnter = useCallback(async (formData) => {
        const { name, level, gender, isGuest } = formData;
        if (!name) { setModal({ type: 'alert', data: { title: '오류', body: '이름을 입력해주세요.' }}); return; }
        const id = generateId(name);
        try {
            const playerDocRef = doc(playersRef, id);
            let docSnap = await getDoc(playerDocRef);
            let playerData;
            
            if (docSnap.exists()) {
                const existingData = docSnap.data();
                playerData = { 
                    ...existingData,
                    level, 
                    gender, 
                    isGuest,
                    status: 'active',
                    todayWins: existingData.todayWins || 0,
                    todayLosses: existingData.todayLosses || 0,
                    todayWinStreak: existingData.todayWinStreak || 0,
                    todayWinStreakCount: existingData.todayWinStreakCount || 0,
                    todayRecentGames: existingData.todayRecentGames || [],
                };
            } else {
                playerData = { 
                    id, name, level, gender, isGuest, 
                    entryTime: new Date().toISOString(), isResting: false,
                    status: 'active',
                    wins: 0, losses: 0, rp: 0, winStreak: 0, winStreakCount: 0,
                    attendanceCount: 0, achievements: [],
                    todayWins: 0, todayLosses: 0, todayWinStreak: 0, todayWinStreakCount: 0, todayRecentGames: [],
                };
            }
            
            await setDoc(playerDocRef, playerData, { merge: true });
            setCurrentUser(playerData);
            localStorage.setItem('badminton-currentUser-id', id);
        } catch (error) {
            console.error("Enter failed: ", error);
            setModal({ type: 'alert', data: { title: '오류', body: '입장 처리 중 문제가 발생했습니다.' }});
        }
    }, []);

    const handleLogout = useCallback(() => {
        if (!currentUser) return;
        setModal({ type: 'confirm', data: { 
            title: '나가기', 
            body: '나가시면 현황판에서 제외됩니다. 정말 나가시겠습니까? (기록은 유지됩니다)',
            onConfirm: async () => {
                try {
                    const updateFunction = (currentState) => {
                        const newState = JSON.parse(JSON.stringify(currentState));
                        const playerId = currentUser.id;
                        Object.keys(newState.scheduledMatches).forEach(matchKey => {
                            const match = newState.scheduledMatches[matchKey];
                            if(match) {
                                const playerIndex = match.indexOf(playerId);
                                if (playerIndex > -1) match[playerIndex] = null;
                            }
                        });
                        // [자동매칭] 자동 매칭에서도 제거
                        Object.keys(newState.autoMatches).forEach(matchKey => {
                            const match = newState.autoMatches[matchKey];
                            if(match) {
                                const playerIndex = match.indexOf(playerId);
                                if (playerIndex > -1) match[playerIndex] = null;
                            }
                        });
                        newState.inProgressCourts.forEach((court, courtIndex) => {
                            if (court?.players) {
                                const playerIndex = court.players.indexOf(playerId);
                                if (playerIndex > -1) court.players[playerIndex] = null;
                                if (court.players.every(p => p === null)) newState.inProgressCourts[courtIndex] = null;
                            }
                        });
                        return { newState };
                    };
                    await updateGameState(updateFunction);

                    await updateDoc(doc(playersRef, currentUser.id), { status: 'inactive' });
                    
                    localStorage.removeItem('badminton-currentUser-id');
                    setCurrentUser(null);
                    setModal({ type: null, data: null });
                } catch (error) {
                    setModal({ type: 'alert', data: { title: '오류', body: '나가는 도중 문제가 발생했습니다.' }});
                }
            }
        }});
    }, [currentUser, updateGameState]);
    
    const handleCardClick = useCallback(async (playerId) => {
        if (!isAdmin) return;
        if (courtMove.sourceIndex !== null) {
            setCourtMove({ sourceIndex: null });
            return;
        }

        const loc = findPlayerLocation(playerId);
        const firstSelectedId = selectedPlayerIds.length > 0 ? selectedPlayerIds[0] : null;
        const firstSelectedLoc = firstSelectedId ? findPlayerLocation(firstSelectedId) : null;

        if (loc.location === 'waiting') {
            if (!firstSelectedLoc || firstSelectedLoc.location === 'waiting') {
                setSelectedPlayerIds(ids => ids.includes(playerId) ? ids.filter(id => id !== playerId) : [...ids, playerId]);
            } else { setSelectedPlayerIds([playerId]); }
        } else {
            if (!firstSelectedId) { setSelectedPlayerIds([playerId]); }
            else if (selectedPlayerIds.length === 1 && firstSelectedLoc.location !== 'waiting') {
                // [자동매칭] 수동/자동 매칭 간 교환 로직
                const updateFunction = (currentState) => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    
                    const getValue = (l) => {
                        if (l.location === 'schedule') return newState.scheduledMatches[String(l.matchIndex)][l.slotIndex];
                        if (l.location === 'auto') return newState.autoMatches[String(l.matchIndex)][l.slotIndex];
                        return null;
                    };
                    const setValue = (l, value) => {
                        if (l.location === 'schedule') newState.scheduledMatches[String(l.matchIndex)][l.slotIndex] = value;
                        if (l.location === 'auto') newState.autoMatches[String(l.matchIndex)][l.slotIndex] = value;
                    };
                    
                    // 수동/자동 매칭 간 교환만 허용
                    if((firstSelectedLoc.location !== 'schedule' && firstSelectedLoc.location !== 'auto') || (loc.location !== 'schedule' && loc.location !== 'auto')) {
                        return { newState };
                    }

                    const valA = getValue(firstSelectedLoc);
                    const valB = getValue(loc);
                    setValue(firstSelectedLoc, valB);
                    setValue(loc, valA);
                    return { newState };
                };

                await updateGameState(updateFunction, '선수 위치를 바꾸는 데 실패했습니다.');
                setSelectedPlayerIds([]);
            } else { setSelectedPlayerIds([playerId]); }
        }
    }, [isAdmin, selectedPlayerIds, findPlayerLocation, updateGameState, courtMove]);
    
    const handleSlotClick = useCallback(async (context) => {
        if (!isAdmin || selectedPlayerIds.length === 0) return;
        
        const updateFunction = (currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            const currentLocations = calculateLocations(newState, activePlayers);

            const areAllFromWaiting = selectedPlayerIds.every(id => currentLocations[id]?.location === 'waiting');

            if (areAllFromWaiting) {
                // [자동매칭] 'schedule' 위치에서만 이 로직 실행
                if (context.location !== 'schedule') return { newState };

                const playersToMove = [...selectedPlayerIds];
                let targetArray = newState.scheduledMatches[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                
                // 슬롯이 이미 채워져 있는지 다시 확인 (동시성 문제 방지)
                const isSlotOccupied = targetArray.some((p, i) => p !== null && playersToMove.length > 0 && targetArray[i] === null);
                if (isSlotOccupied) {
                   console.log("Slot was filled by another admin. Aborting move.");
                   return { newState: currentState }; // 변경 사항 없이 현재 상태 반환
                }


                const availableSlots = targetArray.filter(p => p === null).length;
                if (playersToMove.length > availableSlots) {
                    throw new Error(`자리가 부족합니다. (${availableSlots}자리 남음)`);
                }

                for (let i = 0; i < PLAYERS_PER_MATCH && playersToMove.length > 0; i++) {
                    if (targetArray[i] === null) targetArray[i] = playersToMove.shift();
                }
                newState.scheduledMatches[String(context.matchIndex)] = targetArray;

            } else if (selectedPlayerIds.length === 1) {
                const playerId = selectedPlayerIds[0];
                const sourceLocation = currentLocations[playerId];
                
                // [자동매칭] 수동/자동 매칭 간 이동 로직
                const setValue = (l, value) => {
                    if (l.location === 'schedule') newState.scheduledMatches[String(l.matchIndex)][l.slotIndex] = value;
                    if (l.location === 'auto') newState.autoMatches[String(l.matchIndex)][l.slotIndex] = value;
                };
                
                if (!sourceLocation || (sourceLocation.location !== 'schedule' && sourceLocation.location !== 'auto')) return { newState };

                setValue(sourceLocation, null); // 원래 위치 비우기
                
                let destArray;
                if (context.location === 'schedule') {
                    destArray = newState.scheduledMatches[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                } else if (context.location === 'auto') {
                    destArray = newState.autoMatches[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                } else {
                    return { newState };
                }

                if (destArray[context.slotIndex]) {
                    // 슬롯이 이미 차있다면, 교환
                    setValue(sourceLocation, destArray[context.slotIndex]);
                }
                destArray[context.slotIndex] = playerId;

                if (context.location === 'schedule') {
                    newState.scheduledMatches[String(context.matchIndex)] = destArray;
                } else if (context.location === 'auto') {
                    newState.autoMatches[String(context.matchIndex)] = destArray;
                }
            }
            return { newState };
        };

        await updateGameState(updateFunction, '선수를 경기에 배정하는 데 실패했습니다.');
        setSelectedPlayerIds([]);
    }, [isAdmin, selectedPlayerIds, activePlayers, updateGameState]);
    
    // [자동매칭] matchType (schedule/auto)을 받도록 수정
    const handleStartMatch = useCallback(async (matchIndex, matchType = 'schedule') => {
        if (!gameState) return;

        const match = matchType === 'schedule'
            ? gameState.scheduledMatches[String(matchIndex)] || []
            : gameState.autoMatches[String(matchIndex)] || [];

        if (match.filter(p => p).length !== PLAYERS_PER_MATCH) return;
        
        const isAnyPlayerBusy = match.some(playerId => inProgressPlayerIds.has(playerId));
        if (isAnyPlayerBusy) {
            setModal({ type: 'alert', data: { title: '시작 불가', body: '선수가 이미 경기중입니다.' } });
            return;
        }

        const emptyCourts = [];
        for (let i = 0; i < gameState.numInProgressCourts; i++) {
            if (!gameState.inProgressCourts[i]) {
                emptyCourts.push(i);
            }
        }

        if (emptyCourts.length === 0) { 
            setModal({type: 'alert', data: { title: "시작 불가", body: "빈 코트가 없습니다." } }); 
            return; 
        }

        const start = async (courtIndex) => {
            const updateFunction = (currentState) => {
                const newState = JSON.parse(JSON.stringify(currentState));
                let playersToMove = [];

                if (matchType === 'schedule') {
                    const currentMatch = newState.scheduledMatches[String(matchIndex)] || [];
                    if(currentMatch.filter(p=>p).length !== PLAYERS_PER_MATCH) {
                        throw new Error("경기를 시작할 수 없습니다. 다른 관리자가 먼저 시작했을 수 있습니다.");
                    }
                    playersToMove = [...newState.scheduledMatches[String(matchIndex)]];
                    
                    // 수동 매칭 목록 당기기
                    for (let i = matchIndex; i < newState.numScheduledMatches - 1; i++) {
                        newState.scheduledMatches[String(i)] = newState.scheduledMatches[String(i + 1)] || Array(PLAYERS_PER_MATCH).fill(null);
                    }
                    newState.scheduledMatches[String(newState.numScheduledMatches - 1)] = Array(PLAYERS_PER_MATCH).fill(null);

                } else { // 'auto'
                    const currentMatch = newState.autoMatches[String(matchIndex)] || [];
                    if(currentMatch.filter(p=>p).length !== PLAYERS_PER_MATCH) {
                        throw new Error("경기를 시작할 수 없습니다. 다른 관리자가 먼저 시작했을 수 있습니다.");
                    }
                    playersToMove = [...newState.autoMatches[String(matchIndex)]];
                    
                    // 자동 매칭 목록에서 제거 및 재인덱싱
                    delete newState.autoMatches[matchIndex];
                    const reindexedMatches = {};
                    Object.values(newState.autoMatches).forEach((m, i) => {
                        reindexedMatches[String(i)] = m;
                    });
                    newState.autoMatches = reindexedMatches;
                }
                
                newState.inProgressCourts[courtIndex] = { players: playersToMove, startTime: new Date().toISOString() };
                
                return { newState };
            };

            await updateGameState(updateFunction, '경기를 시작하는 데 실패했습니다. 다른 관리자가 먼저 시작했을 수 있습니다.');
            setModal({type:null, data:null});
        };

        if (emptyCourts.length === 1) { 
            start(emptyCourts[0]); 
        } else { 
            setModal({ type: 'courtSelection', data: { courts: emptyCourts, onSelect: start } }); 
        }
    }, [gameState, updateGameState, inProgressPlayerIds]);

    const processMatchResult = useCallback(async (courtIndex, winningTeam) => {
        const court = gameState.inProgressCourts[courtIndex];
        if (!court) return;
        const allMatchPlayerIds = court.players;

        const batch = writeBatch(db);
        const now = new Date().toISOString();
        
        const winners = winningTeam;
        const losers = allMatchPlayerIds.filter(pId => !winningTeam.includes(pId));

        allMatchPlayerIds.forEach(pId => {
            const player = allPlayers[pId];
            if(!player) return;

            const isWinner = winningTeam.includes(pId);
            const newWinStreak = isWinner ? (player.todayWinStreak || 0) + 1 : 0;
            
            let newWinStreakCount = player.todayWinStreakCount || 0;
            if (isWinner && newWinStreak >= 3) {
                newWinStreakCount += 1;
            }

            const updatedData = {
                todayWins: (player.todayWins || 0) + (isWinner ? 1 : 0),
                todayLosses: (player.todayLosses || 0) + (isWinner ? 0 : 1),
                todayWinStreak: newWinStreak,
                todayWinStreakCount: newWinStreakCount,
            };

            const gameRecord = {
                result: isWinner ? '승' : '패',
                timestamp: now,
                partners: (isWinner ? winners : losers).filter(id => id !== pId),
                opponents: isWinner ? losers : winners
            };

            // [자동매칭] 기록이 올바르게 저장되도록 수정 (최신 10개)
            const recentGames = (player.todayRecentGames || []).slice(0, 9);
            updatedData.todayRecentGames = [gameRecord, ...recentGames];

            batch.update(doc(playersRef, pId), updatedData);
        });
        
        const updateFunction = (currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            newState.inProgressCourts[courtIndex] = null;
            return { newState };
        };
        try {
            await batch.commit();
            await updateGameState(updateFunction);
        } catch(e) {
            console.error(e);
            setModal({ type: 'alert', data: { title: '오류', body: '결과 처리에 실패했습니다.' }});
        }
        setModal({ type: null, data: null });
    }, [gameState, allPlayers, updateGameState]);

    const handleEndMatch = useCallback(async (courtIndex) => {
        const court = gameState.inProgressCourts[courtIndex];
        if (!court || !court.players || court.players.some(p=>!p)) return;
        
        const matchPlayers = court.players
            .map(pid => allPlayers[pid])
            .filter(Boolean);
        
        if (matchPlayers.length !== PLAYERS_PER_MATCH) {
             setModal({
                type: 'alert',
                data: {
                    title: '오류',
                    body: '경기에 참여한 선수 중 일부의 정보가 없습니다. 관리자에게 문의하세요.'
                }
            });
            return;
        }

        setModal({
            type: 'resultInput',
            data: {
                courtIndex,
                players: matchPlayers,
                onResultSubmit: processMatchResult,
            }
        });
    }, [gameState, allPlayers, processMatchResult]);
    
    // [자동 매칭] 스케줄러 실행 로직
    const runMatchScheduler = useCallback(async () => {
        if (!isAdmin || isSchedulerRunningRef.current || !seasonConfig || !seasonConfig.autoMatchConfig.isEnabled || !allPlayers || !gameState) {
            return;
        }

        isSchedulerRunningRef.current = true;
        try {
            const config = seasonConfig.autoMatchConfig;
            
            // 현재 자동 매칭 목록에 있는 선수들
            const autoMatchedPlayerIds = new Set(
                Object.values(gameState.autoMatches || {}).flatMap(match => match)
            );

            // [자동매칭] '휴식' 중이거나 이미 '자동 매칭' 목록에 있는 선수는 풀에서 제외
            const malePool = waitingPlayers.filter(p => p.gender === '남' && !autoMatchedPlayerIds.has(p.id));
            const femalePool = waitingPlayers.filter(p => p.gender === '여' && !autoMatchedPlayerIds.has(p.id));

            const bestMaleMatches = findBestMatches(malePool, allPlayers, config.minMaleScore);
            const bestFemaleMatches = findBestMatches(femalePool, allPlayers, config.minFemaleScore);
            
            const newMatches = [...bestMaleMatches, ...bestFemaleMatches];

            if (newMatches.length > 0) {
                const updateFunction = (currentState) => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    let nextIndex = Object.keys(newState.autoMatches || {}).length;

                    for (const match of newMatches) {
                        newState.autoMatches[String(nextIndex)] = match.map(p => p.id); // Store IDs
                        nextIndex++;
                    }
                    return { newState };
                };
                await updateGameState(updateFunction, "자동 매칭 생성에 실패했습니다.");
            }
        } catch (error) {
            console.error("Auto-match scheduler error:", error);
        } finally {
            isSchedulerRunningRef.current = false;
        }
    }, [isAdmin, seasonConfig, allPlayers, gameState, waitingPlayers, updateGameState]);

    // [자동매칭] 스케줄러 실행 useEffect
    useEffect(() => {
        const isAutoMatchEnabled = isAdmin && seasonConfig?.autoMatchConfig?.isEnabled;

        if (isAutoMatchEnabled) {
            if (!schedulerIntervalRef.current) {
                // 10초마다 스케줄러 실행
                schedulerIntervalRef.current = setInterval(runMatchScheduler, 10000);
            }
        } else {
            if (schedulerIntervalRef.current) {
                clearInterval(schedulerIntervalRef.current);
                schedulerIntervalRef.current = null;
            }
        }
        
        // 컴포넌트 언마운트 시 인터벌 정리
        return () => {
            if (schedulerIntervalRef.current) {
                clearInterval(schedulerIntervalRef.current);
                schedulerIntervalRef.current = null;
            }
        };
    }, [isAdmin, seasonConfig?.autoMatchConfig?.isEnabled, runMatchScheduler]);
    
    // [자동매칭] 더 이상 사용하지 않는 함수
    // handleAutoMatchGenerate
    // handleRemoveFromAutoMatch

    const handleStartAutoMatch = useCallback((matchIndex) => {
        // handleStartMatch 함수로 통합됨
        handleStartMatch(matchIndex, 'auto');
    }, [handleStartMatch]);
    
    const handleClearAutoMatches = useCallback(() => {
        setModal({ type: 'confirm', data: { 
            title: '전체 삭제', 
            body: '자동 매칭 목록을 모두 삭제할까요?',
            onConfirm: () => {
                updateGameState(currentState => ({ newState: { ...currentState, autoMatches: {} } }));
                setModal({type:null, data:null});
            }
        }});
    }, [updateGameState]);
    
    const handleDeleteAutoMatch = useCallback((matchIndex) => {
        setModal({ type: 'confirm', data: { 
            title: '경기 삭제', 
            body: `${parseInt(matchIndex, 10) + 1}번 경기를 삭제할까요?`,
            onConfirm: () => {
                updateGameState(currentState => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    delete newState.autoMatches[matchIndex];
                    const reindexedMatches = {};
                    Object.values(newState.autoMatches).forEach((m, i) => {
                        reindexedMatches[String(i)] = m;
                    });
                    newState.autoMatches = reindexedMatches;
                    return { newState };
                });
                setModal({type:null, data:null});
            }
        }});
    }, [updateGameState]);
    
    const handleAutoMatchCardClick = useCallback(async (matchIndex, slotIndex) => {
        if (!isAdmin) return;

        const cardLoc = { location: 'auto', matchIndex, slotIndex };

        if (!selectedPlayerIds.length) {
            // 선택된 카드가 없으면, 이 카드를 선택
            // handleCardClick이 이 로직을 처리하도록 유도 (선택 로직 통합)
            const player = gameState.autoMatches[matchIndex][slotIndex];
            if (player) handleCardClick(player);
            return;
        }

        // 이미 선택된 카드가 있으면, 교환 시도
        // handleCardClick이 이 로직을 처리함
        const player = gameState.autoMatches[matchIndex][slotIndex];
        if (player) {
            handleCardClick(player);
        } else {
            // 빈 슬롯 클릭 시도 (선택된 선수 이동)
            handleSlotClick(cardLoc);
        }

    }, [isAdmin, gameState, selectedPlayerIds, handleCardClick, handleSlotClick]);

    const handleAutoMatchSlotClick = useCallback(async (matchIndex, slotIndex) => {
        if (!isAdmin) return;
        // handleSlotClick으로 로직 통합
        handleSlotClick({ location: 'auto', matchIndex, slotIndex });
    }, [isAdmin, handleSlotClick]);


    const handleClearScheduledMatches = useCallback(() => {
        setModal({ type: 'confirm', data: { 
            title: '전체 삭제', 
            body: '모든 (수동) 예정 경기를 삭제할까요?',
            onConfirm: async () => {
                await updateGameState((currentState) => {
                    const newState = { ...currentState, scheduledMatches: {} };
                    return { newState };
                });
                setModal({type:null, data:null});
            }
        }});
    }, [updateGameState]);
    
    const handleDeleteScheduledMatch = useCallback((matchIndex) => {
        setModal({ type: 'confirm', data: { 
            title: '경기 삭제', 
            body: `${matchIndex + 1}번 (수동) 예정 경기를 삭제할까요?`,
            onConfirm: async () => {
                 await updateGameState((currentState) => {
                    const newState = { ...currentState };
                    for (let i = matchIndex; i < newState.numScheduledMatches - 1; i++) {
                        newState.scheduledMatches[String(i)] = newState.scheduledMatches[String(i + 1)] || Array(4).fill(null);
                    }
                    newState.scheduledMatches[String(newState.numScheduledMatches - 1)] = Array(4).fill(null);
                    return { newState };
                });
                setModal({type:null, data:null});
            }
        }});
    }, [updateGameState]);


    const handleResetAllRankings = useCallback(async () => {
        setModal({ type: 'alert', data: { title: '처리 중...', body: '랭킹 초기화 작업을 진행하고 있습니다.' } });
        try {
            const allPlayersSnapshot = await getDocs(query(playersRef, where("isGuest", "==", false)));
            const batch = writeBatch(db);
            
            allPlayersSnapshot.forEach(playerDoc => {
                batch.update(playerDoc.ref, {
                    wins: 0,
                    losses: 0,
                    rp: 0,
                    attendanceCount: 0,
                    winStreak: 0,
                    winStreakCount: 0,
                    recentGames: []
                });
            });
            
            await batch.commit();
            setModal({ type: 'alert', data: { title: '성공', body: '모든 누적 랭킹 정보가 성공적으로 초기화되었습니다.' } });
        } catch (error) {
            console.error("Ranking reset failed:", error);
            setModal({ type: 'alert', data: { title: '오류', body: '랭킹 초기화에 실패했습니다.' } });
        }
    }, []);

    const handleSystemReset = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '시스템 초기화',
            body: '[경고] 모든 선수가 대기 명단으로 이동하고, 진행/예정/자동매칭 경기가 모두 사라집니다. 선수 기록은 유지됩니다. 계속하시겠습니까?',
            onConfirm: async () => {
                const updateFunction = (currentState) => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    newState.scheduledMatches = {};
                    newState.inProgressCourts = Array(newState.numInProgressCourts).fill(null);
                    newState.autoMatches = {};
                    return { newState };
                };
                await updateGameState(updateFunction, '시스템 초기화에 실패했습니다.');
                setModal({ type: 'alert', data: { title: '완료', body: '시스템이 초기화되었습니다.' }});
            }
        }});
    }, [updateGameState]);
    
    const handleMoveOrSwapCourt = useCallback(async (sourceIndex, targetIndex) => {
        if (sourceIndex === targetIndex) return;

        const updateFunction = (currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            
            if (newState.inProgressCourts.length < newState.numInProgressCourts) {
                newState.inProgressCourts.length = newState.numInProgressCourts;
                newState.inProgressCourts.fill(null, newState.inProgressCourts.length);
            }

            const sourceCourtData = newState.inProgressCourts[sourceIndex] || null;
            const targetCourtData = newState.inProgressCourts[targetIndex] || null;

            newState.inProgressCourts[sourceIndex] = targetCourtData;
            newState.inProgressCourts[targetIndex] = sourceCourtData;

            return { newState };
        };
        
        await updateGameState(updateFunction, '코트 이동/교환에 실패했습니다.');
        setCourtMove({ sourceIndex: null });
    }, [updateGameState]);

    // [자동매칭] 설정 저장 로직 수정
    const handleSettingsUpdate = useCallback(async (settings) => {
        try {
            const { scheduled, courts, announcement, pointSystemInfo, autoMatchConfig } = settings;
            
            await runTransaction(db, async (transaction) => {
                const currentGameStateDoc = await transaction.get(gameStateRef);
                if (!currentGameStateDoc.exists()) {
                    throw new Error("GameState document does not exist!");
                }
                const currentGameState = currentGameStateDoc.data();

                const newGameState = { ...currentGameState, numScheduledMatches: scheduled, numInProgressCourts: courts };
                
                let currentCourts = newGameState.inProgressCourts || [];
                if (currentCourts.length > courts) {
                    newGameState.inProgressCourts = currentCourts.slice(0, courts);
                } else {
                    newGameState.inProgressCourts = [...currentCourts, ...Array(courts - currentCourts.length).fill(null)];
                }
                transaction.set(gameStateRef, newGameState);
    
                // autoMatchConfig도 함께 저장
                transaction.set(configRef, { announcement, pointSystemInfo, autoMatchConfig }, { merge: true });
            });
            
            setIsSettingsOpen(false);
            setModal({ type: 'alert', data: { title: '저장 완료', body: '설정이 성공적으로 저장되었습니다.' } });
        } catch (error) {
            console.error("Settings save failed:", error);
            setModal({ type: 'alert', data: { title: '저장 실패', body: '설정 저장 중 오류가 발생했습니다.' } });
        }
    }, []);

    const handleToggleRest = useCallback(async () => {
        if (!currentUser) return;
        const playerDocRef = doc(playersRef, currentUser.id);
        const newRestingState = !currentUser.isResting;
        
        try {
            // [자동매칭] 휴식 시 자동/수동 매칭에서 즉시 제거
            if (newRestingState) {
                const loc = findPlayerLocation(currentUser.id);
                if (loc.location === 'schedule' || loc.location === 'auto') {
                    await handleReturnToWaiting(currentUser);
                }
            }
            await updateDoc(playerDocRef, { isResting: newRestingState });
        } catch (error) {
            setModal({ type: 'alert', data: { title: '오류', body: '휴식 상태 변경에 실패했습니다.' }});
        }
    }, [currentUser, findPlayerLocation, handleReturnToWaiting]);


    if (isLoading) {
        return <div className="bg-black text-white min-h-screen flex items-center justify-center font-sans p-4"><div className="text-yellow-400 arcade-font">LOADING...</div></div>;
    }

    if (!currentUser) {
        return <EntryPage onEnter={handleEnter} />;
    }

    return (
        <div className="bg-black text-white min-h-screen font-sans flex flex-col" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
            {resetNotification && (
                <ConfirmationModal 
                    title={resetNotification.status === 'error' ? "⚠️ 저장 오류" : "🏆 시즌 마감"}
                    body={resetNotification.message}
                    onConfirm={async () => {
                        if (resetNotification.status === 'pending') {
                            await handleResetAllRankings();
                        }
                        await updateDoc(doc(notificationsRef, resetNotification.id), { status: 'acknowledged' });
                        setResetNotification(null);
                    }}
                    onCancel={async () => {
                        await updateDoc(doc(notificationsRef, resetNotification.id), { status: 'acknowledged' });
                        setResetNotification(null);
                    }}
                />
            )}
            
            {modal?.type === 'season' && <SeasonModal {...modal.data} onClose={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'resultInput' && <ResultInputModal {...modal.data} onClose={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'profile' && <ProfileModal player={modal.data.player} onClose={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'adminEditPlayer' && <AdminEditPlayerModal player={modal.data.player} mode={modal.data.mode} allPlayers={allPlayers} onClose={() => setModal({ type: null, data: null })} setModal={setModal} />}
            {modal?.type === 'pointSystemInfo' && <PointSystemModal content={modal.data.content} onClose={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'confirm' && <ConfirmationModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'courtSelection' && <CourtSelectionModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'alert' && <AlertModal {...modal.data} onClose={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'rankingHistory' && <RankingHistoryModal onCancel={() => setModal({ type: null, data: null })} />}
            {/* [자동매칭] AutoMatchSetupModal은 더 이상 사용하지 않음 (설정으로 통합) */}
            
            {isSettingsOpen && <SettingsModal 
                isAdmin={isAdmin}
                scheduledCount={gameState.numScheduledMatches} 
                courtCount={gameState.numInProgressCourts}
                seasonConfig={seasonConfig}
                waitingPlayers={waitingPlayers} /* [자동매칭] CI 계산을 위해 waitingPlayers 전달 */
                onSave={handleSettingsUpdate}
                onCancel={() => setIsSettingsOpen(false)} 
                setModal={setModal}
                onSystemReset={handleSystemReset}
            />}
            
            <header className="flex-shrink-0 p-2 flex flex-col gap-1 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-20 border-b border-gray-700">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center flex-shrink-0">
                        <h1 className="text-sm sm:text-lg font-bold text-yellow-400 arcade-font flicker-text flex items-center">
                            <span className="mr-1">⚡</span>
                            <span className="uppercase">COCKSLIGHTING</span>
                        </h1>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                       <span className="text-xs font-bold whitespace-nowrap">{isAdmin ? '👑' : ''} {currentUser.name}</span>
                       <button onClick={handleLogout} className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-md text-xs whitespace-nowrap">나가기</button>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                    {isAdmin && (
                        <>
                            <button onClick={() => setIsSettingsOpen(true)} className="text-gray-400 hover:text-white text-lg px-1">
                                <i className="fas fa-cog"></i>
                            </button>
                            {/* [자동매칭] 로봇 버튼은 설정으로 통합되어 제거
                            <button onClick={() => setModal({ type: 'autoMatchSetup' })} className="text-gray-400 hover:text-white text-lg px-1">
                                <i className="fas fa-robot"></i>
                            </button>
                            */}
                        </>
                    )}
                    <button
                        onClick={handleToggleRest}
                        className={`arcade-button py-1.5 px-2.5 rounded-md text-xs font-bold transition-colors whitespace-nowrap ${
                            currentUser.isResting
                                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                        }`}
                    >
                        {currentUser.isResting ? '복귀' : '휴식'}
                    </button>
                    <button onClick={() => setCurrentPage(p => p === 'main' ? 'ranking' : 'main')} className="arcade-button py-1.5 px-2.5 rounded-md text-xs font-bold bg-gray-700 hover:bg-gray-600 text-yellow-300 transition-colors whitespace-nowrap">
                        {currentPage === 'main' ? '⭐ 콕스타' : '🕹️ 현황판'}
                    </button>
                </div>
            </header>

            <main className="flex-grow flex flex-col gap-3 p-1.5 overflow-y-auto">
                {currentPage === 'main' ? (
                    isMobile ? (
                        <>
                            <div className="flex-shrink-0 flex justify-around border-b border-gray-700 mb-2 sticky top-0 bg-black z-10">
                                <button 
                                    onClick={() => setActiveTab('matching')} 
                                    className={`py-2 px-4 font-bold ${activeTab === 'matching' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-400'}`}
                                >
                                    경기 예정
                                </button>
                                <button 
                                    onClick={() => setActiveTab('inProgress')}
                                    className={`py-2 px-4 font-bold ${activeTab === 'inProgress' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-400'}`}
                                >
                                    경기 진행
                                </button>
                            </div>
                            <div className="flex flex-col gap-3">
                                {activeTab === 'matching' && (
                                    <>
                                        <WaitingListSection maleWaitingPlayers={maleWaitingPlayers} femaleWaitingPlayers={femaleWaitingPlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleDeleteFromWaiting={handleDeleteFromWaiting} setModal={setModal} currentUser={currentUser} inProgressPlayerIds={inProgressPlayerIds} onClearAllWaitingPlayers={handleClearAllWaitingPlayers} />
                                        <AutoMatchesSection autoMatches={autoMatches} players={activePlayers} isAdmin={isAdmin} handleStartAutoMatch={handleStartAutoMatch} handleReturnToWaiting={handleReturnToWaiting} handleClearAutoMatches={handleClearAutoMatches} handleDeleteAutoMatch={handleDeleteAutoMatch} currentUser={currentUser} handleAutoMatchCardClick={handleAutoMatchCardClick} selectedAutoMatchSlot={selectedAutoMatchSlot} inProgressPlayerIds={inProgressPlayerIds} handleAutoMatchSlotClick={handleAutoMatchSlotClick} isAutoMatchOn={seasonConfig?.autoMatchConfig?.isEnabled}/>
                                        <ScheduledMatchesSection numScheduledMatches={gameState.numScheduledMatches} scheduledMatches={gameState.scheduledMatches} players={activePlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleReturnToWaiting={handleReturnToWaiting} setModal={setModal} handleSlotClick={handleSlotClick} handleStartMatch={handleStartMatch} currentUser={currentUser} handleClearScheduledMatches={handleClearScheduledMatches} handleDeleteScheduledMatch={handleDeleteScheduledMatch} inProgressPlayerIds={inProgressPlayerIds} />
                                    </>
                                )}
                                {activeTab === 'inProgress' && (
                                    <InProgressCourtsSection numInProgressCourts={gameState.numInProgressCourts} inProgressCourts={gameState.inProgressCourts} players={activePlayers} isAdmin={isAdmin} handleEndMatch={handleEndMatch} currentUser={currentUser} courtMove={courtMove} setCourtMove={setCourtMove} handleMoveOrSwapCourt={handleMoveOrSwapCourt} />
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <WaitingListSection maleWaitingPlayers={maleWaitingPlayers} femaleWaitingPlayers={femaleWaitingPlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleDeleteFromWaiting={handleDeleteFromWaiting} setModal={setModal} currentUser={currentUser} inProgressPlayerIds={inProgressPlayerIds} onClearAllWaitingPlayers={handleClearAllWaitingPlayers} />
                            <AutoMatchesSection autoMatches={autoMatches} players={activePlayers} isAdmin={isAdmin} handleStartAutoMatch={handleStartAutoMatch} handleReturnToWaiting={handleReturnToWaiting} handleClearAutoMatches={handleClearAutoMatches} handleDeleteAutoMatch={handleDeleteAutoMatch} currentUser={currentUser} handleAutoMatchCardClick={handleAutoMatchCardClick} selectedAutoMatchSlot={selectedAutoMatchSlot} inProgressPlayerIds={inProgressPlayerIds} handleAutoMatchSlotClick={handleAutoMatchSlotClick} isAutoMatchOn={seasonConfig?.autoMatchConfig?.isEnabled}/>
                            <ScheduledMatchesSection numScheduledMatches={gameState.numScheduledMatches} scheduledMatches={gameState.scheduledMatches} players={activePlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleReturnToWaiting={handleReturnToWaiting} setModal={setModal} handleSlotClick={handleSlotClick} handleStartMatch={handleStartMatch} currentUser={currentUser} handleClearScheduledMatches={handleClearScheduledMatches} handleDeleteScheduledMatch={handleDeleteScheduledMatch} inProgressPlayerIds={inProgressPlayerIds} />
                            <InProgressCourtsSection numInProgressCourts={gameState.numInProgressCourts} inProgressCourts={gameState.inProgressCourts} players={activePlayers} isAdmin={isAdmin} handleEndMatch={handleEndMatch} currentUser={currentUser} courtMove={courtMove} setCourtMove={setCourtMove} handleMoveOrSwapCourt={handleMoveOrSwapCourt} />
                        </>
                    )
                ) : (
                    <RankingPage players={allPlayers} currentUser={currentUser} isAdmin={isAdmin} onProfileClick={(player, rankingPeriod) => { setModal({ type: 'adminEditPlayer', data: { player, mode: rankingPeriod }})}} onInfoClick={() => setModal({type: 'pointSystemInfo', data: { content: seasonConfig.pointSystemInfo }})} onHistoryClick={() => setModal({ type: 'rankingHistory' })} setModal={setModal} />
                )}
            </main>
            <style>{`
                body, .player-card, div, button, span, h1, h2, h3, p {
                    -webkit-user-select: none;
                    -moz-user-select: none;
                    -ms-user-select: none;
                    user-select: none;
                }
                .arcade-font { font-family: 'Press Start 2P', cursive; }
                .arcade-button {
                    position: relative;
                    border: 2px solid #222;
                    box-shadow: inset -2px -2px 0px 0px #333, inset 2px 2px 0px 0px #FFF;
                    white-space: nowrap;
                }
                .arcade-button:active {
                    transform: translateY(2px);
                    box-shadow: inset -1px -1px 0px 0px #333, inset 1px 1px 0px 0px #FFF;
                }
                @keyframes flicker {
                  0%, 100% { opacity: 1; text-shadow: 0 0 8px #FFD700, 0 0 12px #22c55e; }
                  50% { opacity: 0.8; text-shadow: 0 0 12px #FFD700, 0 0 18px #22c55e; }
                }
                .flicker-text {
                  animation: flicker 1.5s infinite;
                }
            `}</style>
        </div>
    );
}

// ===================================================================================
// 신규 및 복구된 페이지/모달 컴포넌트들
// ===================================================================================
function EntryPage({ onEnter }) {
    const [formData, setFormData] = useState({ name: '', level: 'A조', gender: '남', isGuest: false });

    useEffect(() => {
        const savedUserId = localStorage.getItem('badminton-currentUser-id');
        if (savedUserId) {
             getDoc(doc(playersRef, savedUserId)).then(docSnap => {
                if (docSnap.exists()) { setFormData(prev => ({...prev, ...docSnap.data()})); }
            });
        }
    }, []);

    const handleChange = (e) => { 
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value })); 
    };
    const handleSubmit = (e) => { e.preventDefault(); onEnter(formData); };
    
    const levelButtons = ['A조', 'B조', 'C조', 'D조'].map(level => (
        <button
            key={level}
            type="button"
            name="level"
            onClick={() => setFormData(prev => ({ ...prev, level }))}
            className={`w-full p-3 rounded-md font-bold transition-colors arcade-button ${formData.level === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}
        >
            {level}
        </button>
    ));

    return (
        <div className="bg-black text-white min-h-screen flex items-center justify-center font-sans p-4">
            <div className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-sm">
                <h1 className="text-3xl font-bold text-yellow-400 mb-6 text-center arcade-font flicker-text">⚡ COCKSLIGHTING</h1>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="text" name="name" placeholder="이름" value={formData.name} onChange={handleChange} className="w-full bg-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400" required />
                    <div className="grid grid-cols-4 gap-2">
                        {levelButtons}
                    </div>
                    <div className="flex justify-around items-center text-lg">
                        <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="남" checked={formData.gender === '남'} onChange={handleChange} className="mr-2 h-4 w-4 text-yellow-500 bg-gray-700 border-gray-600 focus:ring-yellow-500" /> 남자</label>
                        <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="여" checked={formData.gender === '여'} onChange={handleChange} className="mr-2 h-4 w-4 text-pink-500 bg-gray-700 border-gray-600 focus:ring-pink-500" /> 여자</label>
                    </div>
                    <div className="text-center">
                        <label className="flex items-center justify-center text-lg cursor-pointer">
                            <input type="checkbox" name="isGuest" checked={formData.isGuest} onChange={handleChange} className="mr-2 h-4 w-4 rounded text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" />
                            게스트
                        </label>
                    </div>
                    <button type="submit" className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 rounded-lg transition duration-300">입장하기</button>
                </form>
            </div>
        </div>
    );
}

function RankingPage({ players, currentUser, isAdmin, onProfileClick, onInfoClick, onHistoryClick }) {
    const [rankingPeriod, setRankingPeriod] = useState('monthly');

    const rankedPlayers = useMemo(() => {
        let playersToRank = Object.values(players).filter(p => !p.isGuest);

        if (rankingPeriod === 'today') {
            playersToRank = playersToRank
                .map(p => {
                    const todayWins = p.todayWins || 0;
                    const todayLosses = p.todayLosses || 0;
                    const todayWinStreakCount = p.todayWinStreakCount || 0;
                    const todayRp = (todayWins * RP_CONFIG.WIN) + (todayLosses * RP_CONFIG.LOSS) + (todayWinStreakCount * RP_CONFIG.WIN_STREAK_BONUS);
                    return { ...p, todayRp, todayTotalGames: todayWins + todayLosses };
                })
                .filter(p => p.todayTotalGames > 0)
                .sort((a, b) => b.todayRp - a.todayRp);
        } else {
            playersToRank = playersToRank
                .filter(p => (p.wins || 0) > 0 || (p.losses || 0) > 0 || (p.attendanceCount || 0) > 0)
                .sort((a, b) => (b.rp || 0) - (a.rp || 0));
        }

        return playersToRank.map((p, index) => ({ ...p, rank: index + 1 }));
    }, [players, rankingPeriod]);

    const getRankStyle = (rank) => {
        switch (rank) {
            case 1: return { container: 'bg-gradient-to-br from-yellow-300 to-yellow-500 border-yellow-400 shadow-lg shadow-yellow-500/30', rankText: 'text-yellow-800', nameText: 'text-white', infoText: 'text-yellow-100', medal: '🥇' };
            case 2: return { container: 'bg-gradient-to-br from-gray-300 to-gray-400 border-gray-200 shadow-lg shadow-gray-500/30', rankText: 'text-gray-700', nameText: 'text-gray-800', infoText: 'text-gray-600', medal: '🥈' };
            case 3: return { container: 'bg-gradient-to-br from-orange-400 to-yellow-600 border-orange-500 shadow-lg shadow-orange-500/30', rankText: 'text-orange-900', nameText: 'text-white', infoText: 'text-orange-100', medal: '🥉' };
            default: return { container: 'bg-gray-800', rankText: 'text-white', nameText: 'text-white', infoText: 'text-gray-400', medal: '' };
        }
    };

    return (
        <div className="p-2">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-yellow-400 arcade-font flicker-text">⭐ COCKS STAR</h2>
                <div>
                     {isAdmin && <button onClick={onHistoryClick} className="arcade-button text-xs bg-gray-700 text-cyan-300 py-2 px-3 rounded-md mr-2">기록</button>}
                    <button onClick={onInfoClick} className="arcade-button text-xs bg-gray-700 text-yellow-300 py-2 px-3 rounded-md">점수?</button>
                </div>
            </div>

            <div className="flex justify-center gap-2 mb-4">
                <button 
                    onClick={() => setRankingPeriod('today')}
                    className={`arcade-button py-2 px-4 rounded-md text-xs font-bold transition-colors ${rankingPeriod === 'today' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300'}`}
                >
                    오늘
                </button>
                <button 
                    onClick={() => setRankingPeriod('monthly')}
                    className={`arcade-button py-2 px-4 rounded-md text-xs font-bold transition-colors ${rankingPeriod === 'monthly' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300'}`}
                >
                    이번달
                </button>
            </div>

            <div className="space-y-2">
                {rankedPlayers.map(p => {
                    const isMonthly = rankingPeriod === 'monthly';
                    const wins = isMonthly ? (p.wins || 0) : (p.todayWins || 0);
                    const losses = isMonthly ? (p.losses || 0) : (p.todayLosses || 0);
                    const rp = isMonthly ? (p.rp || 0) : (p.todayRp || 0);
                    const attendanceCount = p.attendanceCount || 0;
                    const winStreakCount = isMonthly ? (p.winStreakCount || 0) : (p.todayWinStreakCount || 0);

                    const totalGames = wins + losses;
                    const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(0) + '%' : '-';
                    const isCurrentUser = p.id === currentUser.id;
                    const style = getRankStyle(p.rank);
                    
                    const currentUserHighlight = isCurrentUser ? 'ring-2 ring-offset-2 ring-offset-black ring-blue-400' : '';

                    return (
                        <div key={p.id} 
                            className={`p-3 rounded-lg flex items-center gap-4 border ${style.container} ${currentUserHighlight} transition-all duration-300 transform hover:scale-105 cursor-pointer`}
                            onClick={() => onProfileClick(p, rankingPeriod)}
                        >
                            <span className={`text-xl font-bold w-12 text-center arcade-font ${style.rankText}`}>{style.medal || p.rank}</span>
                            <div className="flex-1 min-w-0">
                                <p className={`font-bold truncate ${style.nameText}`}>{p.name}</p>
                                <p className={`text-xs ${style.infoText}`}>
                                    <span className={`font-bold ${p.rank > 3 && isMonthly ? 'text-green-400' : ''}`}>{rp} RP</span> | {wins}승 {losses}패 ({winRate}) | {winStreakCount}연승
                                    {isMonthly && ` | ${attendanceCount}참`}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ProfileModal({ player, onClose }) {
    const getAchievementIcon = (ach) => {
        if (ach === '첫 승리') return '🏆';
        if (ach === '10승 클럽') return '🔟';
        if (ach === '불꽃 연승') return '🔥';
        return '🌟';
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md text-white shadow-lg flex flex-col gap-4">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-2xl font-bold text-yellow-400">{player.name}</h3>
                        <p className="text-gray-400">{player.level} / {player.gender}</p>
                    </div>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white">&times;</button>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <div className="bg-gray-700/50 p-3 rounded-lg">
                        <p className="text-sm text-gray-400">랭킹</p>
                        <p className="text-3xl font-bold arcade-font">{player.rank}</p>
                    </div>
                    <div className="bg-gray-700/50 p-3 rounded-lg">
                        <p className="text-sm text-gray-400">RP</p>
                        <p className="text-3xl font-bold arcade-font">{player.rp || 0}</p>
                    </div>
                    <div className="bg-gray-700/50 p-3 rounded-lg">
                        <p className="text-sm text-gray-400">참석</p>
                        <p className="text-3xl font-bold arcade-font">{player.attendanceCount || 0}</p>
                    </div>
                    <div className="bg-gray-700/50 p-3 rounded-lg">
                        <p className="text-sm text-gray-400">연승횟수</p>
                        <p className="text-3xl font-bold arcade-font">{player.winStreakCount || 0}</p>
                    </div>
                </div>

                <div>
                    <h4 className="font-bold mb-2 text-yellow-400">업적</h4>
                    <div className="flex flex-wrap gap-2">
                        {(player.achievements && player.achievements.length > 0) ? player.achievements.map(ach => (
                            <span key={ach} className="bg-gray-700 text-sm py-1 px-3 rounded-full">{getAchievementIcon(ach)} {ach}</span>
                        )) : <p className="text-sm text-gray-500">아직 달성한 업적이 없습니다.</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function SeasonModal({ announcement, seasonId, onClose }) {
    const handleClose = () => {
        localStorage.setItem(`seen-${seasonId}`, new Date().toDateString());
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font flicker-text">📢 시즌 공지</h3>
                <p className="text-gray-300 mb-6 whitespace-pre-wrap">{announcement}</p>
                <div className="flex flex-col gap-2">
                    <button onClick={handleClose} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 rounded-lg transition-colors">확인</button>
                    <button onClick={handleClose} className="w-full text-gray-500 text-xs mt-2 hover:text-white">오늘 하루 보지 않기</button>
                </div>
            </div>
        </div>
    );
}

function ResultInputModal({ courtIndex, players, onResultSubmit, onClose }) {
    const [winners, setWinners] = useState([]);

    const handlePlayerClick = (playerId) => {
        setWinners(prev => {
            if (prev.includes(playerId)) {
                return prev.filter(id => id !== playerId);
            }
            if (prev.length < 2) {
                return [...prev, playerId];
            }
            return prev;
        });
    };

    useEffect(() => {
        if (winners.length === 2) {
            const timer = setTimeout(() => {
                onResultSubmit(courtIndex, winners);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [winners, courtIndex, onResultSubmit]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md text-center shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font flicker-text">승리팀 선택</h3>
                <p className="text-gray-300 mb-6">승리한 선수 2명을 선택하세요.</p>
                <div className="grid grid-cols-4 gap-2">
                    {players.map(p => (
                        <PlayerCard 
                            key={p.id}
                            player={p} 
                            context={{}} 
                            isMovable={true}
                            onCardClick={() => handlePlayerClick(p.id)}
                            isSelectedForWin={winners.includes(p.id)}
                        />
                    ))}
                </div>
                <button onClick={onClose} className="mt-6 w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button>
            </div>
        </div>
    );
}

function PointSystemModal({ content, onClose }) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-left shadow-lg">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-yellow-400 arcade-font">점수 시스템</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white">&times;</button>
                </div>
                <p className="text-gray-300 mb-6 whitespace-pre-wrap">{content}</p>
                <button onClick={onClose} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors">확인</button>
            </div>
        </div>
    );
}

function AdminEditPlayerModal({ player, mode, allPlayers, onClose, setModal }) {
    const isMonthlyMode = mode === 'monthly';
    const [stats, setStats] = useState({
        todayWins: player.todayWins || 0,
        todayLosses: player.todayLosses || 0,
        todayWinStreakCount: player.todayWinStreakCount || 0,
        wins: player.wins || 0, 
        losses: player.losses || 0,
        winStreakCount: player.winStreakCount || 0,
        attendanceCount: player.attendanceCount || 0,
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setStats(prev => ({...prev, [name]: Number(value) }));
    };

    const handleSave = async () => {
        let finalStats = {};
        if (isMonthlyMode) {
            finalStats.wins = stats.wins;
            finalStats.losses = stats.losses;
            finalStats.winStreakCount = stats.winStreakCount;
            finalStats.attendanceCount = stats.attendanceCount;
            finalStats.rp = (stats.wins * RP_CONFIG.WIN) + 
                          (stats.losses * RP_CONFIG.LOSS) + 
                          (stats.winStreakCount * RP_CONFIG.WIN_STREAK_BONUS) + 
                          (stats.attendanceCount * RP_CONFIG.ATTENDANCE);
        } else {
            finalStats.todayWins = stats.todayWins;
            finalStats.todayLosses = stats.todayLosses;
            finalStats.todayWinStreakCount = stats.todayWinStreakCount;
        }
        await updateDoc(doc(playersRef, player.id), finalStats);
        onClose();
    };
    
    const handleDeletePermanently = () => {
        setModal({ type: 'confirm', data: { title: '선수 영구 삭제', body: `[경고] ${player.name} 선수를 랭킹에서 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`,
            onConfirm: async () => { 
                await deleteDoc(doc(playersRef, player.id));
                onClose();
            }
        }});
    };

    const RecentGamesList = ({ games }) => {
        if (!games || games.length === 0) {
            return <p className="text-sm text-gray-500 text-center">오늘 경기 기록이 없습니다.</p>;
        }

        const getPlayerName = (id) => allPlayers[id]?.name || '알수없음';

        return (
            <ul className="text-sm space-y-1 max-h-32 overflow-y-auto pr-2">
                {games.map((game, i) => {
                    const partners = game.partners.map(getPlayerName).join(', ');
                    const opponents = game.opponents.map(getPlayerName).join(', ');
                    const teamText = partners ? `(팀: ${partners})` : '';

                    return (
                        <li key={i} className={`flex justify-between p-2 rounded ${game.result === '승' ? 'bg-blue-900/50' : 'bg-red-900/50'}`}>
                            <span className="truncate">vs {opponents} {teamText}</span>
                            <span className={`font-bold shrink-0 ml-2 ${game.result === '승' ? 'text-blue-400' : 'text-red-400'}`}>{game.result}</span>
                        </li>
                    )
                })}
            </ul>
        );
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md text-white shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font">{player.name} 기록 수정</h3>
                <div className="space-y-4">
                    {isMonthlyMode ? (
                        <>
                            <p className="text-sm text-center text-cyan-300 arcade-font">- 이번달 기록 -</p>
                            <div className="flex items-center justify-between"><label className="font-semibold">승</label><input type="number" name="wins" value={stats.wins} onChange={handleChange} className="w-2/3 bg-gray-700 p-2 rounded-lg text-right"/></div>
                            <div className="flex items-center justify-between"><label className="font-semibold">패</label><input type="number" name="losses" value={stats.losses} onChange={handleChange} className="w-2/3 bg-gray-700 p-2 rounded-lg text-right"/></div>
                            <div className="flex items-center justify-between"><label className="font-semibold">연승횟수</label><input type="number" name="winStreakCount" value={stats.winStreakCount} onChange={handleChange} className="w-2/3 bg-gray-700 p-2 rounded-lg text-right"/></div>
                            <div className="flex items-center justify-between"><label className="font-semibold">참석</label><input type="number" name="attendanceCount" value={stats.attendanceCount} onChange={handleChange} className="w-2/3 bg-gray-700 p-2 rounded-lg text-right"/></div>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-center text-yellow-300 arcade-font">- 오늘 기록 -</p>
                            <div className="flex items-center justify-between"><label className="font-semibold">승</label><input type="number" name="todayWins" value={stats.todayWins} onChange={handleChange} className="w-2/3 bg-gray-700 p-2 rounded-lg text-right"/></div>
                            <div className="flex items-center justify-between"><label className="font-semibold">패</label><input type="number" name="todayLosses" value={stats.todayLosses} onChange={handleChange} className="w-2/3 bg-gray-700 p-2 rounded-lg text-right"/></div>
                            <div className="flex items-center justify-between"><label className="font-semibold">연승횟수</label><input type="number" name="todayWinStreakCount" value={stats.todayWinStreakCount} onChange={handleChange} className="w-2/3 bg-gray-700 p-2 rounded-lg text-right"/></div>
                            <hr className="border-gray-600"/>
                             <h4 className="font-bold text-yellow-400 text-center">오늘의 전적</h4>
                            <RecentGamesList games={player.todayRecentGames} />
                        </>
                    )}
                </div>
                {isMonthlyMode && (
                    <div className="mt-4 flex flex-col gap-2">
                        <button onClick={handleDeletePermanently} className="w-full arcade-button bg-red-700 hover:bg-red-800 text-white font-bold py-2 rounded-lg">랭킹에서 영구 삭제</button>
                    </div>
                )}
                <div className="mt-4 flex gap-4">
                    <button onClick={onClose} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg">취소</button>
                    <button onClick={handleSave} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg">저장</button>
                </div>
            </div>
        </div>
    );
}

// [자동매칭] 설정 모달 대규모 업데이트
function SettingsModal({ isAdmin, scheduledCount, courtCount, seasonConfig, waitingPlayers, onSave, onCancel, setModal, onSystemReset }) {
    const [scheduled, setScheduled] = useState(scheduledCount);
    const [courts, setCourts] = useState(courtCount);
    const [announcement, setAnnouncement] = useState(seasonConfig.announcement);
    const [pointSystemInfo, setPointSystemInfo] = useState(seasonConfig.pointSystemInfo);
    // 자동매칭 설정 상태
    const [autoMatchConfig, setAutoMatchConfig] = useState(
        seasonConfig.autoMatchConfig || {
            isEnabled: false, maleCourts: 2, femaleCourts: 1, minMaleScore: 75, minFemaleScore: 100
        }
    );
    const [isTesting, setIsTesting] = useState(false);

    if (!isAdmin) return null;

    const handleSave = () => {
        onSave({ scheduled, courts, announcement, pointSystemInfo, autoMatchConfig });
    };
    
    const handleTest = async (functionName, confirmTitle, confirmBody) => {
        setModal({ type: 'confirm', data: { 
            title: confirmTitle, 
            body: confirmBody,
            onConfirm: async () => {
                setIsTesting(true);
                setModal({ type: 'alert', data: { title: '처리 중...', body: '테스트 함수를 실행하고 있습니다.' } });
                try {
                    const testFunction = httpsCallable(functions, functionName);
                    const result = await testFunction();
                    setModal({ type: 'alert', data: { 
                        title: '테스트 완료', 
                        body: result.data.message
                    }});
                } catch (error) {
                    console.error("Test function call failed:", error);
                    setModal({ type: 'alert', data: { 
                        title: '테스트 실패', 
                        body: `Cloud Function 호출에 실패했습니다: ${error.message}`
                    }});
                } finally {
                    setIsTesting(false);
                }
            }
        }});
    };

    const handleAutoMatchConfigChange = (e) => {
        const { name, value, type, checked } = e.target;
        setAutoMatchConfig(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : (type === 'number' ? Number(value) : value)
        }));
    };

    // [자동매칭] CI 및 추천 점수 계산 로직
    const { recommendedMaleScore, recommendedFemaleScore } = useMemo(() => {
        const maleWaitingCount = waitingPlayers.filter(p => p.gender === '남').length;
        const femaleWaitingCount = waitingPlayers.filter(p => p.gender === '여').length;

        const calcCI = (count, courts) => (courts > 0) ? (count / (courts * 4)) : 0;
        const calcMinScore = (ci) => Math.round(50 + ((ci - 1.5) * 100));

        const maleCI = calcCI(maleWaitingCount, autoMatchConfig.maleCourts);
        const femaleCI = calcCI(femaleWaitingCount, autoMatchConfig.femaleCourts);
        
        return {
            recommendedMaleScore: calcMinScore(maleCI),
            recommendedFemaleScore: calcMinScore(femaleCI)
        };
    }, [waitingPlayers, autoMatchConfig.maleCourts, autoMatchConfig.femaleCourts]);


    // Toggle Switch Component
    const ToggleSwitch = ({ name, checked, onChange }) => (
        <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" name={name} checked={checked} onChange={onChange} className="sr-only peer" />
            <div className="w-14 h-8 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-500"></div>
            <span className="ml-3 text-sm font-medium text-gray-300">
                {checked ? 'ON' : 'OFF'}
            </span>
        </label>
    );

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg text-white shadow-lg flex flex-col" style={{maxHeight: '90vh'}}>
                <h3 className="text-xl font-bold text-white mb-6 arcade-font text-center flex-shrink-0">설정</h3>
                <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                    
                    {/* --- 자동 매칭 설정 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg">
                        <div className="flex justify-between items-center">
                            <label className="font-semibold text-lg text-green-400 arcade-font">
                                🤖 콕스타 자동 매칭
                            </label>
                            <ToggleSwitch
                                name="isEnabled"
                                checked={autoMatchConfig.isEnabled}
                                onChange={handleAutoMatchConfigChange}
                            />
                        </div>

                        {autoMatchConfig.isEnabled && (
                            <div className="mt-4 pt-4 border-t border-gray-600 space-y-4">
                                <p className="font-semibold text-center">자동 매칭 전용 코트 수</p>
                                <div className="flex justify-around gap-4">
                                    <div className="flex-1 text-center">
                                        <label className="block mb-1">👨 남자 코트</label>
                                        <input type="number" name="maleCourts" value={autoMatchConfig.maleCourts} onChange={handleAutoMatchConfigChange} className="w-full bg-gray-600 p-2 rounded-lg text-center" min="0" />
                                    </div>
                                    <div className="flex-1 text-center">
                                        <label className="block mb-1">👩 여자 코트</label>
                                        <input type="number" name="femaleCourts" value={autoMatchConfig.femaleCourts} onChange={handleAutoMatchConfigChange} className="w-full bg-gray-600 p-2 rounded-lg text-center" min="0" />
                                    </div>
                                </div>

                                <div className="bg-gray-800 p-2 rounded">
                                    <p className="text-sm text-center text-gray-400">
                                        현재 대기: 남 {waitingPlayers.filter(p => p.gender === '남').length}명 / 여 {waitingPlayers.filter(p => p.gender === '여').length}명
                                    </p>
                                    <p className="text-sm text-center text-yellow-400">
                                        추천 최소 점수: {recommendedMaleScore}점 (남) / {recommendedFemaleScore}점 (여)
                                    </p>
                                </div>
                                
                                <p className="font-semibold text-center">최종 최소 점수 (수동 조정)</p>
                                <div className="flex justify-around gap-4">
                                    <div className="flex-1 text-center">
                                        <label className="block mb-1">👨 남자 최소 점수</label>
                                        <input type="number" name="minMaleScore" value={autoMatchConfig.minMaleScore} onChange={handleAutoMatchConfigChange} className="w-full bg-gray-600 p-2 rounded-lg text-center" placeholder={recommendedMaleScore} />
                                    </div>
                                    <div className="flex-1 text-center">
                                        <label className="block mb-1">👩 여자 최소 점수</label>
                                        <input type="number" name="minFemaleScore" value={autoMatchConfig.minFemaleScore} onChange={handleAutoMatchConfigChange} className="w-full bg-gray-600 p-2 rounded-lg text-center" placeholder={recommendedFemaleScore} />
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500 text-center">
                                    점수가 높을수록 '좋은 조합'을 엄격하게 찾습니다 (매칭 속도 느려짐).<br/>
                                    점수가 낮을수록 '경기 수'만 보고 빠르게 매칭합니다.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* --- 일반 설정 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg">
                        <span className="font-semibold mb-2 block text-center">일반 설정</span>
                        <div className="flex items-center justify-around">
                            <div className="text-center">
                                <p>수동 예정</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => setScheduled(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                                    <span className="text-xl font-bold w-8 text-center">{scheduled}</span>
                                    <button onClick={() => setScheduled(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                                </div>
                            </div>
                            <div className="text-center">
                                <p>전체 코트</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => setCourts(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                                    <span className="text-xl font-bold w-8 text-center">{courts}</span>
                                    <button onClick={() => setCourts(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-700 p-3 rounded-lg">
                        <label className="font-semibold mb-2 block">시즌 공지사항</label>
                        <textarea value={announcement} onChange={(e) => setAnnouncement(e.target.value)} rows="3" className="w-full bg-gray-600 text-white p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-400"></textarea>
                    </div>
                     <div className="bg-gray-700 p-3 rounded-lg">
                        <label className="font-semibold mb-2 block">점수 획득 설명</label>
                        <textarea value={pointSystemInfo} onChange={(e) => setPointSystemInfo(e.target.value)} rows="5" className="w-full bg-gray-600 text-white p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-400"></textarea>
                    </div>
                    
                    {/* --- 고급 기능 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-2">
                        <label className="font-semibold mb-2 block text-center">고급 기능</label>
                        <button 
                            onClick={() => handleTest('testDailyBatch', '일일 정산 테스트', '현재 선수들의 "오늘" 기록을 "이번달" 기록에 합산하고 초기화하는 일일 정산 작업을 테스트합니다. 실행하시겠습니까?')}
                            disabled={isTesting} 
                            className="w-full arcade-button bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 rounded-lg disabled:opacity-50"
                        >
                            {isTesting ? '테스트 중...' : '일일 정산 테스트'}
                        </button>
                        <button 
                            onClick={() => handleTest('testMonthlyArchive', '월간 랭킹 저장 테스트', '현재 랭킹을 기준으로 "지난달" 랭킹 저장 및 알림 기능을 테스트합니다. 실제 데이터가 생성됩니다. 실행하시겠습니까?')}
                            disabled={isTesting} 
                            className="w-full arcade-button bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg disabled:opacity-50"
                        >
                            {isTesting ? '테스트 중...' : '월간 랭킹 저장 테스트'}
                        </button>
                         <button
                            onClick={onSystemReset}
                            disabled={isTesting}
                            className="w-full arcade-button bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg disabled:opacity-50"
                        >
                            시스템 초기화
                        </button>
                    </div>
                </div>
                <div className="mt-6 flex gap-4 flex-shrink-0">
                     <button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 font-bold py-2 rounded-lg">취소</button>
                    <button onClick={handleSave} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg">저장</button>
                </div>
            </div>
        </div>
    );
}

function ConfirmationModal({ title, body, onConfirm, onCancel }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-white mb-4">{title}</h3><p className="text-gray-300 mb-6">{body}</p><div className="flex gap-4"><button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button><button onClick={onConfirm} className="w-full arcade-button bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg transition-colors">확인</button></div></div></div>); }

function CourtSelectionModal({ courts, onSelect, onCancel }) {
    const [isProcessing, setIsProcessing] = useState(false);

    return ( 
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font">코트 선택</h3>
                <p className="text-gray-300 mb-6">경기를 시작할 코트를 선택해주세요.</p>
                <div className="flex flex-col gap-3">
                    {courts.map(courtIdx => ( 
                        <button 
                            key={courtIdx} 
                            onClick={() => {
                                setIsProcessing(true);
                                onSelect(courtIdx);
                            }} 
                            className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
                            disabled={isProcessing}
                        >
                            {isProcessing ? '처리 중...' : `${courtIdx + 1}번 코트`}
                        </button> 
                    ))}
                </div>
                <button 
                    onClick={onCancel} 
                    className="mt-6 w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors"
                    disabled={isProcessing}
                >
                    취소
                </button>
            </div>
        </div> 
    ); 
}

function AlertModal({ title, body, onClose }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-yellow-400 mb-4">{title}</h3><p className="text-gray-300 mb-6">{body}</p><button onClick={onClose} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors">확인</button></div></div> ); }

function RankingHistoryModal({ onCancel }) {
    const [availableMonths, setAvailableMonths] = useState([]);
    const [selectedMonth, setSelectedMonth] = useState('');
    const [rankingData, setRankingData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchMonths = async () => {
            const querySnapshot = await getDocs(query(monthlyRankingsRef));
            const months = querySnapshot.docs.map(doc => doc.id).sort((a, b) => b.localeCompare(a));
            setAvailableMonths(months);
            setIsLoading(false);
        };
        fetchMonths();
    }, []);

    useEffect(() => {
        if (!selectedMonth) return;
        
        const fetchRanking = async () => {
            setIsLoading(true);
            const docRef = doc(monthlyRankingsRef, selectedMonth);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setRankingData(docSnap.data().ranking);
            } else {
                setRankingData([]);
            }
            setIsLoading(false);
        };
        fetchRanking();
    }, [selectedMonth]);
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg text-white shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-yellow-400 arcade-font">랭킹 기록</h3>
            <button onClick={onCancel} className="text-2xl text-gray-500 hover:text-white">&times;</button>
          </div>

          <div className="mb-4">
            <select 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full p-2 bg-gray-700 rounded-md arcade-button"
            >
              <option value="">월 선택...</option>
              {availableMonths.map(month => <option key={month} value={month}>{month}</option>)}
            </select>
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <p>로딩 중...</p>
            ) : rankingData.length > 0 ? (
               <table className="w-full text-sm text-left text-gray-300">
                    <thead className="text-xs text-yellow-400 uppercase bg-gray-700/50 sticky top-0">
                        <tr>
                            <th scope="col" className="px-4 py-3 text-center arcade-font">RANK</th>
                            <th scope="col" className="px-6 py-3 arcade-font">NAME</th>
                            <th scope="col" className="px-6 py-3 text-center arcade-font">RP</th>
                            <th scope="col" className="px-6 py-3 text-center arcade-font">W/L</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rankingData.map(p => (
                            <tr key={p.id} className="border-b border-gray-700">
                                <td className="px-4 py-3 font-bold text-center arcade-font">{p.rank}</td>
                                <td className="px-6 py-3 font-bold whitespace-nowrap">{p.name}</td>
                                <td className="px-6 py-3 text-center font-bold text-green-400">{p.rp || 0}</td>
                                <td className="px-6 py-3 text-center">{p.wins || 0}승 {p.losses || 0}패</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : selectedMonth && (
              <p>{selectedMonth}의 랭킹 데이터가 없습니다.</p>
            )}
          </div>
        </div>
      </div>
    );
}

// [자동매칭] 이 모달은 더 이상 사용되지 않습니다.
/*
function AutoMatchSetupModal({ onConfirm, onCancel }) {
    ...
}
*/
