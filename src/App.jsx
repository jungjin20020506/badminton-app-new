// -----------------------------------------------------------------------------
// app.jsx (청백전 이벤트 버전 - UI 및 로직 강화)
// -----------------------------------------------------------------------------
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
        autoMatches: {},
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
            pointSystemInfo: "- 참석: +20 RP (3경기 완료시)\n- 승리: +30 RP\n- 패배: +10 RP\n- 3연승 보너스: +20 RP"
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
// 상수 및 Helper 함수
// ===================================================================================
const ADMIN_NAMES = ["나채빈", "정형진", "윤지혜", "이상민", "이정문", "신영은", "오미리"];
const PLAYERS_PER_MATCH = 4;
const RP_CONFIG = {
    ATTENDANCE: 20,
    WIN: 30,
    LOSS: 10,
    WIN_STREAK_BONUS: 20,
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
    
    const teamStyle = {
        boxShadow: `inset 4px 0 0 0 ${player.gender === '청' ? '#3B82F6' : '#E5E7EB'}`
    };
    const adminIcon = (player.role === 'admin' || ADMIN_NAMES.includes(player.name)) ? '👑' : '';
    const isWaiting = !context.location;
    
    // ▼▼▼▼▼ 아래 두 줄의 className을 수정합니다 ▼▼▼▼▼
    const playerNameClass = `player-name text-white text-xs font-bold whitespace-nowrap leading-tight tracking-tighter truncate`;
    const playerInfoClass = `player-info text-gray-400 text-[10px] leading-tight mt-px whitespace-nowrap truncate`;
    // ▲▲▲▲▲ 여기에 'truncate'를 추가했습니다 ▲▲▲▲▲
    
    const levelColor = getLevelColor(player.level, player.isGuest);
    const levelStyle = {
        color: levelColor,
        fontWeight: 'bold',
        fontSize: '14px',
        textShadow: `0 0 5px ${levelColor}`
    };
    const cardStyle = {
        ...teamStyle,
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'transparent',
        transition: 'all 0.2s ease-in-out',
        backgroundColor: '#2d3748',
        opacity: isPlaying ? 0.6 : 1,
    };

    if (context.selected || isSelectedForWin) {
        cardStyle.borderColor = '#34d399';
        cardStyle.transform = 'scale(1.05)';
        cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 15px 5px rgba(52, 211, 153, 0.9)`;
    }
    
    if (isCurrentUser) {
        cardStyle.borderColor = '#FBBF24';
        cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 12px 4px rgba(251, 191, 36, 0.9)`;
    }

    const isLongPressDisabled = context.location === 'court';
    const actionLabel = isWaiting ? '선수 내보내기' : '대기자로 이동';
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

// --- 청백전 수정 --- : EmptySlot에 팀 정보(team) prop 추가
const EmptySlot = ({ onSlotClick, team }) => {
    // --- 청백전 수정 --- : 팀에 따른 스타일 동적 적용
    const teamClass = team === '청' 
        ? 'border-blue-800 hover:bg-blue-900/50 hover:border-blue-500' 
        : 'border-gray-700 hover:bg-gray-700/50 hover:border-gray-400';

    return ( 
        <div 
            className={`player-slot h-14 bg-black/30 rounded-md flex items-center justify-center text-gray-600 border-2 border-dashed cursor-pointer transition-all ${teamClass}`}
            onClick={onSlotClick}
        >
            <span className="text-xl font-bold">+</span>
        </div> 
    );
};


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

const WaitingListSection = React.memo(({ blueWaitingPlayers, whiteWaitingPlayers, selectedPlayerIds, isAdmin, handleCardClick, handleDeleteFromWaiting, setModal, currentUser, inProgressPlayerIds }) => {
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
    return (
        <section className="bg-gray-800/50 rounded-lg p-2">
            <h2 className="text-sm font-bold mb-2 text-yellow-400 arcade-font flicker-text">대기 명단 ({blueWaitingPlayers.length + whiteWaitingPlayers.length})</h2>
            <div className="flex flex-col gap-2">
                {renderPlayerGrid(blueWaitingPlayers)}
                {blueWaitingPlayers.length > 0 && whiteWaitingPlayers.length > 0 && (
                    <hr className="border-dashed border-gray-600 my-1" />
                )}
                {renderPlayerGrid(whiteWaitingPlayers)}
            </div>
        </section>
    );
});

// --- 청백전 수정 --- : ScheduledMatchesSection UI 전면 개편
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

    const renderTeamSlots = (match, matchIndex, team) => {
        const slots = team === '청' ? [0, 1] : [2, 3];
        return slots.map(slotIndex => {
            const playerId = match[slotIndex];
            const player = players[playerId];
            const context = { location: 'schedule', matchIndex, slotIndex, selected: selectedPlayerIds.includes(playerId) };
            return player ? (
                <PlayerCard key={playerId} player={player} context={context} isAdmin={isAdmin} onCardClick={() => handleCardClick(playerId)} onAction={handleReturnToWaiting} onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})} isCurrentUser={currentUser && player.id === currentUser.id} isPlaying={inProgressPlayerIds.has(playerId)} />
            ) : (
                <EmptySlot key={`schedule-empty-${matchIndex}-${slotIndex}`} onSlotClick={() => handleSlotClick({ location: 'schedule', matchIndex, slotIndex })} team={team} />
            );
        });
    };

    return (
        <section>
            <div className="flex justify-between items-center mb-2 px-1">
                <h2 className="text-lg font-bold text-cyan-400 arcade-font">경기 예정</h2>
                {isAdmin && hasMatches && (
                    <button onClick={handleClearScheduledMatches} className="arcade-button text-xs bg-red-800 text-white py-1 px-2 rounded-md">전체삭제</button>
                )}
            </div>
            <div id="scheduled-matches" className="flex flex-col gap-2">
                {Array.from({ length: numScheduledMatches }).map((_, matchIndex) => {
                    const match = scheduledMatches[String(matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                    const playerCount = match.filter(p => p).length;
                    return (
                        // ▼▼▼▼▼ 아래 div의 className에서 'gap-1'을 'gap-0.5'로 수정합니다 ▼▼▼▼▼
                        <div key={`schedule-${matchIndex}`} className="flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-0.5">
                            <div 
                                // ▼▼▼▼▼ 여기 div의 className에서 'w-6'를 'w-5'로 수정합니다 ▼▼▼▼▼
                                className="flex-shrink-0 w-5 text-center cursor-pointer"
                                onMouseDown={() => handlePressStart(matchIndex)}
                                onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
                                onTouchStart={() => handlePressStart(matchIndex)}
                                onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
                            >
                                <p className="font-bold text-lg text-white arcade-font">{matchIndex + 1}</p>
                            </div>
                            <div className="flex-1 flex items-center justify-center gap-1 min-w-0">
                                <div className="flex-1 p-1 rounded-md bg-blue-900/30">
                                    <div className="grid grid-cols-2 gap-1">
                                        {renderTeamSlots(match, matchIndex, '청')}
                                    </div>
                                </div>
                                {/* ▼▼▼▼▼ 여기 div의 className에서 'px-1'을 삭제합니다 ▼▼▼▼▼ */}
                                <div className="text-base font-bold text-gray-500 arcade-font">VS</div>
                                <div className="flex-1 p-1 rounded-md bg-gray-700/30">
                                    <div className="grid grid-cols-2 gap-1">
                                        {renderTeamSlots(match, matchIndex, '백')}
                                    </div>
                                </div>
                            </div>
                            {/* ▼▼▼▼▼ 여기 div의 className에서 'w-14'를 'w-12'로 수정합니다 ▼▼▼▼▼ */}
                            <div className="flex-shrink-0 w-12 text-center">
                                {/* ▼▼▼▼▼ 여기 button의 className에서 'py-1.5 px-1'을 'py-1'로 수정합니다 ▼▼▼▼▼ */}
                                <button className={`arcade-button w-full py-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === PLAYERS_PER_MATCH && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== PLAYERS_PER_MATCH || !isAdmin} onClick={() => handleStartMatch(matchIndex)}>START</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});
// ... 이후 코드 ...


const AutoMatchesSection = React.memo(({ autoMatches, players, isAdmin, handleStartAutoMatch, handleRemoveFromAutoMatch, handleClearAutoMatches, handleDeleteAutoMatch, currentUser, handleAutoMatchCardClick, selectedAutoMatchSlot, inProgressPlayerIds, handleAutoMatchSlotClick }) => {
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
                 <h2 className="text-lg font-bold text-green-400 arcade-font">🤖 자동 매칭 (사용불가)</h2>
                 {isAdmin && matchList.length > 0 && (
                    <button onClick={handleClearAutoMatches} className="arcade-button text-xs bg-red-800 text-white py-1 px-2 rounded-md">전체삭제</button>
                 )}
            </div>
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
                                        (<PlayerCard key={cardKey} player={player} context={{selected: isSelected}} isAdmin={isAdmin} onCardClick={() => handleAutoMatchCardClick(matchIndex, slotIndex)} onAction={() => handleRemoveFromAutoMatch(matchIndex, slotIndex, player)} isCurrentUser={currentUser && player.id === currentUser.id} isPlaying={inProgressPlayerIds.has(playerId)} />) : 
                                        (<EmptySlot key={cardKey} onSlotClick={() => handleAutoMatchSlotClick(matchIndex, slotIndex)} team="?" />)
                                })}
                            </div>
                            <div className="flex-shrink-0 w-14 text-center">
                                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === 4 && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== 4 || !isAdmin} onClick={() => handleStartAutoMatch(matchIndex)}>START</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});

// --- 청백전 수정 --- : InProgressCourt UI 전면 개편
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
    // ▼▼▼▼▼ 아래 div의 className에서 'gap-1'을 'gap-0.5'로 수정합니다 ▼▼▼▼▼
    const courtContainerClass = `flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-0.5 transition-all duration-300 ${isSource ? 'border-2 border-yellow-400 scale-105 shadow-lg shadow-yellow-400/30' : 'border-2 border-transparent'} ${isAdmin ? 'cursor-pointer' : ''}`;

    const renderTeamSlots = (team) => {
        const slots = team === '청' ? [0, 1] : [2, 3];
        return slots.map(slotIndex => {
            const playerId = court?.players?.[slotIndex];
            const player = players[playerId];
            return player ? (
                <PlayerCard key={playerId} player={player} context={{ location: 'court', matchIndex: courtIndex }} isAdmin={isAdmin} isCurrentUser={currentUser && player.id === currentUser.id} isMovable={false} />
            ) : (
                <EmptySlot key={`court-empty-${courtIndex}-${slotIndex}`} team={team} />
            );
        });
    };

   return (
        <div ref={courtRef} className={courtContainerClass} onClick={handleClick}>
            {/* ▼▼▼▼▼ 여기 div의 className에서 'w-6'를 'w-5'로 수정합니다 ▼▼▼▼▼ */}
            <div className="flex-shrink-0 w-5 flex flex-col items-center justify-center">
                <p className="font-bold text-lg text-white arcade-font">{courtIndex + 1}</p>
                <p className="font-semibold text-[8px] text-gray-400 arcade-font">코트</p>
            </div>
            <div className="flex-1 flex items-center justify-center gap-1 min-w-0">
                <div className="flex-1 p-1 rounded-md bg-blue-900/30">
                    <div className="grid grid-cols-2 gap-1">
                        {renderTeamSlots('청')}
                    </div>
                </div>
                {/* ▼▼▼▼▼ 여기 div의 className에서 'px-1'을 삭제합니다 ▼▼▼▼▼ */}
                <div className="text-base font-bold text-gray-500 arcade-font">VS</div>
                <div className="flex-1 p-1 rounded-md bg-gray-700/30">
                    <div className="grid grid-cols-2 gap-1">
                        {renderTeamSlots('백')}
                    </div>
                </div>
            </div>
            {/* ▼▼▼▼▼ 여기 div의 className에서 'w-14'를 'w-12'로 수정합니다 ▼▼▼▼▼ */}
            <div className="flex-shrink-0 w-12 text-center">
                {/* ▼▼▼▼▼ 여기 button의 className에서 'py-1.5 px-1'을 'py-1'로 수정합니다 ▼▼▼▼▼ */}
                <button className={`arcade-button w-full py-1 rounded-md font-bold transition duration-300 text-[10px] ${court && isAdmin ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={!court || !isAdmin} onClick={(e) => { e.stopPropagation(); handleEndMatch(courtIndex); }}>FINISH</button>
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

const TeamScoreboard = ({ scores }) => {
    const scoreStyle = {
        blue: {
            textShadow: '0 0 8px #3B82F6, 0 0 12px #3B82F6'
        },
        white: {
            textShadow: '0 0 8px #E5E7EB, 0 0 12px #E5E7EB'
        }
    };

    return (
        <section className="bg-gray-900/50 rounded-lg p-3 my-2">
            <div className="flex justify-around items-center text-center">
                <div className="flex-1">
                    <h2 className="text-lg font-bold text-blue-400 arcade-font" style={scoreStyle.blue}>청팀 스코어</h2>
                    <p className="text-4xl font-bold text-blue-400 arcade-font mt-1" style={scoreStyle.blue}>{scores.blue}</p>
                </div>
                <div className="text-4xl font-bold text-gray-400 arcade-font">:</div>
                <div className="flex-1">
                    <h2 className="text-lg font-bold text-gray-200 arcade-font" style={scoreStyle.white}>백팀 스코어</h2>
                    <p className="text-4xl font-bold text-gray-200 arcade-font mt-1" style={scoreStyle.white}>{scores.white}</p>
                </div>
            </div>
        </section>
    );
};


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

    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [activeTab, setActiveTab] = useState('matching');

    const isAdmin = currentUser && ADMIN_NAMES.includes(currentUser.name);
    const autoMatches = gameState?.autoMatches || {};

    const activePlayers = useMemo(() => {
        return Object.values(allPlayers).filter(p => p.status === 'active').reduce((acc, p) => {
            acc[p.id] = p;
            return acc;
        }, {});
    }, [allPlayers]);
    const inProgressPlayerIds = useMemo(() => {
        if (!gameState?.inProgressCourts) return new Set();
        return new Set(
            gameState.inProgressCourts
                .filter(court => court && court.players) 
                .flatMap(court => court.players)       
                .filter(playerId => playerId)             
        );
    }, [gameState]);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
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
            if (err.message.includes("다른 관리자에 의해 슬롯이 이미 채워졌습니다.")) {
                console.log("Slot already filled, operation cancelled silently.");
            } else {
                setModal({ type: 'alert', data: { title: '작업 실패', body: customErrorMessage || err.message }});
            }
        }
    }, []);
    const playerLocations = useMemo(() => {
        if (!gameState) return {};
        return calculateLocations(gameState, activePlayers);
    }, [gameState, activePlayers]);
    const findPlayerLocation = useCallback((playerId) => playerLocations[playerId] || { location: 'waiting' }, [playerLocations]);
    const handleReturnToWaiting = useCallback(async (player) => {
        const loc = findPlayerLocation(player.id);
        if (!loc || loc.location === 'waiting') return;

        const updateFunction = (currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            if (loc.location === 'schedule') {
                newState.scheduledMatches[String(loc.matchIndex)][loc.slotIndex] = null;
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
    
    // --- 청백전 수정 --- : 선수 교환 로직에 팀 제약 조건 추가
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
                // 선수 교환(swap) 로직
                const playerA = allPlayers[firstSelectedId];
                const playerB = allPlayers[playerId];
                
                // --- 청백전 수정 --- : 다른 팀 선수와는 교환 불가
                if (playerA && playerB && playerA.gender !== playerB.gender) {
                    setModal({ type: 'alert', data: { title: '교환 불가', body: '다른 팀 선수와는 자리를 바꿀 수 없습니다.' }});
                    setSelectedPlayerIds([]);
                    return;
                }

                const updateFunction = (currentState) => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    const getValue = (l) => l.location === 'schedule' ? newState.scheduledMatches[String(l.matchIndex)][l.slotIndex] : null;
                    const setValue = (l, value) => {
                        if (l.location === 'schedule') newState.scheduledMatches[String(l.matchIndex)][l.slotIndex] = value;
                    };
                    
                    if(firstSelectedLoc.location !== 'schedule' || loc.location !== 'schedule') return { newState };

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
    }, [isAdmin, selectedPlayerIds, findPlayerLocation, updateGameState, courtMove, allPlayers]);
    
    // --- 청백전 수정 --- : 선수 배치 로직에 팀 제약 조건 추가
    const handleSlotClick = useCallback(async (context) => {
        if (!isAdmin || selectedPlayerIds.length === 0) return;

        const targetTeam = context.slotIndex < 2 ? '청' : '백';

        // 선택된 모든 선수가 타겟 팀과 일치하는지 확인
        const isTeamMismatch = selectedPlayerIds.some(id => {
            const player = allPlayers[id];
            return player && player.gender !== targetTeam;
        });

        if (isTeamMismatch) {
            setModal({ type: 'alert', data: { title: '배치 불가', body: `이곳에는 ${targetTeam}팀 선수만 배치할 수 있습니다.` }});
            return;
        }

        const updateFunction = (currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            const currentLocations = calculateLocations(newState, activePlayers);
            const areAllFromWaiting = selectedPlayerIds.every(id => currentLocations[id]?.location === 'waiting');

            if (areAllFromWaiting) {
                const playersToMove = [...selectedPlayerIds];
                let targetArray = newState.scheduledMatches[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                
                const isSlotOccupied = targetArray.some((p, i) => p !== null && playersToMove.length > 0 && targetArray[i] === null);
                if (isSlotOccupied) {
                   console.log("Slot was filled by another admin. Aborting move.");
                   return { newState: currentState };
                }

                const availableSlots = targetArray.filter((p, i) => {
                    const slotTeam = i < 2 ? '청' : '백';
                    return p === null && slotTeam === targetTeam;
                }).length;
                
                if (playersToMove.length > availableSlots) {
                    throw new Error(`${targetTeam}팀에 자리가 부족합니다. (${availableSlots}자리 남음)`);
                }
                
                for (let i = 0; i < PLAYERS_PER_MATCH && playersToMove.length > 0; i++) {
                    const slotTeam = i < 2 ? '청' : '백';
                    if (targetArray[i] === null && slotTeam === targetTeam) {
                        targetArray[i] = playersToMove.shift();
                    }
                }
                newState.scheduledMatches[String(context.matchIndex)] = targetArray;

            } else if (selectedPlayerIds.length === 1) {
                const playerId = selectedPlayerIds[0];
                const sourceLocation = currentLocations[playerId];
                if (!sourceLocation || sourceLocation.location !== 'schedule') return { newState };

                // 같은 팀 내에서의 이동만 허용
                const sourceTeam = sourceLocation.slotIndex < 2 ? '청' : '백';
                if (sourceTeam !== targetTeam) {
                    throw new Error('다른 팀으로는 이동할 수 없습니다.');
                }
                
                newState.scheduledMatches[String(sourceLocation.matchIndex)][sourceLocation.slotIndex] = null;
                let destArray = newState.scheduledMatches[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);

                if (destArray[context.slotIndex]) {
                    newState.scheduledMatches[String(sourceLocation.matchIndex)][sourceLocation.slotIndex] = destArray[context.slotIndex];
                }
                destArray[context.slotIndex] = playerId;
                newState.scheduledMatches[String(context.matchIndex)] = destArray;
            }
            return { newState };
        };

        try {
            await updateGameState(updateFunction, '선수를 경기에 배정하는 데 실패했습니다.');
            setSelectedPlayerIds([]);
        } catch (error) {
            setModal({ type: 'alert', data: { title: '오류', body: error.message } });
        }
    }, [isAdmin, selectedPlayerIds, activePlayers, updateGameState, allPlayers]);
    
    const handleStartMatch = useCallback(async (matchIndex) => {
        if (!gameState) return;
        const match = gameState.scheduledMatches[String(matchIndex)] || [];
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
                const currentMatch = currentState.scheduledMatches[String(matchIndex)] || [];
                if(currentMatch.filter(p=>p).length !== PLAYERS_PER_MATCH) {
                    throw new Error("경기를 시작할 수 없습니다. 다른 관리자가 먼저 시작했을 수 있습니다.");
                }

                const newState = JSON.parse(JSON.stringify(currentState));
                const playersToMove = [...newState.scheduledMatches[String(matchIndex)]];
                
                newState.inProgressCourts[courtIndex] = { players: playersToMove, startTime: new Date().toISOString() };
                for (let i = matchIndex; i < newState.numScheduledMatches - 1; i++) {
                    newState.scheduledMatches[String(i)] = newState.scheduledMatches[String(i + 1)] || Array(PLAYERS_PER_MATCH).fill(null);
                }
                newState.scheduledMatches[String(newState.numScheduledMatches - 1)] = Array(PLAYERS_PER_MATCH).fill(null);
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
            updatedData.todayRecentGames = [gameRecord, ...(player.todayRecentGames || [])].slice(0, 10);

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
    const handleAutoMatchGenerate = useCallback((targetGames) => {
        setModal({ type: 'alert', data: { title: '🤖', body: '자동 매칭을 생성하고 있습니다...' } });
    
        const targetPlayers = Object.values(activePlayers);
        
        const malePlayers = targetPlayers.filter(p => p.gender === '남');
        const femalePlayers = targetPlayers.filter(p => p.gender === '여');

        const generateMatchesForGender = (players, numGames) => {
            if (players.length < 4) return [];

            const sortedPlayers = [...players].sort((a, b) => {
                const gamesA = (a.todayWins || 0) + (a.todayLosses || 0);
                const gamesB = (b.todayWins || 0) + (b.todayLosses || 0);
                if (gamesA !== gamesB) {
                    return gamesA - gamesB;
                }
                return new Date(a.entryTime) - new Date(b.entryTime);
            });

            const availablePlayerIds = sortedPlayers.map(p => p.id);
            const playerGameCounts = availablePlayerIds.reduce((acc, pId) => ({ ...acc, [pId]: 0 }), {});
            const generatedMatches = [];

            let availablePool = [...availablePlayerIds];
            while (true) {
                let tempPool = availablePool.filter(pId => playerGameCounts[pId] < numGames);
                if (tempPool.length < 4) break;

                const match = tempPool.slice(0, 4);
                generatedMatches.push(match);
                match.forEach(pId => {
                    playerGameCounts[pId]++;
                });
                availablePool.sort((a, b) => playerGameCounts[a] - playerGameCounts[b]);
            }
            
            return generatedMatches;
        };
    
        const maleMatches = generateMatchesForGender(malePlayers, targetGames);
        const femaleMatches = generateMatchesForGender(femalePlayers, targetGames);
        
        const allGeneratedMatches = [...maleMatches, ...femaleMatches];
        updateGameState(currentState => {
            const existingMatches = currentState.autoMatches ? Object.values(currentState.autoMatches) : [];
            const newTotalMatches = [...existingMatches, ...allGeneratedMatches];
            const newMatchesObject = newTotalMatches.reduce((acc, match, index) => {
                acc[String(index)] = match;
                return acc;
            }, {});
            
            const newState = { ...currentState, autoMatches: newMatchesObject };
            return { newState };
        });
        setModal({ type: null, data: null });
    }, [activePlayers, updateGameState]);
    
    const handleStartAutoMatch = useCallback(async (matchIndex) => {
        const matchToStart = gameState?.autoMatches ? gameState.autoMatches[matchIndex] : null;
        if (!matchToStart) return;
        
        const isAnyPlayerBusy = matchToStart.some(playerId => inProgressPlayerIds.has(playerId));
        if (isAnyPlayerBusy) {
            setModal({ type: 'alert', data: { title: '시작 불가', body: '선수가 이미 경기중입니다.' } });
            return;
        }

        const emptyCourts = [];
        for (let i = 0; i < (gameState?.numInProgressCourts || 0); i++) {
            if (!gameState.inProgressCourts[i]) {
                emptyCourts.push(i);
            }
        }
        if (emptyCourts.length === 0) {
            setModal({ type: 'alert', data: { title: "시작 불가", body: "빈 코트가 없습니다." } });
            return;
        }
    
        const start = async (courtIndex) => {
            await updateGameState((currentState) => {
                const newState = JSON.parse(JSON.stringify(currentState));
                const currentMatchToStart = newState.autoMatches ? newState.autoMatches[matchIndex] : null;

                if (!currentMatchToStart || currentMatchToStart.length !== 4) {
                     throw new Error("매칭 정보가 올바르지 않습니다.");
                }

                newState.inProgressCourts[courtIndex] = { players: currentMatchToStart, startTime: new Date().toISOString() };
                delete newState.autoMatches[matchIndex];
                const reindexedMatches = {};
                Object.values(newState.autoMatches).forEach((m, i) => {
                    reindexedMatches[String(i)] = m;
                });
                newState.autoMatches = reindexedMatches;

                return { newState };
            }, "자동 매칭 경기를 시작하지 못했습니다.");
            setModal({type:null, data:null});
        };
        if (emptyCourts.length === 1) {
            start(emptyCourts[0]);
        } else {
            setModal({ type: 'courtSelection', data: { courts: emptyCourts, onSelect: start } });
        }
    }, [gameState, updateGameState, inProgressPlayerIds]);

    const handleRemoveFromAutoMatch = useCallback((matchIndex, slotIndex, player) => {
        if (!player) return;

        setModal({
            type: 'confirm',
            data: {
                title: '선수 내보내기',
                body: `${player.name} 선수를 자동 매칭에서 내보낼까요?`,
                onConfirm: () => {
                    updateGameState(currentState => {
                        const newState = JSON.parse(JSON.stringify(currentState));
                        if (newState.autoMatches && newState.autoMatches[matchIndex]) {
                            newState.autoMatches[matchIndex][slotIndex] = null;
                        }
                        return { newState };
                    });
                    setModal({ type: null, data: null });
                }
            }
        });
    }, [updateGameState]);
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

        if (!selectedAutoMatchSlot) {
            setSelectedAutoMatchSlot({ matchIndex, slotIndex });
        } else {
            if (selectedAutoMatchSlot.matchIndex === matchIndex && selectedAutoMatchSlot.slotIndex === slotIndex) {
                setSelectedAutoMatchSlot(null);
                return;
            }

            await updateGameState(currentState => {
                const newState = JSON.parse(JSON.stringify(currentState));
                const { autoMatches } = newState;
                
                const source = selectedAutoMatchSlot;
                const target = { matchIndex, slotIndex };

                const playerA = autoMatches[source.matchIndex][source.slotIndex];
                const playerB = autoMatches[target.matchIndex][target.slotIndex];

                autoMatches[source.matchIndex][source.slotIndex] = playerB;
                autoMatches[target.matchIndex][target.slotIndex] = playerA;

                return { newState };
            }, "선수 교체에 실패했습니다.");

            setSelectedAutoMatchSlot(null);
        }
    }, [isAdmin, selectedAutoMatchSlot, updateGameState]);
    const handleAutoMatchSlotClick = useCallback(async (matchIndex, slotIndex) => {
        if (!isAdmin || selectedPlayerIds.length !== 1) return;

        const playerId = selectedPlayerIds[0];
        const playerLoc = findPlayerLocation(playerId);

        if (playerLoc.location !== 'waiting') {
            setModal({ type: 'alert', data: { title: '오류', body: '대기 명단에 있는 선수만 추가할 수 있습니다.' } });
            setSelectedPlayerIds([]);
            return;
        }

        await updateGameState(currentState => {
            const newState = JSON.parse(JSON.stringify(currentState));
            if (newState.autoMatches && newState.autoMatches[String(matchIndex)]) {
                if (newState.autoMatches[String(matchIndex)][slotIndex] === null) {
                    newState.autoMatches[String(matchIndex)][slotIndex] = playerId;
                } else {
                    throw new Error("다른 관리자에 의해 슬롯이 이미 채워졌습니다.");
                }
            }
            return { newState };
        }, '자동 매칭에 선수를 추가하지 못했습니다.');

        setSelectedPlayerIds([]);
    }, [isAdmin, selectedPlayerIds, findPlayerLocation, updateGameState]);
    const handleClearScheduledMatches = useCallback(() => {
        setModal({ type: 'confirm', data: { 
            title: '전체 삭제', 
            body: '모든 예정 경기를 삭제할까요?',
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
            body: `${matchIndex + 1}번 예정 경기를 삭제할까요?`,
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
                    wins: 0, losses: 0, rp: 0,
                    attendanceCount: 0, winStreak: 0, winStreakCount: 0,
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

    const handleSettingsUpdate = useCallback(async (settings) => {
        try {
            const { scheduled, courts, announcement, pointSystemInfo } = settings;
            
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
                transaction.set(configRef, { announcement, pointSystemInfo }, { merge: true });
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
            await updateDoc(playerDocRef, { isResting: newRestingState });
        } catch (error) {
            setModal({ type: 'alert', data: { title: '오류', body: '휴식 상태 변경에 실패했습니다.' }});
        }
    }, [currentUser]);
    const waitingPlayers = useMemo(() => Object.values(activePlayers)
        .filter(p => playerLocations[p.id]?.location === 'waiting')
        .sort((a, b) => {
            const levelA = LEVEL_ORDER[a.level] || 99;
            const levelB = LEVEL_ORDER[b.level] || 99;
            if (levelA !== levelB) return levelA - levelB;
            return new Date(a.entryTime) - new Date(b.entryTime);
        }), [activePlayers, playerLocations]);
    
    const blueWaitingPlayers = useMemo(() => waitingPlayers.filter(p => p.gender === '청'), [waitingPlayers]);
    const whiteWaitingPlayers = useMemo(() => waitingPlayers.filter(p => p.gender === '백'), [waitingPlayers]);

    const teamScores = useMemo(() => {
        return Object.values(activePlayers).reduce((scores, player) => {
            const wins = player.todayWins || 0;
            if (player.gender === '청') {
                scores.blue += wins;
            } else if (player.gender === '백') {
                scores.white += wins;
            }
            return scores;
        }, { blue: 0, white: 0 });
    }, [activePlayers]);

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
            {modal?.type === 'autoMatchSetup' && <AutoMatchSetupModal onCancel={() => setModal({ type: null, data: null })} onConfirm={handleAutoMatchGenerate} />}
            
            {isSettingsOpen && <SettingsModal 
                isAdmin={isAdmin}
                scheduledCount={gameState.numScheduledMatches} 
                courtCount={gameState.numInProgressCourts}
                seasonConfig={seasonConfig}
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
                            <button onClick={() => setModal({ type: 'autoMatchSetup' })} className="text-gray-400 hover:text-white text-lg px-1">
                                <i className="fas fa-robot"></i>
                            </button>
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
                                        <TeamScoreboard scores={teamScores} />
                                        <WaitingListSection blueWaitingPlayers={blueWaitingPlayers} whiteWaitingPlayers={whiteWaitingPlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleDeleteFromWaiting={handleDeleteFromWaiting} setModal={setModal} currentUser={currentUser} inProgressPlayerIds={inProgressPlayerIds} />
                                        {Object.keys(autoMatches).length > 0 && <AutoMatchesSection autoMatches={autoMatches} players={activePlayers} isAdmin={isAdmin} handleStartAutoMatch={handleStartAutoMatch} handleRemoveFromAutoMatch={handleRemoveFromAutoMatch} handleClearAutoMatches={handleClearAutoMatches} handleDeleteAutoMatch={handleDeleteAutoMatch} currentUser={currentUser} handleAutoMatchCardClick={handleAutoMatchCardClick} selectedAutoMatchSlot={selectedAutoMatchSlot} inProgressPlayerIds={inProgressPlayerIds} handleAutoMatchSlotClick={handleAutoMatchSlotClick}/>}
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
                            <TeamScoreboard scores={teamScores} />
                            <WaitingListSection blueWaitingPlayers={blueWaitingPlayers} whiteWaitingPlayers={whiteWaitingPlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleDeleteFromWaiting={handleDeleteFromWaiting} setModal={setModal} currentUser={currentUser} inProgressPlayerIds={inProgressPlayerIds} />
                            {Object.keys(autoMatches).length > 0 && <AutoMatchesSection autoMatches={autoMatches} players={activePlayers} isAdmin={isAdmin} handleStartAutoMatch={handleStartAutoMatch} handleRemoveFromAutoMatch={handleRemoveFromAutoMatch} handleClearAutoMatches={handleClearAutoMatches} handleDeleteAutoMatch={handleDeleteAutoMatch} currentUser={currentUser} handleAutoMatchCardClick={handleAutoMatchCardClick} selectedAutoMatchSlot={selectedAutoMatchSlot} inProgressPlayerIds={inProgressPlayerIds} handleAutoMatchSlotClick={handleAutoMatchSlotClick}/>}
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
                  0%, 100% { opacity: 1; text-shadow: 0 0 8px #FFD700; }
                  50% { opacity: 0.8; text-shadow: 0 0 12px #FFD700; }
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
    const [formData, setFormData] = useState({ name: '', level: 'A조', gender: '청', isGuest: false });
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
                        <label className="flex items-center cursor-pointer">
                            <input type="radio" name="gender" value="청" checked={formData.gender === '청'} onChange={handleChange} className="mr-2 h-4 w-4 text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" /> 
                            청팀
                        </label>
                        <label className="flex items-center cursor-pointer">
                            <input type="radio" name="gender" value="백" checked={formData.gender === '백'} onChange={handleChange} className="mr-2 h-4 w-4 text-gray-200 bg-gray-700 border-gray-600 focus:ring-gray-200" /> 
                            백팀
                        </label>
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
    const [rankingPeriod, setRankingPeriod] = useState('today');
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
                        <p className="text-gray-400">{player.level} / {player.gender}팀</p>
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

function SettingsModal({ isAdmin, scheduledCount, courtCount, seasonConfig, onSave, onCancel, setModal, onSystemReset }) {
    const [scheduled, setScheduled] = useState(scheduledCount);
    const [courts, setCourts] = useState(courtCount);
    const [announcement, setAnnouncement] = useState(seasonConfig.announcement);
    const [pointSystemInfo, setPointSystemInfo] = useState(seasonConfig.pointSystemInfo);
    const [isTesting, setIsTesting] = useState(false);
    if (!isAdmin) return null;

    const handleSave = () => {
        onSave({ scheduled, courts, announcement, pointSystemInfo });
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

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg text-white shadow-lg flex flex-col" style={{maxHeight: '90vh'}}>
                <h3 className="text-xl font-bold text-white mb-6 arcade-font text-center flex-shrink-0">설정</h3>
                <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                    <div className="bg-gray-700 p-3 rounded-lg">
                        <span className="font-semibold mb-2 block text-center">경기 예정 / 코트 수</span>
                        <div className="flex items-center justify-around">
                            <div className="text-center">
                                <p>예정</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => setScheduled(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                                    <span className="text-xl font-bold w-8 text-center">{scheduled}</span>
                                    <button onClick={() => setScheduled(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                                </div>
                            </div>
                            <div className="text-center">
                                <p>코트</p>
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

function AutoMatchSetupModal({ onConfirm, onCancel }) {
    const [games, setGames] = useState(3);
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-6 arcade-font">🤖 콕스타 자동매칭</h3>
                <label className="text-gray-300 mb-4 block">인당 몇 게임을 진행할까요?</label>
                <div className="flex items-center justify-center gap-4 mb-6">
                    <button onClick={() => setGames(g => Math.max(1, g - 1))} className="w-12 h-12 bg-gray-600 rounded-full text-2xl arcade-button">-</button>
                    <span className="text-4xl font-bold w-16 text-center arcade-font">{games}</span>
                    <button onClick={() => setGames(g => g + 1)} className="w-12 h-12 bg-gray-600 rounded-full text-2xl arcade-button">+</button>
                </div>
                <div className="flex gap-4">
                    <button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg">취소</button>
                    <button onClick={() => onConfirm(games)} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg">매칭 시작</button>
                </div>
            </div>
        </div>
    );
}
