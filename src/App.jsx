import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getFirestore, doc, getDoc, setDoc, onSnapshot, 
    collection, deleteDoc, updateDoc, writeBatch, runTransaction,
    query, getDocs, where
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from "firebase/functions";

// ===================================================================================
// Firebase & Service Logic (Integrated into one file)
// ===================================================================================

// --- 1. Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyCKT1JZ8MkA5WhBdL3XXxtm_0wLbnOBi5I",
  authDomain: "project-104956788310687609.firebaseapp.com",
  projectId: "project-104956788310687609",
  storageBucket: "project-104956788310687609.firebasestorage.app",
  messagingSenderId: "384562806148",
  appId: "1:384956788310687609:web:d8bfb83b28928c13e671d1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

const playersRef = collection(db, "players"); 
const gameStateRef = doc(db, "gameState", "live");
const configRef = doc(db, "config", "season");
const monthlyRankingsRef = collection(db, "monthlyRankings");
const notificationsRef = collection(db, "notifications");

// --- 2. Service Logic ---
let allPlayersData = {};
let gameStateData = null;
let seasonConfigData = null; 
const subscribers = new Set();

let resolveAllPlayers, resolveGameState, resolveSeasonConfig;
const allPlayersPromise = new Promise(resolve => { resolveAllPlayers = resolve; });
const gameStatePromise = new Promise(resolve => { resolveGameState = resolve; });
const seasonConfigPromise = new Promise(resolve => { resolveSeasonConfig = resolve; });
const readyPromise = Promise.all([allPlayersPromise, gameStatePromise, seasonConfigPromise]);

// --- 3. Firestore Listeners Setup (Optimized) ---

// [OPTIMIZATION] Step 1: Fetch ALL players ONCE at startup.
// This gives us a complete list for the ranking page, including inactive players.
(async () => {
    try {
        const querySnapshot = await getDocs(playersRef);
        const initialPlayers = {};
        querySnapshot.forEach(doc => {
            initialPlayers[doc.id] = doc.data();
        });
        allPlayersData = initialPlayers;
        if(resolveAllPlayers) { resolveAllPlayers(); resolveAllPlayers = null; }
        notifySubscribers();
    } catch (error) {
        console.error("Error fetching all players initially:", error);
    }
})();

// [OPTIMIZATION] Step 2: Set up a real-time listener ONLY for ACTIVE players.
const activePlayersQuery = query(playersRef, where("status", "==", "active"));
onSnapshot(activePlayersQuery, (snapshot) => {
    const currentActivePlayers = {};
    snapshot.forEach(doc => {
        currentActivePlayers[doc.id] = doc.data();
    });

    // Step 3: Intelligently merge the data to reduce reads.
    // Identify players who are no longer active by comparing with our master list.
    Object.keys(allPlayersData).forEach(playerId => {
        const player = allPlayersData[playerId];
        // If a player was previously active but is NOT in the new active snapshot...
        if (player && player.status === 'active' && !currentActivePlayers[playerId]) {
            // ...update their status locally to 'inactive' without a new read.
            allPlayersData[playerId].status = 'inactive';
        }
    });

    // Now, merge the fresh data for all currently active players into our master list.
    Object.assign(allPlayersData, currentActivePlayers);

    // Notify the UI to re-render with the updated data.
    notifySubscribers();
}, (error) => {
    console.error("Error with active players listener:", error);
});


onSnapshot(gameStateRef, (doc) => {
  if (doc.exists()) {
    gameStateData = doc.data();
  } else {
    gameStateData = { 
        scheduledMatches: {}, 
        inProgressCourts: Array(4).fill(null),
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
            pointSystemInfo: "- 참석: +20 RP (3경기 완료시)\n- 승리: +30 RP\n- 패배: +10 RP\n- 연승 횟수 1회당: +20 RP"
        };
    }
    if(resolveSeasonConfig) { resolveSeasonConfig(); resolveSeasonConfig = null; }
    notifySubscribers();
});

function notifySubscribers() {
  subscribers.forEach(callback => callback());
}

// --- 4. Service Object ---
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
// Constants & Helper Functions
// ===================================================================================
const ADMIN_NAMES = ["나채빈", "정형진", "윤지혜", "이상민", "이정문", "신영은", "오미리"];
const PLAYERS_PER_MATCH = 4;
const RP_CONFIG = {
    ATTENDANCE: 20,
    WIN: 30,
    LOSS: 10,
    WIN_STREAK_BONUS: 20, // 연승 '횟수' 1회당 보너스 점수
};

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
// Child Components
// ===================================================================================
const PlayerCard = React.memo(({ player, context, isAdmin, onCardClick, onAction, onLongPress, isCurrentUser, isMovable = true, isSelectedForWin = false }) => {
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
    const actionLabel = isWaiting ? '선수 내보내기' : '대기자로 이동';
    
    const todayWins = player.todayWins || 0;
    const todayLosses = player.todayLosses || 0;

    return (
        <div 
            ref={cardRef}
            className={`player-card p-1 rounded-md relative flex flex-col justify-center text-center h-14 ${player.isResting ? 'filter grayscale' : ''} ${!isMovable ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            style={cardStyle}
            onClick={isMovable && onCardClick ? () => onCardClick(player.id) : null}
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
            {isAdmin && isMovable && (
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

const WaitingListSection = React.memo(({ maleWaitingPlayers, femaleWaitingPlayers, selectedPlayerIds, isAdmin, handleCardClick, handleDeleteFromWaiting, setModal, currentUser }) => {
    return (
        <section className="bg-gray-800/50 rounded-lg p-2">
            <h2 className="text-sm font-bold mb-2 text-yellow-400 arcade-font flicker-text">대기 명단 ({maleWaitingPlayers.length + femaleWaitingPlayers.length})</h2>
            <div className="grid grid-cols-4 gap-1.5">
                {maleWaitingPlayers.map(player => ( <PlayerCard key={player.id} player={player} context={{ location: null, selected: selectedPlayerIds.includes(player.id) }} isAdmin={isAdmin} onCardClick={handleCardClick} onAction={handleDeleteFromWaiting} onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})} isCurrentUser={currentUser && player.id === currentUser.id}/> ))}
                {femaleWaitingPlayers.map(player => ( <PlayerCard key={player.id} player={player} context={{ location: null, selected: selectedPlayerIds.includes(player.id) }} isAdmin={isAdmin} onCardClick={handleCardClick} onAction={handleDeleteFromWaiting} onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})} isCurrentUser={currentUser && player.id === currentUser.id}/> ))}
            </div>
        </section>
    );
});

const ScheduledMatchesSection = React.memo(({ numScheduledMatches, scheduledMatches, players, selectedPlayerIds, isAdmin, handleCardClick, handleReturnToWaiting, setModal, handleSlotClick, handleStartMatch, currentUser }) => {
    return (
        <section>
            <h2 className="text-lg font-bold mb-2 text-cyan-400 px-1 arcade-font">경기 예정</h2>
            <div id="scheduled-matches" className="flex flex-col gap-2">
                {Array.from({ length: numScheduledMatches }).map((_, matchIndex) => {
                    const match = scheduledMatches[String(matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                    const playerCount = match.filter(p => p).length;
                    return (
                        <div key={`schedule-${matchIndex}`} className="flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1">
                            <div className="flex-shrink-0 w-6 text-center">
                                <p className="font-bold text-lg text-white arcade-font">{matchIndex + 1}</p>
                            </div>
                            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                {Array(PLAYERS_PER_MATCH).fill(null).map((_, slotIndex) => {
                                    const playerId = match[slotIndex];
                                    const player = players[playerId];
                                    const context = {location: 'schedule', matchIndex, slotIndex, selected: selectedPlayerIds.includes(playerId)};
                                    return player ? ( <PlayerCard key={playerId} player={player} context={context} isAdmin={isAdmin} onCardClick={handleCardClick} onAction={handleReturnToWaiting} onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})} isCurrentUser={currentUser && player.id === currentUser.id} /> ) : ( <EmptySlot key={`schedule-empty-${matchIndex}-${slotIndex}`} onSlotClick={() => handleSlotClick({ location: 'schedule', matchIndex, slotIndex })} /> )
                                })}
                            </div>
                            <div className="flex-shrink-0 w-14 text-center">
                                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === PLAYERS_PER_MATCH && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== PLAYERS_PER_MATCH || !isAdmin} onClick={() => handleStartMatch(matchIndex)}>START</button>
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

    const activePlayers = useMemo(() => {
        return Object.values(allPlayers).filter(p => p.status === 'active').reduce((acc, p) => {
            acc[p.id] = p;
            return acc;
        }, {});
    }, [allPlayers]);

    useEffect(() => {
        if (!currentUser || currentUser.name !== '정형진') {
            if (resetNotification) setResetNotification(null);
            return;
        }
    
        const adminId = "정형진";
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

    }, [currentUser, resetNotification]);

    useEffect(() => {
        const initializeApp = async () => {
            await readyPromise;
            setAllPlayers(firebaseService.getAllPlayers()); 
            setGameState(firebaseService.getGameState());
            setSeasonConfig(firebaseService.getSeasonConfig());
            
            const savedUserId = localStorage.getItem('badminton-currentUser-id');
            const playersFromDB = firebaseService.getAllPlayers();
            if (savedUserId && playersFromDB[savedUserId] && playersFromDB[savedUserId].status === 'active') {
                setCurrentUser(playersFromDB[savedUserId]);
            } else if (savedUserId) {
                localStorage.removeItem('badminton-currentUser-id');
            }
            
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
                if (!gameStateDoc.exists()) throw new Error("Game state document does not exist!");
                
                const currentState = gameStateDoc.data();
                const { newState } = updateFunction(currentState);
                
                transaction.set(gameStateRef, newState);
            });
        } catch (err) {
            console.error("Transaction failed: ", err);
            setModal({ type: 'alert', data: { title: '작업 실패', body: customErrorMessage || err.message }});
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
                playerData = { 
                    ...docSnap.data(), 
                    level, 
                    gender, 
                    isGuest,
                    status: 'active',
                    todayWins: 0,
                    todayLosses: 0,
                    todayWinStreakCount: 0,
                    todayRecentGames: [],
                };
            } else {
                playerData = { 
                    id, name, level, gender, isGuest, 
                    entryTime: new Date().toISOString(), isResting: false,
                    status: 'active',
                    wins: 0, losses: 0, rp: 0, winStreak: 0,
                    attendanceCount: 0, recentGames: [], achievements: [],
                    todayWins: 0, todayLosses: 0, winStreakCount: 0,
                    todayWinStreakCount: 0, todayRecentGames: [],
                };
            }
            
            await setDoc(playerDocRef, playerData, { merge: true });
            setCurrentUser(playerData);
            localStorage.setItem('badminton-currentUser-id', id);
        } catch (error) {
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
    
    const handleCardClick = useCallback(async (playerId) => {
        const isAdmin = ADMIN_NAMES.includes(currentUser.name);
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
    }, [currentUser, selectedPlayerIds, findPlayerLocation, updateGameState, courtMove]);
    
    const handleSlotClick = useCallback(async (context) => {
        const isAdmin = ADMIN_NAMES.includes(currentUser.name);
        if (!isAdmin || selectedPlayerIds.length === 0) return;
        
        const updateFunction = (currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            const currentLocations = calculateLocations(newState, activePlayers);

            const areAllFromWaiting = selectedPlayerIds.every(id => currentLocations[id]?.location === 'waiting');

            if (areAllFromWaiting) {
                const playersToMove = [...selectedPlayerIds];
                let targetArray = newState.scheduledMatches[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);

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
                if (!sourceLocation || sourceLocation.location !== 'schedule') return { newState };

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

        await updateGameState(updateFunction, '선수를 경기에 배정하는 데 실패했습니다.');
        setSelectedPlayerIds([]);
    }, [currentUser, selectedPlayerIds, activePlayers, updateGameState]);
    
    const handleStartMatch = useCallback(async (matchIndex) => {
        if (!gameState) return;
        const match = gameState.scheduledMatches[String(matchIndex)] || [];
        if (match.filter(p => p).length !== PLAYERS_PER_MATCH) return;
        
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
            const playersToMove = gameState.scheduledMatches[String(matchIndex)].filter(Boolean);
            
            const updateFunction = (currentState) => {
                const newState = JSON.parse(JSON.stringify(currentState));
                
                newState.inProgressCourts[courtIndex] = { players: playersToMove, startTime: new Date().toISOString() };
                newState.scheduledMatches[String(matchIndex)] = Array(PLAYERS_PER_MATCH).fill(null);

                for (let i = matchIndex; i < newState.numScheduledMatches - 1; i++) {
                    newState.scheduledMatches[String(i)] = newState.scheduledMatches[String(i + 1)] || Array(PLAYERS_PER_MATCH).fill(null);
                }

                newState.scheduledMatches[String(newState.numScheduledMatches - 1)] = Array(PLAYERS_PER_MATCH).fill(null);
                
                return { newState };
            };

            await updateGameState(updateFunction, '경기를 시작하는 데 실패했습니다.');
            setModal({type:null, data:null});
        };

        if (emptyCourts.length === 1) { 
            start(emptyCourts[0]); 
        } else { 
            setModal({ type: 'courtSelection', data: { courts: emptyCourts, onSelect: start } }); 
        }
    }, [gameState, updateGameState]);

    const processMatchResult = useCallback(async (courtIndex, winningTeam) => {
        const court = gameState.inProgressCourts[courtIndex];
        if (!court) return;
        const allMatchPlayers = court.players;
    
        const batch = writeBatch(db);
    
        const winningPlayerNames = winningTeam.map(id => allPlayers[id].name);
        const losingTeam = allMatchPlayers.filter(id => !winningTeam.includes(id));
        const losingPlayerNames = losingTeam.map(id => allPlayers[id].name);
    
        allMatchPlayers.forEach(pId => {
            const player = allPlayers[pId];
            const isWinner = winningTeam.includes(pId);
    
            const updatedData = {
                todayWins: (player.todayWins || 0) + (isWinner ? 1 : 0),
                todayLosses: (player.todayLosses || 0) + (isWinner ? 0 : 1),
            };
    
            if (!player.isGuest) {
                const currentWinStreak = player.winStreak || 0;
                if (isWinner) {
                    const newWinStreak = currentWinStreak + 1;
                    updatedData.winStreak = newWinStreak;
                    if (newWinStreak >= 3) {
                        updatedData.todayWinStreakCount = (player.todayWinStreakCount || 0) + 1;
                    }
                } else {
                    updatedData.winStreak = 0;
                }
    
                const gameRecord = {
                    teammates: (isWinner ? winningPlayerNames.filter(name => name !== player.name) : losingPlayerNames.filter(name => name !== player.name)),
                    opponents: isWinner ? losingPlayerNames : winningPlayerNames,
                    result: isWinner ? '승' : '패',
                    timestamp: new Date().toISOString()
                };
    
                let recentGames = player.todayRecentGames || [];
                recentGames.unshift(gameRecord);
                if (recentGames.length > 10) {
                    recentGames = recentGames.slice(0, 10);
                }
                updatedData.todayRecentGames = recentGames;
            }
    
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
        } catch (e) {
            console.error(e);
            setModal({ type: 'alert', data: { title: '오류', body: '결과 처리에 실패했습니다.' } });
        }
        setModal({ type: null, data: null });
    }, [gameState, allPlayers, updateGameState]);

    const handleEndMatch = useCallback(async (courtIndex) => {
        const court = gameState.inProgressCourts[courtIndex];
        if (!court || !court.players || court.players.some(p=>!p)) return;
        
        const matchPlayers = court.players.map(pid => allPlayers[pid]);
        setModal({
            type: 'resultInput',
            data: {
                courtIndex,
                players: matchPlayers,
                onResultSubmit: processMatchResult,
            }
        });
    }, [gameState, allPlayers, processMatchResult]);
    
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
        .sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime)), [activePlayers, playerLocations]);
    
    const maleWaitingPlayers = useMemo(() => waitingPlayers.filter(p => p.gender === '남'), [waitingPlayers]);
    const femaleWaitingPlayers = useMemo(() => waitingPlayers.filter(p => p.gender === '여'), [waitingPlayers]);


    if (isLoading) {
        return <div className="bg-black text-white min-h-screen flex items-center justify-center font-sans p-4"><div className="text-yellow-400 arcade-font">LOADING...</div></div>;
    }

    if (!currentUser) {
        return <EntryPage onEnter={handleEnter} />;
    }

    const isAdmin = ADMIN_NAMES.includes(currentUser.name);

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
            {modal?.type === 'adminEditPlayer' && <AdminEditPlayerModal player={modal.data.player} mode={modal.data.mode} onClose={() => setModal({ type: null, data: null })} setModal={setModal} />}
            {modal?.type === 'pointSystemInfo' && <PointSystemModal content={modal.data.content} onClose={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'confirm' && <ConfirmationModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'courtSelection' && <CourtSelectionModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'alert' && <AlertModal {...modal.data} onClose={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'rankingHistory' && <RankingHistoryModal onCancel={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'matchHistory' && <MatchHistoryModal player={modal.data.player} onClose={() => setModal({ type: null, data: null })} />}
            
            {isSettingsOpen && <SettingsModal 
                isAdmin={isAdmin}
                scheduledCount={gameState.numScheduledMatches} 
                courtCount={gameState.numInProgressCourts}
                seasonConfig={seasonConfig}
                onSave={handleSettingsUpdate}
                onCancel={() => setIsSettingsOpen(false)} 
                setModal={setModal}
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
                        <button onClick={() => setIsSettingsOpen(true)} className="text-gray-400 hover:text-white text-lg px-1">
                            <i className="fas fa-cog"></i>
                        </button>
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
                    <>
                        <WaitingListSection
                            maleWaitingPlayers={maleWaitingPlayers}
                            femaleWaitingPlayers={femaleWaitingPlayers}
                            selectedPlayerIds={selectedPlayerIds}
                            isAdmin={isAdmin}
                            handleCardClick={handleCardClick}
                            handleDeleteFromWaiting={handleDeleteFromWaiting}
                            setModal={setModal}
                            currentUser={currentUser}
                        />
                        <ScheduledMatchesSection
                            numScheduledMatches={gameState.numScheduledMatches}
                            scheduledMatches={gameState.scheduledMatches}
                            players={activePlayers}
                            selectedPlayerIds={selectedPlayerIds}
                            isAdmin={isAdmin}
                            handleCardClick={handleCardClick}
                            handleReturnToWaiting={handleReturnToWaiting}
                            setModal={setModal}
                            handleSlotClick={handleSlotClick}
                            handleStartMatch={handleStartMatch}
                            currentUser={currentUser}
                        />
                        <InProgressCourtsSection
                            numInProgressCourts={gameState.numInProgressCourts}
                            inProgressCourts={gameState.inProgressCourts}
                            players={activePlayers}
                            isAdmin={isAdmin}
                            handleEndMatch={handleEndMatch}
                            currentUser={currentUser}
                            courtMove={courtMove}
                            setCourtMove={setCourtMove}
                            handleMoveOrSwapCourt={handleMoveOrSwapCourt}
                        />
                    </>
                ) : (
                    <RankingPage 
                        players={allPlayers} 
                        currentUser={currentUser} 
                        isAdmin={isAdmin}
                        onProfileClick={(player, rankingPeriod) => {
                            if (rankingPeriod === 'today') {
                                setModal({ type: 'matchHistory', data: { player }});
                            } else if (isAdmin) {
                                setModal({ type: 'adminEditPlayer', data: { player, mode: 'detailed' } });
                            } else {
                                setModal({ type: 'profile', data: { player } });
                            }
                        }}
                        onInfoClick={() => setModal({type: 'pointSystemInfo', data: { content: seasonConfig.pointSystemInfo }})}
                        onHistoryClick={() => setModal({ type: 'rankingHistory' })}
                        setModal={setModal}
                    />
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
// New and Restored Page/Modal Components
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
                    const todayWinStreakRp = (p.todayWinStreakCount || 0) * RP_CONFIG.WIN_STREAK_BONUS;
                    const todayRp = (todayWins * RP_CONFIG.WIN) + (todayLosses * RP_CONFIG.LOSS) + todayWinStreakRp;
                    return { ...p, todayRp, todayTotalGames: todayWins + todayLosses };
                })
                .filter(p => p.todayTotalGames > 0)
                .sort((a, b) => b.todayRp - a.todayRp);
        } else {
            playersToRank = playersToRank
                .filter(p => (p.wins || 0) > 0 || (p.losses || 0) > 0)
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
                                    <span className={`font-bold ${p.rank > 3 && isMonthly ? 'text-green-400' : ''}`}>{rp} RP</span> | {wins}승 {losses}패 ({winRate})
                                    {isMonthly && ` | ${attendanceCount}참`} | {winStreakCount}연승
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

function AdminEditPlayerModal({ player, mode, onClose, setModal }) {
    const isDetailedMode = mode === 'detailed';
    const [stats, setStats] = useState({
        todayWins: player.todayWins || 0,
        todayLosses: player.todayLosses || 0,
        wins: player.wins || 0,
        losses: player.losses || 0,
        winStreakCount: player.winStreakCount || 0
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setStats(prev => ({...prev, [name]: Number(value) }));
    };

    const handleSave = async () => {
        let finalStats = {};
        if (isDetailedMode) {
            const newRP = 
                (stats.wins * RP_CONFIG.WIN) +
                (stats.losses * RP_CONFIG.LOSS) +
                (player.attendanceCount || 0) * RP_CONFIG.ATTENDANCE +
                (stats.winStreakCount * RP_CONFIG.WIN_STREAK_BONUS);

            finalStats = {
                wins: stats.wins,
                losses: stats.losses,
                winStreakCount: stats.winStreakCount,
                rp: newRP
            };
        } else {
            finalStats = {
                todayWins: stats.todayWins,
                todayLosses: stats.todayLosses
            };
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

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md text-white shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font">{player.name} 기록 수정</h3>
                 <div className="space-y-4">
                    {isDetailedMode ? (
                        <>
                            <div className="flex items-center justify-between">
                                <label className="font-semibold text-cyan-400">이번달 승</label>
                                <input type="number" name="wins" value={stats.wins} onChange={handleChange} className="w-2/3 bg-gray-700 text-white p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400 text-right"/>
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="font-semibold text-cyan-400">이번달 패</label>
                                <input type="number" name="losses" value={stats.losses} onChange={handleChange} className="w-2/3 bg-gray-700 text-white p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400 text-right"/>
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="font-semibold text-cyan-400">연승 횟수</label>
                                <input type="number" name="winStreakCount" value={stats.winStreakCount} onChange={handleChange} className="w-2/3 bg-gray-700 text-white p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400 text-right"/>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center justify-between">
                                <label className="font-semibold">오늘의 승</label>
                                <input type="number" name="todayWins" value={stats.todayWins} onChange={handleChange} className="w-2/3 bg-gray-700 text-white p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 text-right"/>
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="font-semibold">오늘의 패</label>
                                <input type="number" name="todayLosses" value={stats.todayLosses} onChange={handleChange} className="w-2/3 bg-gray-700 text-white p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 text-right"/>
                            </div>
                        </>
                    )}
                </div>
                {isDetailedMode && (
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

function SettingsModal({ isAdmin, scheduledCount, courtCount, seasonConfig, onSave, onCancel, setModal }) {
    const [scheduled, setScheduled] = useState(scheduledCount);
    const [courts, setCourts] = useState(courtCount);
    const [announcement, setAnnouncement] = useState(seasonConfig.announcement);
    const [pointSystemInfo, setPointSystemInfo] = useState(seasonConfig.pointSystemInfo);
    const [isTesting, setIsTesting] = useState(false);

    if (!isAdmin) return null;

    const handleSave = () => {
        onSave({ scheduled, courts, announcement, pointSystemInfo });
    };
    
    const handleTestMonthlyArchive = () => {
        setModal({ type: 'confirm', data: { 
            title: '월간 랭킹 저장 테스트', 
            body: '현재 랭킹을 기준으로 "지난달" 랭킹 저장 및 알림 기능을 테스트합니다. 실제 데이터가 생성됩니다. 실행하시겠습니까?',
            onConfirm: async () => {
                setIsTesting(true);
                setModal({ type: null, data: null });
                try {
                    const testArchive = httpsCallable(functions, 'testMonthlyArchive');
                    const result = await testArchive();
                    setModal({ type: 'alert', data: { 
                        title: '테스트 완료', 
                        body: result.data.message
                    }});
                } catch (error) {
                    console.error("Test function call failed:", error);
                    setModal({ type: 'alert', data: { 
                        title: '테스트 실패', 
                        body: 'Cloud Function 호출에 실패했습니다. 콘솔 로그를 확인해주세요.'
                    }});
                } finally {
                    setIsTesting(false);
                }
            }
        }});
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg text-white shadow-lg">
                <h3 className="text-xl font-bold text-white mb-6 arcade-font">설정</h3>
                <div className="space-y-4">
                    <div className="flex items-center justify-between bg-gray-700 p-3 rounded-lg">
                        <span className="font-semibold">경기 예정</span>
                        <div className="flex items-center gap-4">
                            <button onClick={() => setScheduled(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                            <span className="text-xl font-bold w-8 text-center">{scheduled}</span>
                            <button onClick={() => setScheduled(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                        </div>
                    </div>
                    <div className="flex items-center justify-between bg-gray-700 p-3 rounded-lg">
                        <span className="font-semibold">경기 진행 코트</span>
                        <div className="flex items-center gap-4">
                            <button onClick={() => setCourts(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                            <span className="text-xl font-bold w-8 text-center">{courts}</span>
                            <button onClick={() => setCourts(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
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
                    <div className="bg-gray-700 p-3 rounded-lg">
                        <label className="font-semibold mb-2 block">고급 기능 테스트</label>
                        <button onClick={handleTestMonthlyArchive} disabled={isTesting} className="w-full arcade-button bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg disabled:bg-gray-500 disabled:cursor-not-allowed">
                            {isTesting ? '테스트 중...' : '월간 랭킹 저장 테스트'}
                        </button>
                    </div>
                </div>
                <div className="mt-6 flex gap-4">
                     <button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 font-bold py-2 rounded-lg">취소</button>
                    <button onClick={handleSave} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg">저장</button>
                </div>
            </div>
        </div>
    );
}

function ConfirmationModal({ title, body, onConfirm, onCancel }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-white mb-4">{title}</h3><p className="text-gray-300 mb-6">{body}</p><div className="flex gap-4"><button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button><button onClick={onConfirm} className="w-full arcade-button bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg transition-colors">확인</button></div></div></div>); }
function CourtSelectionModal({ courts, onSelect, onCancel }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font">코트 선택</h3><p className="text-gray-300 mb-6">경기를 시작할 코트를 선택해주세요.</p><div className="flex flex-col gap-3">{courts.map(courtIdx => ( <button key={courtIdx} onClick={() => onSelect(courtIdx)} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors">{courtIdx + 1}번 코트</button> ))}</div><button onClick={onCancel} className="mt-6 w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button></div></div> ); }
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

function MatchHistoryModal({ player, onClose }) {
    const games = player.todayRecentGames || [];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md text-white shadow-lg flex flex-col gap-4">
                <div className="flex justify-between items-start">
                    <h3 className="text-2xl font-bold text-yellow-400 arcade-font">{player.name} 전적</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white">&times;</button>
                </div>
                
                <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                    {games.length > 0 ? games.map((game, index) => {
                        const isWin = game.result === '승';
                        const playerTeam = [player.name, ...game.teammates].join(', ');
                        const opponentTeam = game.opponents.join(', ');

                        return (
                            <div key={index} className={`p-3 rounded-lg ${isWin ? 'bg-blue-900/50' : 'bg-red-900/50'}`}>
                                <div className="flex justify-between items-center text-sm">
                                    <div className="flex-1">
                                        <p className={`font-bold ${isWin ? 'text-blue-300' : 'text-gray-300'}`}>{playerTeam}</p>
                                        <p className="text-xs text-gray-400">vs</p>
                                        <p className={`font-bold ${!isWin ? 'text-red-300' : 'text-gray-300'}`}>{opponentTeam}</p>
                                    </div>
                                    <div className={`text-lg font-extrabold arcade-font ${isWin ? 'text-blue-400' : 'text-red-400'}`}>
                                        {isWin ? 'WIN' : 'LOSE'}
                                    </div>
                                </div>
                            </div>
                        );
                    }) : (
                        <p className="text-center text-gray-500">오늘 경기 기록이 없습니다.</p>
                    )}
                </div>
            </div>
        </div>
    );
}

