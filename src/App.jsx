import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
    getFirestore, doc, getDoc, setDoc, onSnapshot,
    collection, deleteDoc, updateDoc, writeBatch, runTransaction,
    query, getDocs, where,
    enableIndexedDbPersistence
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from "firebase/functions";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"; // Storage 임포트 추가
import { getMessaging, getToken, onMessage } from "firebase/messaging"; // FCM 푸시 알림 기능 추가
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
  appId: "1:384562806148:web:d8bfb83b28928c13e671d1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app); // Storage 초기화

// FCM 푸시 알림 객체 초기화 (브라우저가 지원하는 경우에만)
let messaging = null;
if (typeof window !== "undefined" && "Notification" in window) {
    try {
        messaging = getMessaging(app);
    } catch (e) {
        console.log("FCM 초기화 에러:", e);
    }
}

// ============ [4번 전략 적용] 오프라인 지속성 활성화 ============
// db 객체를 만든 직후, 다른 Firestore 작업을 하기 전에 호출합니다.
try {
  enableIndexedDbPersistence(db)
    .then(() => {
      // 개발자 도구(F12) 콘솔에서 성공 여부를 확인할 수 있습니다.
      console.log("Firestore 오프라인 지속성 활성화 성공");
    })
    .catch((err) => {
      // 여러 브라우저 탭에 앱이 동시에 열려있으면 실패할 수 있습니다. (정상)
      if (err.code == 'failed-precondition') {
        console.warn("Firestore: 여러 탭이 열려 있어 오프라인 지속성을 활성화할 수 없습니다.");
      } else if (err.code == 'unimplemented') {
        console.warn("Firestore: 현재 브라우저가 오프라인 지속성을 지원하지 않습니다.");
      }
    });
} catch (err) {
  console.error("Firestore 오프라인 지속성 설정 오류:", err);
}
// ==========================================================

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
            // [자동매칭] 기본 설정값 추가 (수정됨: 코트 수 제거)
            autoMatchConfig: {
                isEnabled: false,
                minMaleScore: 75,
                minFemaleScore: 100
            }
        };
    }
    // [자동매칭] 기존 설정에 autoMatchConfig가 없으면 기본값 병합 (수정됨: 코트 수 제거)
if (seasonConfigData && !seasonConfigData.autoMatchConfig) {
    seasonConfigData.autoMatchConfig = {
        isEnabled: false,
        minMaleScore: 75,
        minFemaleScore: 100,
        isManualConfig: false // [수정] 수동 설정 플래그 기본값
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
const ADMIN_NAMES = ["나채빈", "정형진", "윤지혜", "이상민", "이정문", "오미리"];
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
        const playerNameClass = `player-name text-xs font-semibold whitespace-nowrap leading-tight`;
    const playerInfoClass = `player-info text-[10px] leading-tight mt-0.5 whitespace-nowrap flex items-center gap-1`;

    const getLevelBadgeClass = (level, isGuest) => {
        if (isGuest) return 'badge-G';
        switch(level) {
            case 'A조': return 'badge-A';
            case 'B조': return 'badge-B';
            case 'C조': return 'badge-C';
            case 'D조': return 'badge-D';
            default:    return 'badge-N';
        }
    };

    const levelColor = getLevelColor(player.level, player.isGuest);
    const levelStyle = { color: levelColor, fontWeight: '700', fontSize: '11px' };

    const cardStyle = {
        ...genderStyle,
        borderWidth: '1px',
               borderStyle: 'solid',
        borderColor: 'transparent',
        transition: 'all 0.2s ease-in-out',
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
    // [수정] actionLabel이 'auto' 위치도 인식하도록 수정
    const actionLabel = (isWaiting || context.location === 'auto') ? '선수 내보내기' : '대기자로 이동';

    return (
                <div
            ref={cardRef}
            className={`player-card p-1.5 relative flex flex-col justify-center text-center h-14 w-full ${player.isResting ? 'opacity-40' : ''}`}
            style={cardStyle}
            onClick={isMovable && onCardClick ? () => onCardClick() : null}
            onMouseDown={isAdmin && isMovable && !isLongPressDisabled ? handlePressStart : null}
            onMouseUp={isAdmin && isMovable && !isLongPressDisabled ? handlePressEnd : null}
            onMouseLeave={isAdmin && isMovable && !isLongPressDisabled ? handlePressEnd : null}
            onContextMenu={handleContextMenu}
        >
            <div>
                <div className={playerNameClass} style={{color: 'var(--text1)'}}>{adminIcon}{player.name}</div>
                <div className={playerInfoClass}>
                    <span style={levelStyle}>{player.level.replace('조','')}</span>
                    <span className="font-semibold" style={{color: 'var(--text3)', fontSize: '10px'}}>{player.todayRecentGames ? player.todayRecentGames.length : 0}G</span>
                </div>
            </div>
            {isAdmin && onAction && (
                <button
                    onClick={(e) => { e.stopPropagation(); onAction(player); }}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-white"
                    style={{background: 'var(--border)', fontSize: '9px'}}
                    aria-label={actionLabel}
                ><i className="fas fa-times"></i></button>
            )}
        </div>
    );
});
const EmptySlot = ({ onSlotClick }) => (
    <div
        className="player-slot h-14 flex items-center justify-center cursor-pointer"
        onClick={onSlotClick}
    >
        <span className="text-lg font-light" style={{color: 'var(--text3)'}}>+</span>
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
               <section className="section-card">
            <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{background: 'var(--amber)'}}></div>
                    <h2 className="text-sm font-bold" style={{color: 'var(--text1)'}}>
                        대기 명단
                        <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{background: 'var(--surface2)', color: 'var(--text2)'}}>{totalWaiting}</span>
                    </h2>
                </div>
                {isAdmin && totalWaiting > 0 && (
                    <button
                        onClick={onClearAllWaitingPlayers}
                        className="text-xs font-semibold px-2 py-1 rounded-md"
                        style={{background: 'rgba(239,68,68,0.1)', color: '#EF4444'}}
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
              <section className="section-card">
            <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{background: '#2563EB'}}></div>
                    <h2 className="text-sm font-bold" style={{color: 'var(--text1)'}}>경기 예정</h2>
                </div>
                {isAdmin && hasMatches && (
                    <button onClick={handleClearScheduledMatches} className="text-xs font-semibold px-2 py-1 rounded-md" style={{background: 'rgba(239,68,68,0.1)', color: '#EF4444'}}>전체삭제</button>
                )}
            </div>
            <div id="scheduled-matches" className="flex flex-col gap-2">
                {Array.from({ length: numScheduledMatches }).map((_, matchIndex) => {
                    const match = scheduledMatches[String(matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                    const playerCount = match.filter(p => p).length;
                    return (
                        <div key={`schedule-${matchIndex}`} className="match-row flex items-center w-full gap-2">
                            <div
                                className="flex-shrink-0 w-7 text-center cursor-pointer flex items-center justify-center"
                                onMouseDown={() => handlePressStart(matchIndex)}
                                onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
                                onTouchStart={() => handlePressStart(matchIndex)}
                                onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
                            >
                                <p className="font-bold text-base" style={{color: 'var(--text2)'}}>{matchIndex + 1}</p>
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
                                <button
                                    className={`w-full py-1.5 px-1 rounded-lg font-bold text-[10px] transition-all ${playerCount === PLAYERS_PER_MATCH && isAdmin ? 'btn-primary' : ''}`}
                                    style={!(playerCount === PLAYERS_PER_MATCH && isAdmin) ? {background: 'var(--surface2)', color: 'var(--text3)', cursor: 'not-allowed'} : {}}
                                    disabled={playerCount !== PLAYERS_PER_MATCH || !isAdmin}
                                    onClick={() => handleStartMatch(matchIndex, 'schedule')}
                                >START</button>
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
               <section className="section-card">
            <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{background: '#10B981'}}></div>
                    <h2 className="text-sm font-bold" style={{color: 'var(--text1)'}}>
                        자동 매칭
                        <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full" style={isAutoMatchOn ? {background: 'rgba(16,185,129,0.15)', color: '#10B981'} : {background: 'var(--surface2)', color: 'var(--text3)'}}>
                            {isAutoMatchOn ? 'ON' : 'OFF'}
                        </span>
                    </h2>
                </div>
                {isAdmin && matchList.length > 0 && (
                    <button onClick={handleClearAutoMatches} className="text-xs font-semibold px-2 py-1 rounded-md" style={{background: 'rgba(239,68,68,0.1)', color: '#EF4444'}}>전체삭제</button>
                )}
            </div>
            {isAutoMatchOn && matchList.length === 0 && (
                <div className="text-center p-4 rounded-xl" style={{background: 'var(--surface2)', color: 'var(--text2)'}}>
                    <p className="text-sm">자동 매칭 대기 중...</p>
                    <p className="text-xs mt-1" style={{color: 'var(--text3)'}}>대기 선수가 4명 이상이고 좋은 조합이 발견되면 자동 생성됩니다.</p>
                </div>
            )}
            <div id="auto-matches" className="flex flex-col gap-2">
                {matchList.map(([matchIndex, match]) => {
                    const playerCount = match.filter(p => p).length;
                    return (
                        <div key={`auto-match-${matchIndex}`} className="match-row flex items-center w-full gap-2">
                            <div
                                className="flex-shrink-0 w-7 text-center cursor-pointer flex items-center justify-center"
                                onMouseDown={() => handlePressStart(matchIndex)}
                                onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
                                onTouchStart={() => handlePressStart(matchIndex)}
                                onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
                            >
                                <p className="font-bold text-base" style={{color: 'var(--text2)'}}>{parseInt(matchIndex, 10) + 1}</p>
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
                                <button
                                    className={`w-full py-1.5 px-1 rounded-lg font-bold text-[10px] transition-all ${playerCount === 4 && isAdmin ? 'btn-primary' : ''}`}
                                    style={!(playerCount === 4 && isAdmin) ? {background: 'var(--surface2)', color: 'var(--text3)', cursor: 'not-allowed'} : {}}
                                    disabled={playerCount !== 4 || !isAdmin}
                                    onClick={() => handleStartAutoMatch(matchIndex, 'auto')}
                                >START</button>
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
       const courtContainerClass = `match-row flex items-center w-full gap-2 transition-all duration-200 ${isSource ? 'ring-2 ring-blue-500 scale-[1.02]' : ''} ${isAdmin ? 'cursor-pointer' : ''}`;

    return (
        <div ref={courtRef} className={courtContainerClass} onClick={handleClick}>
            <div className="flex-shrink-0 w-7 flex flex-col items-center justify-center">
                <p className="font-bold text-base" style={{color: court ? '#EF4444' : 'var(--text3)'}}>{courtIndex + 1}</p>
                <p className="text-[9px] font-medium" style={{color: 'var(--text3)'}}>코트</p>
            </div>
            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                {(court?.players || Array(PLAYERS_PER_MATCH).fill(null)).map((playerId, slotIndex) => {
                    const player = players[playerId];
                    return player ? ( <PlayerCard key={playerId} player={player} context={{ location: 'court', matchIndex: courtIndex }} isAdmin={isAdmin} isCurrentUser={currentUser && player.id === currentUser.id} isMovable={false} /> ) : ( <EmptySlot key={`court-empty-${courtIndex}-${slotIndex}`} /> )
                })}
            </div>
            <div className="flex-shrink-0 w-14 text-center">
                <button
                    className={`w-full py-1.5 px-1 rounded-lg font-bold text-[10px] transition-all ${court && isAdmin ? 'btn-danger' : ''}`}
                    style={!(court && isAdmin) ? {background: 'var(--surface2)', color: 'var(--text3)', cursor: 'not-allowed'} : {}}
                    disabled={!court || !isAdmin}
                    onClick={(e) => { e.stopPropagation(); handleEndMatch(courtIndex); }}
                >END</button>
                <CourtTimer court={court} />
            </div>
        </div>
    );
});


const InProgressCourtsSection = React.memo(({ numInProgressCourts, inProgressCourts, players, isAdmin, handleEndMatch, currentUser, courtMove, setCourtMove, handleMoveOrSwapCourt }) => {
       return (
        <section className="section-card">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full" style={{background: '#EF4444'}}></div>
                <h2 className="text-sm font-bold" style={{color: 'var(--text1)'}}>경기 진행</h2>
            </div>
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

    const [isDarkMode, setIsDarkMode] = useState(() => {
        return localStorage.getItem('badminton-theme') !== 'light';
    });
    const toggleTheme = useCallback(() => {
        setIsDarkMode(prev => {
            const next = !prev;
            localStorage.setItem('badminton-theme', next ? 'dark' : 'light');
            return next;
        });
    }, []);

    // --- [알림 권한 및 유도 모달 상태] ---
    const [notiPermission, setNotiPermission] = useState(
        typeof window !== "undefined" && "Notification" in window ? Notification.permission : 'default'
    );
    const [showNotiIntroModal, setShowNotiIntroModal] = useState(false);

    // --- [앱 설치 및 인앱 브라우저 감지 상태] ---
    const [isInAppBrowser, setIsInAppBrowser] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showInstallBanner, setShowInstallBanner] = useState(false);

   useEffect(() => {
        // 1. 인앱 브라우저 감지 (카카오톡, 라인, 인스타그램 등)
        const userAgent = navigator.userAgent.toLowerCase();
        const inAppKeywords = ['kakao', 'line', 'instagram', 'naver', 'everytime'];
        const isIab = inAppKeywords.some(keyword => userAgent.includes(keyword));
        setIsInAppBrowser(isIab);

        // 2. PWA 앱 설치 이벤트 감지 (안드로이드/데스크탑 크롬)
        const handleBeforeInstallPrompt = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setShowInstallBanner(true);
        };
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // 3. iOS Safari PWA 설치 유도 (beforeinstallprompt가 작동안함)
        const isIos = /iphone|ipad|ipod/.test(userAgent);
        const isSafari = /safari/.test(userAgent) && !/chrome|crios|crmo/.test(userAgent);
        const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
        
        if (isIos && isSafari && !isStandalone) {
            setShowInstallBanner(true); // iOS 사용자에게도 배너 표시
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstallClick = async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                setShowInstallBanner(false);
            }
            setDeferredPrompt(null);
        }
    };
    // ----------------------------------------
    const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);
   const [modal, setModal] = useState({ type: null, data: null });
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [courtMove, setCourtMove] = useState({ sourceIndex: null });
    const [selectedAutoMatchSlot, setSelectedAutoMatchSlot] = useState(null);
    const [isSeasonModalDismissed, setIsSeasonModalDismissed] = useState(false); // 세션 내 공지 닫기 상태 추가

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

    // [수정] waitingPlayers (대기 선수) 정의 변경
    // 휴식 중인 선수도 UI에 표시하기 위해 `!p.isResting` 필터 제거
    // 자동 매칭 풀(Pool)에서는 `runMatchScheduler` 내부에서 휴식 선수를 필터링함
    const waitingPlayers = useMemo(() => Object.values(activePlayers)
        .filter(p => playerLocations[p.id]?.location === 'waiting') // [수정] 휴식 중인 선수도 UI에 표시
        .sort((a, b) => {
            // [수정] 휴식 중인 선수는 항상 맨 뒤로
            if (a.isResting !== b.isResting) {
                return a.isResting ? 1 : -1;
            }
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

        // [푸시 알림] 앱이 켜져 있을 때 (Foreground) 알림을 받았을 경우 처리
        let unsubscribeMessaging = null;
        if (messaging) {
            unsubscribeMessaging = onMessage(messaging, (payload) => {
                const title = payload.notification?.title || payload.data?.title || '새로운 알림';
                const body = payload.notification?.body || payload.data?.body || '코트로 이동해주세요!';

                if (Notification.permission === 'granted') {
                    new Notification(title, {
                        body: body,
                        icon: '/pwa-192x192.png'
                    });
                }
                // [수정] 포그라운드 자체 팝업 알림 및 진동 추가 (선수가 앱을 보고 있을 때 알림을 놓치지 않게 함)
                if (navigator.vibrate) {
                    navigator.vibrate([200, 100, 200, 100, 200]); // 징-징-징 강한 진동
                }
                setModal({ 
                    type: 'alert', 
                    data: { 
                        title: title, 
                        body: body 
                    }
                });
            });
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            if (unsubscribeMessaging) unsubscribeMessaging();
        };
    }, []);

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
        // [개선] 데이터 로딩 완료 시 이미지 미리 불러오기 (Pre-loading)
        if (!isLoading && seasonConfig?.announcementType === 'photo' && seasonConfig?.announcementPhotoUrl) {
            const img = new Image();
            img.src = seasonConfig.announcementPhotoUrl;
        }

       // 이전 답변에서 드린 닫기 오류 해결 로직 포함 (isSeasonModalDismissed)
        if (isLoading || !seasonConfig || (modal && modal.type) || isSeasonModalDismissed) return;
        
        // [추가] 공지사항 타입이 '없음(none)'일 경우 모달을 띄우지 않고 바로 통과
        if (seasonConfig.announcementType === 'none') return;
        
        const today = new Date().toDateString();
        const lastSeen = localStorage.getItem(`seen-${seasonConfig.seasonId}`);
        if (lastSeen !== today) {
            setModal({ type: 'season', data: seasonConfig });
        }
    }, [isLoading, seasonConfig, isSeasonModalDismissed, modal]);

    // [알림 권한] 커스텀 모달에서 "허용하기" 클릭 시 호출되는 함수
    const requestNotificationPermission = useCallback(async () => {
        if (!messaging) return;
        try {
            const permission = await Notification.requestPermission();
            setNotiPermission(permission);
            setShowNotiIntroModal(false);

            if (permission === 'granted' && currentUser) {
                const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
                const currentToken = await getToken(messaging, {
                    vapidKey: "BBRzbDzqqTxY6ZqJsDddwYoGZlWyosWf0Lx9-vA4kXLdFzqb5gHJTymRzk5bIX0dnVDTH_aVOYTiXXiXiB2ijkY",
                    serviceWorkerRegistration: registration
                });
                if (currentToken) {
                    const playerDocRef = doc(playersRef, currentUser.id);
                    const playerDoc = await getDoc(playerDocRef);
                    if (playerDoc.exists()) {
                        const playerData = playerDoc.data();
                        const currentTokens = playerData.fcmTokens || [];
                        if (!currentTokens.includes(currentToken)) {
                            await updateDoc(playerDocRef, { fcmTokens: [...currentTokens, currentToken] });
                        }
                    }
                }
            } else if (permission === 'denied') {
                alert("알림이 차단되었습니다. 브라우저 설정에서 알림 권한을 허용해주세요.");
            }
        } catch (error) {
            console.error("FCM 권한 요청 오류:", error);
            setShowNotiIntroModal(false);
        }
    }, [currentUser]);

    // 권한 체크 및 접속 시마다 백그라운드에서 자동으로 토큰을 갱신/유지하는 로직
    useEffect(() => {
        const checkAndSaveToken = async () => {
            if (currentUser && "Notification" in window) {
                if (Notification.permission === 'default') {
                    setShowNotiIntroModal(true);
                } else {
                    setNotiPermission(Notification.permission);
                    if (Notification.permission === 'granted' && messaging) {
                        try {
                            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
                            const currentToken = await getToken(messaging, {
                                vapidKey: "BBRzbDzqqTxY6ZqJsDddwYoGZlWyosWf0Lx9-vA4kXLdFzqb5gHJTymRzk5bIX0dnVDTH_aVOYTiXXiXiB2ijkY",
                                serviceWorkerRegistration: registration
                            });
                            if (currentToken) {
                                const playerDocRef = doc(playersRef, currentUser.id);
                                const playerDoc = await getDoc(playerDocRef);
                                if (playerDoc.exists()) {
                                    const playerData = playerDoc.data();
                                    const currentTokens = playerData.fcmTokens || [];
                                    if (!currentTokens.includes(currentToken)) {
                                        await updateDoc(playerDocRef, { fcmTokens: [...currentTokens, currentToken] });
                                    }
                                }
                            }
                        } catch (error) {
                            console.error("자동 토큰 갱신 에러:", error);
                        }
                    }
                }
            }
        };
        checkAndSaveToken();
    }, [currentUser]);

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
    }, [waitingPlayers]); // [수정] waitingPlayers가 휴식 선수를 포함하므로 올바르게 동작

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
                                                           todayRecentGames: filterTodayGames(existingData.todayRecentGames),
                    isResting: existingData.isResting || false, // 입장 시 isResting 초기화 안함
                };
            } else {
                playerData = {
                    id, name, level, gender, isGuest,
                    entryTime: new Date().toISOString(), isResting: false,
                    status: 'active',
                    todayRecentGames: [],
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
                    // 1. 현재 이 선수가 '경기 진행(Court)' 중인지 확인합니다.
                    const isPlaying = inProgressPlayerIds.has(currentUser.id);

                    const updateFunction = (currentState) => {
                        const newState = JSON.parse(JSON.stringify(currentState));
                        const playerId = currentUser.id;

                        // (1) 대기 예정(Schedule)에서는 무조건 지웁니다.
                        Object.keys(newState.scheduledMatches).forEach(matchKey => {
                            const match = newState.scheduledMatches[matchKey];
                            if(match) {
                                const playerIndex = match.indexOf(playerId);
                                if (playerIndex > -1) match[playerIndex] = null;
                            }
                        });

                        // (2) 자동 매칭(Auto)에서도 무조건 지웁니다.
                        Object.keys(newState.autoMatches).forEach(matchKey => {
                            const match = newState.autoMatches[matchKey];
                            if(match) {
                                const playerIndex = match.indexOf(playerId);
                                if (playerIndex > -1) match[playerIndex] = null;
                            }
                        });

                        // (3) [핵심 변경] 경기 진행(Court) 중이라면, 코트에서 지우지 않고 그대로 둡니다!
                        // 경기 중이 아닐 때만 코트 데이터를 비웁니다.
                        if (!isPlaying) {
                            newState.inProgressCourts.forEach((court, courtIndex) => {
                                if (court?.players) {
                                    const playerIndex = court.players.indexOf(playerId);
                                    if (playerIndex > -1) court.players[playerIndex] = null;
                                    if (court.players.every(p => p === null)) newState.inProgressCourts[courtIndex] = null;
                                }
                            });
                        }
                        return { newState };
                    };
                    await updateGameState(updateFunction);

                    // 2. 상태 업데이트 분기 처리
                    if (isPlaying) {
                        // [핵심] 경기 중이라면 'inactive'로 만들지 않고, 'isResting(휴식)' 상태로 만듭니다.
                        // 이렇게 하면 카드가 회색으로 변한 채로 코트에 남아있게 되어, 관리자가 경기를 종료할 수 있습니다.
                        await updateDoc(doc(playersRef, currentUser.id), { isResting: true });
                    } else {
                        // 경기 중이 아니라면 아예 명단에서 뺍니다.
                        await updateDoc(doc(playersRef, currentUser.id), { status: 'inactive' });
                    }

                    localStorage.removeItem('badminton-currentUser-id');
                    setCurrentUser(null);
                    setModal({ type: null, data: null });
                } catch (error) {
                    console.error(error);
                    setModal({ type: 'alert', data: { title: '오류', body: '나가는 도중 문제가 발생했습니다.' }});
                }
            }
        }});
    }, [currentUser, updateGameState, inProgressPlayerIds]); // [중요] inProgressPlayerIds 추가됨

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
                // [자동매칭] 'schedule' 또는 'auto' 위치에서만 이 로직 실행
                if (context.location !== 'schedule' && context.location !== 'auto') return { newState };

                const playersToMove = [...selectedPlayerIds];
                let targetArray;

                if(context.location === 'schedule') {
                    targetArray = newState.scheduledMatches[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                } else {
                    targetArray = newState.autoMatches[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                }

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

                if(context.location === 'schedule') {
                    newState.scheduledMatches[String(context.matchIndex)] = targetArray;
                } else {
                    newState.autoMatches[String(context.matchIndex)] = targetArray;
                }

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
        
        // [추가] 관리자가 수동으로 대기 1번(인덱스 0)에 선수 4명을 꽉 채웠다면 대기 알림 발송
        if (context.matchIndex === 0) {
            setTimeout(async () => {
                try {
                    const liveDoc = await getDoc(doc(db, "gameState", "live"));
                    if (liveDoc.exists()) {
                        const updatedGameState = liveDoc.data();
                        const checkMatch = context.location === 'schedule' 
                            ? updatedGameState.scheduledMatches['0'] 
                            : updatedGameState.autoMatches['0'];
                        
                        if (checkMatch && checkMatch.filter(p => p).length === PLAYERS_PER_MATCH) {
                            const sendWaitingNotification = httpsCallable(functions, 'sendWaitingNotification');
                            await sendWaitingNotification({
                                playerIds: checkMatch,
                                matchType: context.location
                            });
                        }
                    }
                } catch (error) {
                    console.error("대기 1번 알림 확인 중 오류:", error);
                }
            }, 1500); // DB 확실한 동기화를 위해 1.5초 지연 및 직접 확인
        }

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
            
            // [푸시 알림] 서버(Cloud Functions)로 경기 시작 알림 발송 요청
            const playersToNotify = matchType === 'schedule' 
                ? gameState.scheduledMatches[String(matchIndex)] 
                : gameState.autoMatches[String(matchIndex)];
                
            if (playersToNotify && playersToNotify.length > 0) {
                try {
                    const sendMatchNotification = httpsCallable(functions, 'sendMatchNotification');
                    sendMatchNotification({
                        playerIds: playersToNotify,
                        courtIndex: courtIndex
                    }).catch(err => console.log("푸시 알림 함수 호출 실패:", err));
                } catch (error) {
                    console.error(error);
                }
            }

            // [추가] 앞 경기가 시작되어 새로운 팀이 대기 1번(인덱스 0)으로 올라왔다면 대기 알림 발송
            setTimeout(async () => {
                try {
                    const liveDoc = await getDoc(doc(db, "gameState", "live"));
                    if (liveDoc.exists()) {
                        const updatedGameState = liveDoc.data();
                        const nextMatch = matchType === 'schedule' 
                            ? updatedGameState.scheduledMatches['0'] 
                            : updatedGameState.autoMatches['0'];
                            
                        if (nextMatch && nextMatch.filter(p => p).length === PLAYERS_PER_MATCH) {
                            const sendWaitingNotification = httpsCallable(functions, 'sendWaitingNotification');
                            await sendWaitingNotification({
                                playerIds: nextMatch,
                                matchType: matchType
                            });
                        }
                    }
                } catch (error) {
                    console.error("대기 1번 알림 확인 중 오류:", error);
                }
            }, 1500); // DB 확실한 동기화를 위해 1.5초 지연 및 직접 확인

           setModal({type: null, data: null});
        };
        if (emptyCourts.length === 1) {
            start(emptyCourts[0]);
        } else {
            setModal({ type: 'courtSelection', data: { courts: emptyCourts, onSelect: start } });
        }
    }, [gameState, updateGameState, inProgressPlayerIds]);

   const handleEndMatch = useCallback(async (courtIndex) => {
        const court = gameState.inProgressCourts[courtIndex];
        if (!court || !court.players || court.players.some(p=>!p)) return;

        setModal({
            type: 'confirm',
            data: {
                title: '경기 종료',
                body: '경기를 종료하고 코트를 비우시겠습니까? (선수들의 매칭 히스토리가 기록됩니다.)',
                onConfirm: async () => {
                    setModal({ type: null, data: null }); // 로딩 및 중복 클릭 방지를 위해 모달 먼저 닫기
                    
                    try {
                        await runTransaction(db, async (transaction) => {
                            // 1. 최신 경기장 상태 가져오기
                            const gameStateDoc = await transaction.get(gameStateRef);
                            if (!gameStateDoc.exists()) throw new Error("게임 상태가 존재하지 않습니다.");
                            
                            const currentState = gameStateDoc.data();
                            const currentCourt = currentState.inProgressCourts[courtIndex];
                            
                            // 2. 여러 관리자가 동시에 누른 경우, 이미 코트가 비워져있다면 중복 처리 방지
                            if (!currentCourt || !currentCourt.players || currentCourt.players.some(p => !p)) {
                                return; // 이미 다른 관리자에 의해 종료됨
                            }

                            const allMatchPlayerIds = currentCourt.players;
                            const now = new Date().toISOString();

                            const teamA = [allMatchPlayerIds[0], allMatchPlayerIds[1]].filter(Boolean);
                            const teamB = [allMatchPlayerIds[2], allMatchPlayerIds[3]].filter(Boolean);

                            // 3. 최신 선수 데이터 가져오기 (동시성 보장)
                            const playerRefs = allMatchPlayerIds.map(pId => doc(playersRef, pId));
                            const playerDocs = await Promise.all(playerRefs.map(ref => transaction.get(ref)));

                            // 4. 선수별 히스토리 업데이트
                            playerDocs.forEach((pDoc) => {
                                if (!pDoc.exists()) return;
                                const pId = pDoc.id;
                                const pData = pDoc.data();

                                let partners = [];
                                let opponents = [];

                                if (teamA.includes(pId)) {
                                    partners = teamA.filter(id => id !== pId);
                                    opponents = teamB;
                                } else if (teamB.includes(pId)) {
                                    partners = teamB.filter(id => id !== pId);
                                    opponents = teamA;
                                }

                                const gameRecord = {
                                    timestamp: now,
                                    partners: partners,
                                    opponents: opponents
                                };

                                const recentGames = (pData.todayRecentGames || []).slice(0, 9);
                                transaction.update(pDoc.ref, {
                                    todayRecentGames: [gameRecord, ...recentGames]
                                });
                            });

                            // 5. 코트 비우기
                            const newState = JSON.parse(JSON.stringify(currentState));
                            newState.inProgressCourts[courtIndex] = null;
                            transaction.set(gameStateRef, newState);
                        });
                    } catch(e) {
                        console.error(e);
                        setModal({ type: 'alert', data: { title: '오류', body: '결과 처리에 실패했습니다.' }});
                    }
                }
            }
        });
    }, [gameState, updateGameState]); // 트랜잭션 사용으로 allPlayers 의존성 제거됨

    // [자동 매칭] 스케줄러 실행 로직
    const runMatchScheduler = useCallback(async () => {
        // [수정] gameState가 null일 때를 대비
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

            // [수정] '휴식' 중이거나 이미 '자동 매칭' 목록에 있는 선수는 풀에서 제외
            const malePool = waitingPlayers.filter(p =>
                p.gender === '남' &&
                !autoMatchedPlayerIds.has(p.id) &&
                !p.isResting // <-- 휴식 선수 제외
            );
           const femalePool = waitingPlayers.filter(p =>
                p.gender === '여' &&
                !autoMatchedPlayerIds.has(p.id) &&
                !p.isResting // <-- 휴식 선수 제외
            );

            // [수정] 수동 모드가 아닐 경우 현재 인원수를 기준으로 자동 점수 계산 (게스트 포함)
            const activePlayersList = Object.values(allPlayers).filter(p => p.status === 'active' && !p.isResting);
            const maleCount = activePlayersList.filter(p => p.gender === '남').length;
            const femaleCount = activePlayersList.filter(p => p.gender === '여').length;

          const getDynamicMinScore = (totalPlayers) => {
                if (totalPlayers < 8) return -100;
                if (totalPlayers >= 8 && totalPlayers < 12) return 0;
                if (totalPlayers >= 12 && totalPlayers < 16) return 40;
                return 80;
            };

            const appliedMinMaleScore = config.isManualConfig ? config.minMaleScore : getDynamicMinScore(maleCount);
            const appliedMinFemaleScore = config.isManualConfig ? config.minFemaleScore : getDynamicMinScore(femaleCount);

            const bestMaleMatches = findBestMatches(malePool, allPlayers, appliedMinMaleScore);
            const bestFemaleMatches = findBestMatches(femalePool, allPlayers, appliedMinFemaleScore);

            const newMatches = [...bestMaleMatches, ...bestFemaleMatches];
          // App.jsx (수정된 버전)

            if (newMatches.length > 0) {
                // [추가] 기존에 자동매칭 목록이 비어있었는지 체크 (방금 대기 1번이 생성되었는지 확인용)
                const wasAutoMatchesEmpty = Object.keys(gameState.autoMatches || {}).length === 0;

                const updateFunction = (currentState) => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    
                    // [수정] 트랜잭션 내부에서 "현재 DB 상태"의 선수 목록을 다시 가져옵니다.
                    const currentAutoMatchedIds = new Set(
                        Object.values(newState.autoMatches || {}).flatMap(match => match)
                    );

                    let nextIndex = Object.keys(newState.autoMatches || {}).length;

                    for (const match of newMatches) {
                        // [수정] 이 매치에 포함된 선수가 방금 다른 트랜잭션에 의해 추가되었는지 확인
                        const hasPlayerAlreadyMatched = match.some(player => 
                            currentAutoMatchedIds.has(player.id)
                        );

                        // [수정] 이미 매칭된 선수가 없는 "깨끗한" 매치만 추가합니다.
                        if (!hasPlayerAlreadyMatched) {
                            newState.autoMatches[String(nextIndex)] = match.map(p => p.id); // Store IDs
                            nextIndex++;

                            // [수정] 방금 추가한 선수들도 Set에 반영하여, 
                            // (드물지만) newMatches 배열 내의 다음 매치에서도 중복되지 않도록 합니다.
                            match.forEach(p => currentAutoMatchedIds.add(p.id));
                        }
                   }
                    return { newState };
                };
                await updateGameState(updateFunction, "자동 매칭 생성에 실패했습니다.");

               // [추가] 자동매칭이 원래 0개였다가 방금 생성되었다면 대기 1번(인덱스 0) 알림 발송
                if (wasAutoMatchesEmpty) {
                    setTimeout(async () => {
                        try {
                            const liveDoc = await getDoc(doc(db, "gameState", "live"));
                            if (liveDoc.exists()) {
                                const updatedGameState = liveDoc.data();
                                if (updatedGameState && updatedGameState.autoMatches['0']) {
                                    const auto0 = updatedGameState.autoMatches['0'];
                                    if (auto0.filter(p => p).length === PLAYERS_PER_MATCH) {
                                        const sendWaitingNotification = httpsCallable(functions, 'sendWaitingNotification');
                                        await sendWaitingNotification({
                                            playerIds: auto0,
                                            matchType: 'auto'
                                        });
                                    }
                                }
                            }
                        } catch (error) {
                            console.error("대기 1번 알림 확인 중 오류:", error);
                        }
                    }, 1500); // DB 확실한 동기화를 위해 1.5초 지연 및 직접 확인
                }
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
                // [수정] 3초마다 스케줄러 실행
                schedulerIntervalRef.current = setInterval(runMatchScheduler, 3000);
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

   const handleSystemReset = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '모두 대기로 이동',
            body: '[경고] 진행/예정/자동매칭 경기가 모두 사라지고 방 안의 선수들이 모두 대기 명단으로 이동합니다. 선수 기록은 유지됩니다. 계속하시겠습니까?',
            onConfirm: async () => {
                const updateFunction = (currentState) => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    newState.scheduledMatches = {};
                    newState.inProgressCourts = Array(newState.numInProgressCourts).fill(null);
                    newState.autoMatches = {};
                    return { newState };
                };
                await updateGameState(updateFunction, '이동 처리에 실패했습니다.');
                setModal({ type: 'alert', data: { title: '완료', body: '모든 선수가 대기 명단으로 이동되었습니다.' }});
            }
        }});
    }, [updateGameState]);

    const handleClearPlayerHistory = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '선수 히스토리 삭제',
            body: '[경고] 현재 활성화된 모든 선수의 오늘 경기 기록(히스토리 및 게임 수)이 완전히 삭제됩니다. (매일 새벽 2시 자동 초기화 기능과 동일) 계속하시겠습니까?',
            onConfirm: async () => {
                try {
                    const batch = writeBatch(db);
                    Object.values(activePlayers).forEach(player => {
                        batch.update(doc(playersRef, player.id), {
                            todayWins: 0,
                            todayLosses: 0,
                            todayWinStreakCount: 0,
                            todayRecentGames: []
                        });
                    });
                    await batch.commit();
                    setModal({ type: 'alert', data: { title: '완료', body: '모든 선수의 히스토리가 초기화되었습니다.' }});
                } catch (error) {
                    console.error("히스토리 초기화 실패: ", error);
                    setModal({ type: 'alert', data: { title: '오류', body: '선수 히스토리 초기화 중 문제가 발생했습니다.' }});
                }
            }
        }});
    }, [activePlayers]);

    const handleAdminAddPlayer = useCallback(async (formData) => {
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
                                        todayRecentGames: filterTodayGames(existingData.todayRecentGames),
                    isResting: existingData.isResting || false,
                };
            } else {
                playerData = {
                    id, name, level, gender, isGuest,
                    entryTime: new Date().toISOString(), isResting: false,
                    status: 'active',
                    todayRecentGames: [],
                };
            }

            await setDoc(playerDocRef, playerData, { merge: true });
            setModal({ type: 'alert', data: { title: '추가 완료', body: `${name} 선수가 수동으로 추가되었습니다.` }});
        } catch (error) {
            console.error("Admin add player failed: ", error);
            setModal({ type: 'alert', data: { title: '오류', body: '선수 추가 처리 중 문제가 발생했습니다.' }});
        }
    }, []);

    const handleGenerateRobots = useCallback(async (maleCount, femaleCount) => {
        setModal({ type: 'alert', data: { title: '생성 중', body: '테스트 로봇을 생성하고 있습니다...' } });
        try {
            const batch = writeBatch(db);
            const now = new Date().toISOString();

            for (let i = 0; i < maleCount; i++) {
                const id = `Test_M_${Date.now()}_${i}`;
                const playerDocRef = doc(playersRef, id);
                batch.set(playerDocRef, {
                    id, name: `로봇남${i+1}`, level: 'C조', gender: '남', isGuest: true,
                    entryTime: now, isResting: false, status: 'active', todayRecentGames: []
                });
            }
            for (let i = 0; i < femaleCount; i++) {
                const id = `Test_F_${Date.now()}_${i}`;
                const playerDocRef = doc(playersRef, id);
                batch.set(playerDocRef, {
                    id, name: `로봇여${i+1}`, level: 'D조', gender: '여', isGuest: true,
                    entryTime: now, isResting: false, status: 'active', todayRecentGames: []
                });
            }
            await batch.commit();
            setModal({ type: 'alert', data: { title: '완료', body: `테스트 로봇 (남 ${maleCount}명, 여 ${femaleCount}명) 생성 완료!` }});
        } catch (error) {
            console.error("Robot generation failed: ", error);
            setModal({ type: 'alert', data: { title: '오류', body: '로봇 생성 중 문제가 발생했습니다.' }});
        }
    }, []);

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

    // [수정] handleSettingsUpdate를 App 컴포넌트 내부에서 정의 (SettingsModal로 props 전달)
  const handleSettingsUpdate = useCallback(async (settings) => {
        try {
            const { scheduled, courts, announcement, autoMatchConfig } = settings;
            // autoMatchConfig 내부에 포함된 announcementType과 photoFile 추출
            const { announcementType, photoFile } = autoMatchConfig;
            let finalPhotoUrl = seasonConfig.announcementPhotoUrl || "";

            // 사진 모드이고 새 파일이 업로드된 경우
            if (announcementType === 'photo' && photoFile instanceof File) {
                setModal({ type: 'alert', data: { title: '업로드 중', body: '사진을 업로드하고 있습니다...' } });
                
                if (finalPhotoUrl) {
                    try {
                        const oldStorageRef = ref(storage, 'announcements/season_image');
                        await deleteObject(oldStorageRef);
                    } catch (e) { console.log("기존 파일 삭제 스킵"); }
                }

                const storageRef = ref(storage, 'announcements/season_image');
                await uploadBytes(storageRef, photoFile);
                finalPhotoUrl = await getDownloadURL(storageRef);
            }

            await runTransaction(db, async (transaction) => {
                const currentGameStateDoc = await transaction.get(gameStateRef);
                if (!currentGameStateDoc.exists()) throw new Error("GameState document does not exist!");
                
                const currentGameState = currentGameStateDoc.data();
                const newGameState = { ...currentGameState, numScheduledMatches: scheduled, numInProgressCourts: courts };

                let currentCourts = newGameState.inProgressCourts || [];
                if (currentCourts.length > courts) {
                    newGameState.inProgressCourts = currentCourts.slice(0, courts);
                } else {
                    newGameState.inProgressCourts = [...currentCourts, ...Array(courts - currentCourts.length).fill(null)];
                }
                transaction.set(gameStateRef, newGameState);

              // Firestore에 저장하기 전, File 객체 필드를 확실히 제거
                const pureAutoMatchConfig = { ...autoMatchConfig };
                delete pureAutoMatchConfig.photoFile;
                // [수정] 객체 내부에도 정보를 기록하여 초기 로드 시 누락 방지
                pureAutoMatchConfig.announcementType = announcementType || 'text';
                pureAutoMatchConfig.announcementPhotoUrl = finalPhotoUrl;

               // [수정] pureAutoMatchConfig 내부에도 타입을 명시하여 설정 모달을 다시 열었을 때 초기값이 유지되도록 함
                pureAutoMatchConfig.announcementType = announcementType || 'text';
                pureAutoMatchConfig.announcementPhotoUrl = finalPhotoUrl;

                transaction.set(configRef, { 
                    announcement,
                    autoMatchConfig: pureAutoMatchConfig,
                    announcementType: announcementType || 'text', // 루트 레벨 저장
                    announcementPhotoUrl: finalPhotoUrl // 루트 레벨 저장
                }, { merge: true });
            });

            setIsSettingsOpen(false);
            setModal({ type: 'alert', data: { title: '저장 완료', body: '설정이 성공적으로 저장되었습니다.' } });
        } catch (error) {
            console.error("Settings save failed:", error);
            setModal({ type: 'alert', data: { title: '저장 실패', body: '설정 저장 중 오류가 발생했습니다.' } });
        }
    }, [seasonConfig, storage]);


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
        return (
            <div className={`${isDarkMode ? '' : 'light-mode'} min-h-screen flex items-center justify-center`} style={{background: 'var(--bg)'}}>
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{borderColor: 'var(--blue)', borderTopColor: 'transparent'}}></div>
                    <p className="text-sm font-semibold" style={{color: 'var(--text2)'}}>Loading...</p>
                </div>
            </div>
        );
    }

    // 인앱 브라우저 접속 시 강제 안내 화면 (외부 브라우저 유도)
       if (isInAppBrowser) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center" style={{background: 'var(--bg)'}}>
                <div className="w-full max-w-sm p-8 rounded-2xl" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
                    <div className="text-5xl mb-5">🚀</div>
                    <h2 className="text-lg font-bold mb-2" style={{color: 'var(--text1)'}}>전용 브라우저로 열어주세요</h2>
                    <p className="text-sm mb-6 leading-relaxed" style={{color: 'var(--text2)'}}>
                        카카오톡 내 브라우저에서는 실시간 매칭이 끊길 수 있어요.<br/>
                        아래 버튼을 눌러 외부 브라우저로 접속해주세요.
                    </p>
                    <button
                        onClick={() => {
                            const targetUrl = window.location.href;
                            if (navigator.userAgent.toLowerCase().includes('android') && navigator.userAgent.toLowerCase().includes('kakao')) {
                                window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(targetUrl)}`;
                            } else {
                                navigator.clipboard.writeText(targetUrl).then(() => {
                                    alert("링크가 복사되었습니다! 사파리(Safari)나 크롬(Chrome) 주소창에 붙여넣어주세요.");
                                });
                            }
                        }}
                        className="btn-primary w-full py-3 text-sm font-bold"
                    >
                        {navigator.userAgent.toLowerCase().includes('android') ? '외부 브라우저로 열기' : '링크 복사해서 열기'}
                    </button>
                    {!navigator.userAgent.toLowerCase().includes('android') && (
                        <p className="text-xs mt-4" style={{color: 'var(--text3)'}}>
                            우측 하단 [⋯] 버튼 → '다른 브라우저로 열기'
                        </p>
                    )}
                </div>
            </div>
        );
    }

   if (!currentUser) {
        return <EntryPage onEnter={handleEnter} isDarkMode={isDarkMode} toggleTheme={toggleTheme} />;
    }

    r    return (
        <div className={`${isDarkMode ? '' : 'light-mode'} min-h-screen flex flex-col`} style={{ background: 'var(--bg)', color: 'var(--text1)' }}>
            
          {/* --- PWA 앱 설치 유도 배너 (iOS 및 안드로이드 강력 대응) --- */}
            {showInstallBanner && (
                <div className="bg-gradient-to-r from-yellow-400 to-yellow-600 text-black p-3 flex flex-col shadow-xl sticky top-0 z-[60] border-b-2 border-yellow-700">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex-1 pr-2">
                            <p className="font-extrabold text-sm flex items-center gap-1">
                                <span className="animate-bounce">⚡</span> 콕스라이팅 전용 앱 설치
                            </p>
                            <p className="text-[11px] font-bold opacity-90 leading-tight mt-0.5">
                                푸시 알림을 받고 경기에 늦지 않으려면 <span className="underline decoration-red-500">반드시 앱을 설치</span>해야 합니다!
                            </p>
                        </div>
                        <div className="flex flex-shrink-0">
                            <button onClick={() => setShowInstallBanner(false)} className="p-1 text-black/50 hover:text-black transition-colors">
                                <i className="fas fa-times fa-lg"></i>
                            </button>
                        </div>
                    </div>
                    
                    {deferredPrompt ? (
                        /* 안드로이드 / 크롬 설치 버튼 */
                        <button onClick={handleInstallClick} className="w-full bg-black text-yellow-500 py-2.5 rounded-lg text-sm font-black shadow-md active:scale-95 transition-transform flex items-center justify-center gap-2">
                            <i className="fas fa-download animate-pulse"></i> 1초 만에 바로 설치하기
                        </button>
                    ) : (
                        /* iOS 사파리 안내 (아이폰 사용자를 위한 시각적 설명) */
                        <div className="bg-black/10 rounded-lg p-2.5 text-[11px] font-bold text-black flex flex-col gap-1 border border-black/20 shadow-inner">
                            <p className="text-xs mb-1">🍎 <span className="text-red-700 font-extrabold">아이폰(iOS)</span> 3초 설치 방법:</p>
                            <p className="flex items-center gap-1.5 mt-1">
                                1. 화면 맨 아래의 <span className="bg-white px-2 py-0.5 rounded-md shadow-sm flex items-center border border-gray-200 text-blue-500"><i className="fas fa-external-link-alt mr-1"></i> 공유</span> 버튼 누르기
                            </p>
                            <p className="flex items-center gap-1.5 mt-1">
                                2. 메뉴를 내려서 <span className="bg-white px-2 py-0.5 rounded-md shadow-sm flex items-center border border-gray-200"><i className="fas fa-plus-square text-gray-500 mr-1"></i> 홈 화면에 추가</span> 누르기
                            </p>
                            <p className="text-red-700 mt-1.5 bg-red-100 p-1 rounded">※ 반드시 <span className="underline">사파리(Safari)</span> 앱에서 열어주세요!</p>
                        </div>
                    )}
                </div>
            )}

            {/* --- 알림 차단 경고 고정 배너 --- */}
            {notiPermission !== 'granted' && (
                <div className="bg-red-600 text-white p-3 flex items-center justify-between shadow-lg sticky top-0 z-[55]">
                    <div className="flex-1 pr-2">
                        <p className="font-bold text-[11px] leading-tight">⚠️ 알림을 허용해야만 차례가 되었을 때 방 입장 알림을 받을 수 있습니다.</p>
                    </div>
                    <div className="flex flex-shrink-0">
                        <button 
                            onClick={() => {
                                if (notiPermission === 'default') {
                                    setShowNotiIntroModal(true);
                                } else {
                                    alert("이미 권한이 차단되었습니다.\n주소창 좌측의 자물쇠 아이콘(또는 설정)을 눌러 알림 권한을 '허용'으로 변경해주세요.");
                                }
                            }} 
                            className="bg-white text-red-600 px-2 py-1.5 rounded text-xs font-bold shadow-sm active:scale-95"
                        >
                            권한 설정
                        </button>
                    </div>
                </div>
            )}

            {/* --- 알림 권한 유도 모달 --- */}
            {showNotiIntroModal && (
                <NotiIntroModal 
                    onAllow={requestNotificationPermission} 
                    onClose={() => setShowNotiIntroModal(false)} 
                />
            )}

           {modal?.type === 'season' && <SeasonModal {...modal.data} onClose={() => {
                setIsSeasonModalDismissed(true); // 현재 세션에서 공지를 닫았음을 기록
                setModal({ type: null, data: null });
            }} />}
            {modal?.type === 'adminEditPlayer' && <AdminEditPlayerModal player={modal.data.player} allPlayers={allPlayers} onClose={() => setModal({ type: null, data: null })} setModal={setModal} />}
            {modal?.type === 'confirm' && <ConfirmationModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'courtSelection' && <CourtSelectionModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'alert' && <AlertModal {...modal.data} onClose={() => setModal({ type: null, data: null })} />}

          {isSettingsOpen && <SettingsModal
            isAdmin={isAdmin}
            scheduledCount={gameState.numScheduledMatches}
            courtCount={gameState.numInProgressCourts}
            seasonConfig={seasonConfig}
            activePlayers={activePlayers} /* [수정] '대기'가 아닌 '전체 활성' 선수 전달 */
            onSave={handleSettingsUpdate} // [수정] App 컴포넌트에서 정의된 함수 전달
            onCancel={() => setIsSettingsOpen(false)}
            setModal={setModal}
            onSystemReset={handleSystemReset}
            onClearPlayerHistory={handleClearPlayerHistory}
            onGenerateRobots={handleGenerateRobots}
            onAdminAddPlayer={handleAdminAddPlayer}
        />}

                      <header className="flex-shrink-0 sticky top-0 z-20 backdrop-blur-md" style={{background: 'rgba(13,17,23,0.88)', borderBottom: '1px solid var(--border)'}}>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <h1 className="text-base font-extrabold tracking-tight" style={{color: 'var(--text1)', letterSpacing: '-0.03em'}}>
                        {isAdmin && <span className="text-xs mr-1">👑</span>}
                        콕스라이팅
                    </h1>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{background: 'var(--surface2)', color: 'var(--text2)'}}>
                            {currentUser.name}
                        </span>
                        <button
                            onClick={handleToggleRest}
                            className="text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
                            style={currentUser.isResting
                                ? {background: '#1d4ed8', color: '#fff'}
                                : {background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)'}
                            }
                        >
                            {currentUser.isResting ? '복귀' : '휴식'}
                        </button>
                        <button
                            onClick={toggleTheme}
                            className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
                            style={{background: 'var(--surface2)', color: 'var(--text2)'}}
                        >
                            <i className={`fas fa-${isDarkMode ? 'sun' : 'moon'} text-sm`}></i>
                        </button>
                        {isAdmin && (
                            <button
                                onClick={() => setIsSettingsOpen(true)}
                                className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
                                style={{background: 'var(--surface2)', color: 'var(--text2)'}}
                            >
                                <i className="fas fa-cog text-sm"></i>
                            </button>
                        )}
                        <button
                            onClick={handleLogout}
                            className="text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
                            style={{background: 'rgba(239,68,68,0.12)', color: '#EF4444'}}
                        >
                            나가기
                        </button>
                    </div>
                </div>
            </header>

                       <main className="flex-grow flex flex-col gap-3 p-3 overflow-y-auto">
                {isMobile ? (
                    <>
                                                <div className="flex-shrink-0 flex gap-1 mb-3 sticky top-0 z-10 p-1 rounded-xl" style={{background: 'var(--surface2)'}}>
                            <button
                                onClick={() => setActiveTab('matching')}
                                className="flex-1 py-2 text-sm font-semibold rounded-lg transition-all"
                                style={activeTab === 'matching'
                                    ? {background: 'var(--surface)', color: 'var(--text1)', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'}
                                    : {color: 'var(--text2)'}}
                            >
                                경기 예정
                            </button>
                            <button
                                onClick={() => setActiveTab('inProgress')}
                                className="flex-1 py-2 text-sm font-semibold rounded-lg transition-all"
                                style={activeTab === 'inProgress'
                                    ? {background: 'var(--surface)', color: 'var(--text1)', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'}
                                    : {color: 'var(--text2)'}}
                            >
                                경기 진행
                            </button>
                        </div>
                                              <div className="flex flex-col gap-3">
                            {activeTab === 'matching' && (
                                <div key="tab-matching" className="flex flex-col gap-3 tab-fade-in">
                                    <WaitingListSection maleWaitingPlayers={maleWaitingPlayers} femaleWaitingPlayers={femaleWaitingPlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleDeleteFromWaiting={handleDeleteFromWaiting} setModal={setModal} currentUser={currentUser} inProgressPlayerIds={inProgressPlayerIds} onClearAllWaitingPlayers={handleClearAllWaitingPlayers} />
                                    <AutoMatchesSection autoMatches={autoMatches} players={activePlayers} isAdmin={isAdmin} handleStartAutoMatch={handleStartAutoMatch} handleReturnToWaiting={handleReturnToWaiting} handleClearAutoMatches={handleClearAutoMatches} handleDeleteAutoMatch={handleDeleteAutoMatch} currentUser={currentUser} handleAutoMatchCardClick={handleAutoMatchCardClick} selectedAutoMatchSlot={selectedAutoMatchSlot} inProgressPlayerIds={inProgressPlayerIds} handleAutoMatchSlotClick={handleAutoMatchSlotClick} isAutoMatchOn={seasonConfig?.autoMatchConfig?.isEnabled}/>
                                    <ScheduledMatchesSection numScheduledMatches={gameState.numScheduledMatches} scheduledMatches={gameState.scheduledMatches} players={activePlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleReturnToWaiting={handleReturnToWaiting} setModal={setModal} handleSlotClick={handleSlotClick} handleStartMatch={handleStartMatch} currentUser={currentUser} handleClearScheduledMatches={handleClearScheduledMatches} handleDeleteScheduledMatch={handleDeleteScheduledMatch} inProgressPlayerIds={inProgressPlayerIds} />
                                </div>
                            )}
                            {activeTab === 'inProgress' && (
                                <div key="tab-inprogress" className="tab-fade-in">
                                <InProgressCourtsSection numInProgressCourts={gameState.numInProgressCourts} inProgressCourts={gameState.inProgressCourts} players={activePlayers} isAdmin={isAdmin} handleEndMatch={handleEndMatch} currentUser={currentUser} courtMove={courtMove} setCourtMove={setCourtMove} handleMoveOrSwapCourt={handleMoveOrSwapCourt} />
                                </div>
                            )}
                                                </div>
                </>
            ) : (
                <div className="flex flex-col gap-3">
                    <WaitingListSection maleWaitingPlayers={maleWaitingPlayers} femaleWaitingPlayers={femaleWaitingPlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleDeleteFromWaiting={handleDeleteFromWaiting} setModal={setModal} currentUser={currentUser} inProgressPlayerIds={inProgressPlayerIds} onClearAllWaitingPlayers={handleClearAllWaitingPlayers} />
                    <AutoMatchesSection autoMatches={autoMatches} players={activePlayers} isAdmin={isAdmin} handleStartAutoMatch={handleStartAutoMatch} handleReturnToWaiting={handleReturnToWaiting} handleClearAutoMatches={handleClearAutoMatches} handleDeleteAutoMatch={handleDeleteAutoMatch} currentUser={currentUser} handleAutoMatchCardClick={handleAutoMatchCardClick} selectedAutoMatchSlot={selectedAutoMatchSlot} inProgressPlayerIds={inProgressPlayerIds} handleAutoMatchSlotClick={handleAutoMatchSlotClick} isAutoMatchOn={seasonConfig?.autoMatchConfig?.isEnabled}/>
                    <ScheduledMatchesSection numScheduledMatches={gameState.numScheduledMatches} scheduledMatches={gameState.scheduledMatches} players={activePlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleReturnToWaiting={handleReturnToWaiting} setModal={setModal} handleSlotClick={handleSlotClick} handleStartMatch={handleStartMatch} currentUser={currentUser} handleClearScheduledMatches={handleClearScheduledMatches} handleDeleteScheduledMatch={handleDeleteScheduledMatch} inProgressPlayerIds={inProgressPlayerIds} />
                    <InProgressCourtsSection numInProgressCourts={gameState.numInProgressCourts} inProgressCourts={gameState.inProgressCourts} players={activePlayers} isAdmin={isAdmin} handleEndMatch={handleEndMatch} currentUser={currentUser} courtMove={courtMove} setCourtMove={setCourtMove} handleMoveOrSwapCourt={handleMoveOrSwapCourt} />
                </div>
            )}
            </main>
        </div>
    );
}

// ===================================================================================
// 신규 및 복구된 페이지/모달 컴포넌트들
// ===================================================================================
function EntryPage({ onEnter, isDarkMode, toggleTheme }) {
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

    const levelColors = { 'A조': '#FF4F4F', 'B조': '#F97316', 'C조': '#EAB308', 'D조': '#22C55E' };

    return (
        <div className={`${isDarkMode ? '' : 'light-mode'} min-h-screen flex items-center justify-center p-4 relative`} style={{background: 'var(--bg)'}}>
            <button
                onClick={toggleTheme}
                className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full transition-all"
                style={{background: 'var(--surface2)', color: 'var(--text2)'}}
            >
                <i className={`fas fa-${isDarkMode ? 'sun' : 'moon'} text-sm`}></i>
            </button>

            <div className="modal-content w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{background: 'var(--surface2)'}}>
                        <span className="text-2xl">🏸</span>
                    </div>
                    <h1 className="text-2xl font-extrabold tracking-tight" style={{color: 'var(--text1)', letterSpacing: '-0.03em'}}>콕스라이팅</h1>
                    <p className="text-sm mt-1" style={{color: 'var(--text2)'}}>배드민턴 실시간 매칭 시스템</p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                        <label className="block text-xs font-semibold mb-1.5" style={{color: 'var(--text2)'}}>이름</label>
                        <input
                            type="text" name="name" placeholder="이름을 입력하세요"
                            value={formData.name} onChange={handleChange}
                            className="field text-sm"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold mb-1.5" style={{color: 'var(--text2)'}}>레벨</label>
                        <div className="grid grid-cols-4 gap-1.5">
                            {['A조', 'B조', 'C조', 'D조'].map(level => (
                                <button
                                    key={level}
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, level }))}
                                    className="py-2.5 rounded-lg text-sm font-bold transition-all"
                                    style={formData.level === level
                                        ? {background: levelColors[level], color: '#fff', transform: 'scale(1.02)'}
                                        : {background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)'}
                                    }
                                >
                                    {level}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold mb-1.5" style={{color: 'var(--text2)'}}>성별</label>
                        <div className="grid grid-cols-2 gap-1.5">
                            {[{value: '남', label: '남자', color: '#3B82F6'}, {value: '여', label: '여자', color: '#EC4899'}].map(opt => (
                                <label
                                    key={opt.value}
                                    className="flex items-center justify-center gap-2 py-2.5 rounded-lg cursor-pointer text-sm font-semibold transition-all"
                                    style={formData.gender === opt.value
                                        ? {background: opt.color, color: '#fff'}
                                        : {background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)'}
                                    }
                                >
                                    <input type="radio" name="gender" value={opt.value} checked={formData.gender === opt.value} onChange={handleChange} className="sr-only" />
                                    {opt.label}
                                </label>
                            ))}
                        </div>
                    </div>

                    <label className="flex items-center gap-2.5 py-2 cursor-pointer">
                        <div
                            className="w-5 h-5 rounded flex items-center justify-center transition-all"
                            style={formData.isGuest ? {background: '#2563EB'} : {background: 'var(--surface2)', border: '1.5px solid var(--border)'}}
                        >
                            {formData.isGuest && <i className="fas fa-check text-white" style={{fontSize: '10px'}}></i>}
                        </div>
                        <input type="checkbox" name="isGuest" checked={formData.isGuest} onChange={handleChange} className="sr-only" />
                        <span className="text-sm font-medium" style={{color: 'var(--text2)'}}>게스트로 참가</span>
                    </label>

                    <button type="submit" className="btn-primary w-full py-3.5 text-sm font-bold mt-2">
                        입장하기
                    </button>
                </form>
            </div>
        </div>
    );
}



function SeasonModal({ announcement, seasonId, onClose, announcementType, announcementPhotoUrl }) {
    const handleClose = (isHideToday = false) => {
        if (isHideToday) {
            localStorage.setItem(`seen-${seasonId}`, new Date().toDateString());
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-[#111] rounded-2xl overflow-hidden w-full max-w-sm text-center shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col border border-white/5">
               <div className="p-3 flex-grow overflow-y-auto max-h-[85vh]">
    {/* 상단 공지 헤더 최적화 */}
    <div className="mb-3">
        <h3 className="text-xs font-medium text-white/40 tracking-[0.2em] uppercase">Season Announcement</h3>
    </div>
    
    {announcementType === 'simple' ? (
        <div className="bg-[#151515] p-5 rounded-xl border border-yellow-500/20 shadow-[0_0_15px_rgba(255,224,0,0.1)] min-h-[250px] flex items-center justify-center text-center">
            <p className="text-white text-base font-sans whitespace-pre-wrap leading-relaxed break-keep">
                {announcement || "등록된 공지사항이 없습니다."}
            </p>
        </div>
    ) : (announcementType === 'text' || !announcementType) ? (
        <div className="poster-wrapper">
            <style>{`
                .poster-wrapper {
                  --brand-yellow: #FFE000;
                  --bg-solid: #0A0A0A;
                  display: flex;
                  justify-content: center;
                  background: transparent;
                  padding: 0;
                  font-family: 'Inter', 'Pretendard', sans-serif;
                }
                .poster-wrapper .poster {
                  width: 100%;
                  background: var(--bg-solid);
                  position: relative;
                  overflow: hidden;
                  border-radius: 12px;
                  display: flex;
                  flex-direction: column;
                  padding-bottom: 20px;
                  box-shadow: inset 0 0 100px rgba(255,224,0,0.05);
                }
                .poster-wrapper .top-line { height: 4px; background: var(--brand-yellow); width: 100%; }
                .poster-wrapper .top-bar { padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
                .poster-wrapper .top-bar-label { font-size: 9px; letter-spacing: 2px; color: #555; font-weight: 600; }
                .poster-wrapper .hero { padding: 24px 20px 10px; text-align: left; }
                .poster-wrapper .club-name { font-family: 'Black Han Sans', sans-serif; font-size: 48px; line-height: 1; color: var(--brand-yellow); letter-spacing: -1px; margin-bottom: 4px; }
                .poster-wrapper .club-sub { font-size: 14px; font-weight: 300; letter-spacing: 4px; color: rgba(255,255,255,0.4); text-transform: uppercase; }
                .poster-wrapper .section { padding: 0 20px; margin-top: 20px; text-align: left; }
                @keyframes pulse-border {
                  0% { border-color: rgba(255, 224, 0, 0.1); box-shadow: 0 0 0px rgba(255, 224, 0, 0); }
                  50% { border-color: rgba(255, 224, 0, 0.5); box-shadow: 0 0 10px rgba(255, 224, 0, 0.1); }
                  100% { border-color: rgba(255, 224, 0, 0.1); box-shadow: 0 0 0px rgba(255, 224, 0, 0); }
                }
                @keyframes status-blink {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.3; }
                }
                .poster-wrapper .section-label { 
                  font-size: 9px; 
                  letter-spacing: 2px; 
                  color: var(--brand-yellow); 
                  margin-bottom: 10px; 
                  font-weight: 700; 
                  display: flex;
                  align-items: center;
                  gap: 6px;
                }
                .poster-wrapper .status-dot {
                  width: 5px;
                  height: 5px;
                  background-color: #ff4d4d;
                  border-radius: 50%;
                  box-shadow: 0 0 5px #ff4d4d;
                  animation: status-blink 1s infinite;
                }
                .poster-wrapper .time-banner { 
                  background: #151515; 
                  border-radius: 8px; 
                  padding: 14px 18px; 
                  display: flex; 
                  align-items: center; 
                  justify-content: space-between; 
                  border: 1px solid rgba(255,224,0,0.2);
                  animation: pulse-border 3s infinite ease-in-out;
                }
                .poster-wrapper .time-banner-value { 
                  font-family: 'Pretendard', sans-serif; 
                  font-size: 14px; 
                  color: #ffffff; 
                  line-height: 1.6;
                  word-break: keep-all;
                  white-space: pre-wrap;
                  text-shadow: 0 0 1px rgba(255,255,255,0.2);
                }
                
                .poster-wrapper .shuttle-list { display: flex; flex-direction: column; gap: 8px; }
                .poster-wrapper .shuttle-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
                .poster-wrapper .shuttle-text { font-size: 12px; font-weight: 400; color: #aaa; }
                .poster-wrapper .ban-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 5px; }
                .poster-wrapper .ban-item { background: rgba(255,0,0,0.03); border-radius: 4px; padding: 8px 4px; text-align: center; }
                .poster-wrapper .ban-text { font-size: 10px; font-weight: 500; color: #666; }
                .poster-wrapper .ban-item.red-ban { background: rgba(255,0,0,0.05); }
                .poster-wrapper .ban-item.red-ban .ban-text { color: #844; }
                @keyframes revealUp { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
                .poster-wrapper .animate-item { animation: revealUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
                .poster-wrapper .delay-1 { animation-delay: 0.1s; }
                .poster-wrapper .delay-2 { animation-delay: 0.2s; }
                .poster-wrapper .delay-3 { animation-delay: 0.3s; }
                .poster-wrapper .delay-4 { animation-delay: 0.4s; }
            `}</style>
            <div className="poster">
                <div className="top-line"></div>
                <div className="top-bar animate-item">
                    <span className="top-bar-label">COCKSLIGHTING OFFICIAL</span>
                    <span className="top-bar-label">EST. 2023</span>
                </div>
                <div className="hero animate-item delay-1">
                    <div className="club-name">콕스라이팅</div>
                    <div className="club-sub">COCKSLIGHTING</div>
                </div>
                <div className="section animate-item delay-2">
                    <div className="section-label">
                        <span className="status-dot"></span>
                        NOTIFICATION
                    </div>
                    <div className="time-banner">
                        <span className="time-banner-value">{announcement || "금일 등록된 공지사항이 없습니다."}</span>
                    </div>
                </div>
                <div className="section animate-item delay-3">
                    <div className="section-label">EQUIPMENT</div>
                    <div className="shuttle-list">
                        <div className="shuttle-item"><div className="shuttle-text">KBB79 · BOBON365 · 삼화블랙 이상</div></div>
                        <div className="shuttle-item"><div className="shuttle-text text-white/60">개인콕 사용</div></div>
                    </div>
                </div>

                <div className="section animate-item delay-4" style={{marginTop: '15px'}}>
                    <div className="section-label">MANNER RULES</div>
                    <div className="ban-grid">
                        <div className="ban-item red-ban"><div className="ban-text">비매너</div></div>
                        <div className="ban-item red-ban"><div className="ban-text">영업행위</div></div>
                        <div className="ban-item red-ban"><div className="ban-text">남미새/여미새</div></div>
                        <div className="ban-item"><div className="ban-text">철새</div></div>
                        <div className="ban-item"><div className="ban-text">텃세</div></div>
                        <div className="ban-item"><div className="ban-text">승부욕</div></div>
                    </div>
                </div>
            </div>
        </div>
    ) : announcementType === 'photo' ? (
        <img 
            src={announcementPhotoUrl} 
            alt="공지사항" 
            className="w-full h-auto rounded-xl shadow-2xl mb-2"
            fetchpriority="high"
            loading="eager"
        />
    ) : null}
</div>
                <div className="bg-[#111] p-4 flex flex-col gap-2 border-t border-white/5">
                    <button onClick={() => handleClose(false)} className="w-full py-3.5 bg-white text-black font-bold rounded-xl hover:bg-yellow-400 transition-all active:scale-95 text-sm">확인했습니다</button>
                    <button onClick={() => handleClose(true)} className="text-white/20 text-[10px] py-1 hover:text-white/40 tracking-tight">오늘 하루 보지 않기</button>
                </div>
            </div>
        </div>
    );
}



function AdminEditPlayerModal({ player, allPlayers, onClose, setModal }) {
    const currentPlayer = allPlayers[player.id] || player;

    const handleToggleRest = async () => {
        await updateDoc(doc(playersRef, player.id), { isResting: !currentPlayer.isResting });
        onClose();
    };

    const handleAdjustGameCount = async (delta) => {
        const currentGames = currentPlayer.todayRecentGames || [];
        let newGames = [...currentGames];
        
        if (delta > 0) {
            newGames.unshift({ timestamp: new Date().toISOString(), partners: [], opponents: [], isManual: true });
        } else if (delta < 0 && newGames.length > 0) {
            newGames.shift();
        }
        
        try {
            await updateDoc(doc(playersRef, player.id), { todayRecentGames: newGames });
        } catch (error) {
            console.error("Game count adjustment failed:", error);
        }
    };

    const handleDeletePermanently = () => {
        setModal({ type: 'confirm', data: { title: '선수 완전 삭제', body: `[경고] ${player.name} 선수를 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`,
            onConfirm: async () => {
                await deleteDoc(doc(playersRef, player.id));
                onClose();
                setModal({ type: null, data: null });
            }
        }});
    };

    const RecentGamesList = ({ games }) => {
        if (!games || games.length === 0) {
            return <p className="text-sm text-gray-500 text-center">오늘 매칭 기록이 없습니다.</p>;
        }

        const getPlayerName = (id) => allPlayers[id]?.name || '알수없음';

        return (
            <ul className="text-sm space-y-1 max-h-32 overflow-y-auto pr-2">
                {games.map((game, i) => {
                            if (game.isManual) {
                                return (
                                    <li key={i} className="flex flex-col p-2 rounded bg-gray-700/50">
                                        <div className="flex flex-wrap gap-1 items-center">
                                            <span className="text-yellow-400 font-bold" style={{ textShadow: '0 0 8px rgba(250, 204, 21, 0.8)' }}>
                                                {getPlayerName(player.id)}
                                            </span>
                                            <span className="text-gray-400 text-xs ml-2">(수동 조작됨)</span>
                                        </div>
                                    </li>
                                );
                            }

                            const allPlayersInGame = [player.id, ...game.partners, ...game.opponents];
                            
                            return (
                                <li key={i} className="flex flex-col p-2 rounded bg-gray-700/50">
                                    <div className="flex flex-wrap gap-1">
                                        {allPlayersInGame.map((id, idx) => {
                                            const name = getPlayerName(id);
                                            const isTargetPlayer = id === player.id;
                                            return (
                                                <span key={idx} className={isTargetPlayer ? "text-yellow-400 font-bold" : "text-gray-300"} style={isTargetPlayer ? { textShadow: '0 0 8px rgba(250, 204, 21, 0.8)' } : {}}>
                                                    {name}{idx < allPlayersInGame.length - 1 ? ', ' : ''}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </li>
                            )
                        })}
            </ul>
        );
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md text-white shadow-lg">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-yellow-400 arcade-font">{player.name} 정보 관리</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white">&times;</button>
                </div>
                
                <div className="space-y-4">
                            <button onClick={handleToggleRest} className={`w-full arcade-button font-bold py-2 rounded-lg ${currentPlayer.isResting ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gray-600 text-white hover:bg-gray-500'}`}>
                                {currentPlayer.isResting ? '휴식 해제 (복귀)' : '휴식 상태로 전환'}
                            </button>

                            <div className="flex items-center justify-between bg-gray-700/50 p-2 rounded-lg">
                                <span className="font-bold text-gray-300">현재 게임 수 조작</span>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => handleAdjustGameCount(-1)} className="w-8 h-8 bg-gray-600 hover:bg-gray-500 rounded text-xl font-bold flex items-center justify-center">-</button>
                                    <span className="text-xl font-bold text-yellow-400 w-8 text-center">{(currentPlayer.todayRecentGames || []).length}</span>
                                    <button onClick={() => handleAdjustGameCount(1)} className="w-8 h-8 bg-gray-600 hover:bg-gray-500 rounded text-xl font-bold flex items-center justify-center">+</button>
                                </div>
                            </div>
                            
                            <hr className="border-gray-600"/>
                            <h4 className="font-bold text-yellow-400 text-center">오늘의 매칭 히스토리</h4>
                            <RecentGamesList games={currentPlayer.todayRecentGames} />
                        </div>
                
                <div className="mt-6 flex flex-col gap-2">
                    <button onClick={handleDeletePermanently} className="w-full text-xs arcade-button bg-red-900/50 hover:bg-red-800 text-red-300 font-bold py-2 rounded-lg">선수 완전 삭제</button>
                </div>
            </div>
        </div>
    );
}

// [자동매칭] 설정 모달 대규모 업데이트 (수정됨)
function SettingsModal({ isAdmin, scheduledCount, courtCount, seasonConfig, activePlayers, onSave, onCancel, setModal, onSystemReset, onClearPlayerHistory, onGenerateRobots, onAdminAddPlayer }) {
    const [scheduled, setScheduled] = useState(scheduledCount);
    const [courts, setCourts] = useState(courtCount);
    const [announcement, setAnnouncement] = useState(seasonConfig.announcement);
    const [robotMaleCount, setRobotMaleCount] = useState(0);
    const [robotFemaleCount, setRobotFemaleCount] = useState(0);

    // 수동 선수 추가 폼 상태
    const [showAddPlayerForm, setShowAddPlayerForm] = useState(false);
    const [newPlayerForm, setNewPlayerForm] = useState({ name: '', level: 'A조', gender: '남', isGuest: false });

    // 자동매칭 설정 상태 (수정됨)
  const [autoMatchConfig, setAutoMatchConfig] = useState({
        ...(seasonConfig.autoMatchConfig || {}),
        // [수정] 루트 레벨에 저장된 공지 타입과 사진 URL을 초기값으로 명시
        announcementType: seasonConfig.announcementType || 'text',
        announcementPhotoUrl: seasonConfig.announcementPhotoUrl || ''
    });

    if (!isAdmin) return null;
    
    const handleSave = () => {
        onSave({ scheduled, courts, announcement, autoMatchConfig });
    };

    const handleAutoMatchConfigChange = (e) => {
        const { name, value, type, checked } = e.target;
        // [수정] type="text"일 때도 숫자로 변환 시도, 실패 시 0 또는 빈 문자열(마이너스 입력 중)
        let processedValue;
        if (type === 'checkbox') {
            processedValue = checked;
        } else if (value === '-') {
            processedValue = value; // 마이너스 부호 단독 입력 허용
        } else if (value === '') {
            processedValue = 0; // 비어있으면 0으로 처리
        } else {
            processedValue = Number(value);
            if (isNaN(processedValue)) {
                processedValue = 0; // 숫자가 아니면 0으로
            }
        }
        
        setAutoMatchConfig(prev => ({
            ...prev,
            [name]: processedValue
        }));
    };

// [자동매칭] 전체 인원수 기반 추천 점수 계산 로직 (수정됨)
    const { malePlayerCount, femalePlayerCount, recommendedMaleScore, recommendedFemaleScore } = useMemo(() => {
        // [수정] '대기'가 아닌 '전체 활성' 선수 중 휴식 제외 (대기+진행+예정 모두 포함, 게스트 포함)
        const activePlayersList = Object.values(activePlayers).filter(p => !p.isResting);
        const malePlayerCount = activePlayersList.filter(p => p.gender === '남').length;
        const femalePlayerCount = activePlayersList.filter(p => p.gender === '여').length;

     // [수정] 전체 인원수에 따른 직관적인 커트라인 계산 함수
        const getMinScore = (totalPlayers) => {
            if (totalPlayers < 8) return -100; // 생존 모드 (회전율 최우선)
            if (totalPlayers >= 8 && totalPlayers < 12) return 0; // 현실적 타협 구간 (10명 기준 최적화)
            if (totalPlayers >= 12 && totalPlayers < 16) return 40; // 쾌적 모드
            return 80; // 엄격한 다양성 모드
        };

        return {
            malePlayerCount,
            femalePlayerCount,
            recommendedMaleScore: getMinScore(malePlayerCount),
            recommendedFemaleScore: getMinScore(femalePlayerCount)
        }
    }, [activePlayers]); // courtCount 의존성 제거


    // [신규] 수동 설정이 아닐 경우, 추천 점수를 autoMatchConfig 상태에 자동으로 반영
    useEffect(() => {
        if (!autoMatchConfig.isManualConfig) { // [수정]
            // If not in manual mode, update the config state with the live recommended scores
            setAutoMatchConfig(prev => ({
                ...prev,
                minMaleScore: recommendedMaleScore,
                minFemaleScore: recommendedFemaleScore
            }));
        }
    }, [autoMatchConfig.isManualConfig, recommendedMaleScore, recommendedFemaleScore]); // [수정]
    
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

                              {/* [수정] 전체 인원수 및 추천 점수 표시 UI */}
                               <div className="bg-gray-800 p-2 rounded">
                                <p className="text-sm text-center text-gray-400">
                                    현재 활성 인원: 남 {malePlayerCount}명 / 여 {femalePlayerCount}명
                                </p>
                                    <p className="text-sm text-center text-yellow-400 mt-1">
                                        추천 최소 점수: {recommendedMaleScore}점 (남) / {recommendedFemaleScore}점 (여)
                                    </p>
                                </div>
                                
                                {/* [수정됨] 수동 설정 체크박스 및 입력란 수정 */}
                                <div>
                                   <div className="flex justify-between items-center mb-2">
                                        <p className="font-semibold text-center">최종 최소 점수</p>
                                        <label className="flex items-center text-sm cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                checked={autoMatchConfig.isManualConfig || false} 
                                                onChange={(e) => setAutoMatchConfig(prev => ({ ...prev, isManualConfig: e.target.checked }))} 
                                                className="w-4 h-4 text-yellow-400 bg-gray-700 border-gray-600 rounded focus:ring-yellow-500"
                                            />
                                            <span className="ml-2 text-gray-300">수동 설정</span>
                                        </label>
                                    </div>
                                    <div className="flex justify-around gap-4">
                                        <div className="flex-1 text-center">
                                            <label className="block mb-1">👨 남자 최소 점수</label>
                                           <input 
                                                type="text" 
                                                inputMode="decimal" 
                                                name="minMaleScore" 
                                                value={autoMatchConfig.minMaleScore} 
                                                onChange={handleAutoMatchConfigChange} 
                                                className={`w-full bg-gray-600 p-2 rounded-lg text-center ${!autoMatchConfig.isManualConfig ? 'text-gray-400' : 'text-white'}`}
                                                placeholder={String(recommendedMaleScore)}
                                                disabled={!autoMatchConfig.isManualConfig} 
                                            />
                                        </div>
                                        <div className="flex-1 text-center">
                                            <label className="block mb-1">👩 여자 최소 점수</label>
                                             <input 
                                                type="text" 
                                                inputMode="decimal" 
                                                name="minFemaleScore" 
                                                value={autoMatchConfig.minFemaleScore} 
                                                onChange={handleAutoMatchConfigChange} 
                                                className={`w-full bg-gray-600 p-2 rounded-lg text-center ${!autoMatchConfig.isManualConfig ? 'text-gray-400' : 'text-white'}`}
                                                placeholder={String(recommendedFemaleScore)}
                                                disabled={!autoMatchConfig.isManualConfig} 
                                            />
                                        </div>
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
                                <p>경기 예정 코트 수</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => setScheduled(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                                    <span className="text-xl font-bold w-8 text-center">{scheduled}</span>
                                    <button onClick={() => setScheduled(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                                </div>
                            </div>
                            <div className="text-center">
                                <p>경기 진행 코트 수</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => setCourts(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                                    <span className="text-xl font-bold w-8 text-center">{courts}</span>
                                    <button onClick={() => setCourts(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                   <div className="bg-gray-700 p-3 rounded-lg space-y-3">
                        <label className="font-semibold block text-center border-b border-gray-600 pb-2">시즌 공지 설정</label>
                   <div className="flex flex-wrap justify-center gap-3 mb-2 text-sm">
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="none" checked={autoMatchConfig.announcementType === 'none'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>없음</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="simple" checked={autoMatchConfig.announcementType === 'simple'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>일반 텍스트</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="text" checked={(autoMatchConfig.announcementType || 'text') === 'text'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>포스터</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="photo" checked={autoMatchConfig.announcementType === 'photo'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>사진 업로드</span>
    </label>
</div>

{autoMatchConfig.announcementType === 'none' ? (
    <div className="text-center text-sm text-gray-400 py-3 bg-gray-800 rounded">
        접속 시 공지사항 창을 띄우지 않고 바로 방으로 입장합니다.
    </div>
) : autoMatchConfig.announcementType === 'photo' ? (
    <div className="space-y-2">
        <input type="file" accept="image/*" onChange={(e) => setAutoMatchConfig(prev => ({...prev, photoFile: e.target.files[0]}))}
            className="w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-yellow-500 file:text-black hover:file:bg-yellow-600" />
        {seasonConfig.announcementPhotoUrl && <p className="text-[10px] text-gray-500 text-center">기존 사진이 등록되어 있습니다. 변경 시 덮어씌워집니다.</p>}
    </div>
) : (
    <div className="space-y-2">
        <textarea value={announcement} onChange={(e) => setAnnouncement(e.target.value)} rows="3" placeholder="공지 내용을 입력하세요"
            className="w-full bg-gray-600 text-white p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-400"></textarea>
        <p className="text-[10px] text-center text-gray-500">
            {autoMatchConfig.announcementType === 'simple' ? '입력한 내용이 모달 창에 깔끔한 일반 텍스트 형태로 표시됩니다.' : '입력한 내용이 \'사용자 지정 포스터\' 디자인에 자동으로 삽입됩니다.'}
        </p>
    </div>
)}
                    </div>

                 {/* --- 선수 수동 추가 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-2">
                        <div 
                            className="flex justify-between items-center cursor-pointer"
                            onClick={() => setShowAddPlayerForm(!showAddPlayerForm)}
                        >
                            <label className="font-semibold cursor-pointer">👤 관리자 선수 임의 추가</label>
                            <span className="text-gray-400">{showAddPlayerForm ? '▲' : '▼'}</span>
                        </div>
                        
                        {showAddPlayerForm && (
                            <div className="bg-gray-800 p-3 rounded border border-gray-600 mt-2 space-y-3">
                                <input 
                                    type="text" 
                                    placeholder="이름" 
                                    value={newPlayerForm.name} 
                                    onChange={(e) => setNewPlayerForm(prev => ({...prev, name: e.target.value}))} 
                                    className="w-full bg-gray-600 text-white p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm" 
                                />
                                <div className="grid grid-cols-4 gap-1">
                                    {['A조', 'B조', 'C조', 'D조'].map(level => (
                                        <button
                                            key={level}
                                            type="button"
                                            onClick={() => setNewPlayerForm(prev => ({ ...prev, level }))}
                                            className={`py-1 rounded text-xs font-bold transition-colors arcade-button ${newPlayerForm.level === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}
                                        >
                                            {level}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex justify-around items-center text-sm bg-gray-600 p-2 rounded-md">
                                    <label className="flex items-center cursor-pointer">
                                        <input type="radio" name="newPlayerGender" value="남" checked={newPlayerForm.gender === '남'} onChange={() => setNewPlayerForm(prev => ({...prev, gender: '남'}))} className="mr-1 h-3 w-3 text-yellow-500 bg-gray-700 border-gray-600 focus:ring-yellow-500" /> 남자
                                    </label>
                                    <label className="flex items-center cursor-pointer">
                                        <input type="radio" name="newPlayerGender" value="여" checked={newPlayerForm.gender === '여'} onChange={() => setNewPlayerForm(prev => ({...prev, gender: '여'}))} className="mr-1 h-3 w-3 text-pink-500 bg-gray-700 border-gray-600 focus:ring-pink-500" /> 여자
                                    </label>
                                    <div className="w-px h-4 bg-gray-500"></div>
                                    <label className="flex items-center cursor-pointer">
                                        <input type="checkbox" checked={newPlayerForm.isGuest} onChange={(e) => setNewPlayerForm(prev => ({...prev, isGuest: e.target.checked}))} className="mr-1 h-3 w-3 rounded text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" /> 게스트
                                    </label>
                                </div>
                                <button
                                    onClick={() => {
                                        onAdminAddPlayer(newPlayerForm);
                                        setNewPlayerForm({ name: '', level: 'A조', gender: '남', isGuest: false });
                                        setShowAddPlayerForm(false);
                                    }}
                                    className="w-full arcade-button bg-green-600 hover:bg-green-700 text-white font-bold py-1.5 rounded text-sm"
                                >
                                    추가하기
                                </button>
                            </div>
                        )}
                    </div>

                  {/* --- 고급 기능 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-2">
                        <label className="font-semibold mb-2 block text-center">고급 기능</label>
                        
                        {/* 테스트 로봇 생성 섹션 */}
                        <div className="bg-gray-800 p-2 rounded border border-gray-600 mb-4">
                            <p className="text-sm font-semibold text-center mb-2 text-cyan-400">🤖 테스트 로봇 생성 (개발용)</p>
                            <div className="flex justify-around gap-2 mb-2">
                                <div className="flex-1 text-center">
                                    <label className="block text-xs mb-1 text-gray-400">👨 남자 수</label>
                                    <input 
                                        type="number" min="0" 
                                        value={robotMaleCount} 
                                        onChange={(e) => setRobotMaleCount(Number(e.target.value))} 
                                        className="w-full bg-gray-600 p-1.5 rounded text-center text-white text-sm" 
                                    />
                                </div>
                                <div className="flex-1 text-center">
                                    <label className="block text-xs mb-1 text-gray-400">👩 여자 수</label>
                                    <input 
                                        type="number" min="0" 
                                        value={robotFemaleCount} 
                                        onChange={(e) => setRobotFemaleCount(Number(e.target.value))} 
                                        className="w-full bg-gray-600 p-1.5 rounded text-center text-white text-sm" 
                                    />
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    onGenerateRobots(robotMaleCount, robotFemaleCount);
                                    setRobotMaleCount(0);
                                    setRobotFemaleCount(0);
                                }}
                                className="w-full arcade-button bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={robotMaleCount === 0 && robotFemaleCount === 0}
                            >
                                로봇 생성하기
                            </button>
                        </div>

                         <button
                            onClick={onSystemReset}
                            className="w-full arcade-button bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 rounded-lg disabled:opacity-50 mb-2"
                        >
                            모두 대기로 이동
                        </button>
                        <button
                            onClick={onClearPlayerHistory}
                            className="w-full arcade-button bg-red-800 hover:bg-red-900 text-white font-bold py-2 rounded-lg disabled:opacity-50"
                        >
                            선수 히스토리 삭제
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

function ConfirmationModal({ title, body, onConfirm, onCancel }) {
    return (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{background: 'rgba(0,0,0,0.75)'}}>
            <div className="modal-content w-full max-w-sm rounded-2xl p-6" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
                <h3 className="text-base font-bold mb-2" style={{color: 'var(--text1)'}}>{title}</h3>
                <p className="text-sm mb-6 leading-relaxed" style={{color: 'var(--text2)'}}>{body}</p>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="btn-ghost flex-1 py-2.5 text-sm">취소</button>
                    <button onClick={onConfirm} className="btn-danger flex-1 py-2.5 text-sm">확인</button>
                </div>
            </div>
        </div>
    );
}

function CourtSelectionModal({ courts, onSelect, onCancel }) {
    const [isProcessing, setIsProcessing] = useState(false);

    return (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{background: 'rgba(0,0,0,0.75)'}}>
            <div className="modal-content w-full max-w-sm rounded-2xl p-6" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
                <h3 className="text-base font-bold mb-1" style={{color: 'var(--text1)'}}>코트 선택</h3>
                <p className="text-sm mb-5" style={{color: 'var(--text2)'}}>경기를 시작할 코트를 선택해주세요.</p>
                <div className="flex flex-col gap-2">
                    {courts.map(courtIdx => (
                        <button
                            key={courtIdx}
                            onClick={() => { setIsProcessing(true); onSelect(courtIdx); }}
                            className="btn-primary w-full py-3 text-sm font-bold disabled:opacity-50"
                            disabled={isProcessing}
                        >
                            {isProcessing ? '처리 중...' : `${courtIdx + 1}번 코트`}
                        </button>
                    ))}
                </div>
                <button onClick={onCancel} className="btn-ghost w-full py-2.5 text-sm mt-3" disabled={isProcessing}>취소</button>
            </div>
        </div>
    );
}

function AlertModal({ title, body, onClose }) {
    return (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{background: 'rgba(0,0,0,0.75)'}}>
            <div className="modal-content w-full max-w-sm rounded-2xl p-6 text-center" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
                <h3 className="text-base font-bold mb-2" style={{color: 'var(--text1)'}}>{title}</h3>
                <p className="text-sm mb-6 leading-relaxed" style={{color: 'var(--text2)'}}>{body}</p>
                <button onClick={onClose} className="btn-primary w-full py-2.5 text-sm">확인</button>
            </div>
        </div>
    );
}

function NotiIntroModal({ onAllow, onClose }) {
    return (
        <div className="fixed inset-0 flex items-center justify-center z-[70] p-4" style={{background: 'rgba(0,0,0,0.8)'}}>
            <div className="modal-content w-full max-w-sm rounded-2xl p-6 text-center" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
                <div className="text-4xl mb-4">🔔</div>
                <h3 className="text-base font-bold mb-2" style={{color: 'var(--text1)'}}>경기 입장 알림 받기</h3>
                <p className="text-sm mb-5 leading-relaxed" style={{color: 'var(--text2)'}}>
                    차례가 되면 <strong style={{color: 'var(--text1)'}}>방 입장 알림</strong>을 보내드립니다.<br/>
                    원활한 경기 진행을 위해 알림을 허용해주세요.
                </p>
                <div className="flex flex-col gap-2">
                    <button onClick={onAllow} className="btn-primary w-full py-3 text-sm font-bold">알림 허용하기</button>
                    <button onClick={onClose} className="text-xs py-2" style={{color: 'var(--text3)'}}>나중에 설정하기</button>
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

