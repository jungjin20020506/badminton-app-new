import React, 'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef' } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getFirestore, doc, getDoc, setDoc, onSnapshot, 
    collection, deleteDoc, updateDoc, writeBatch, runTransaction,
    query, getDocs, where, FieldValue, increment
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from "firebase/functions";

// ===================================================================================
// Firebase & Service Logic
// ===================================================================================

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

// ===================================================================================
// 상수 및 Helper 함수
// ===================================================================================
const ADMIN_NAMES = ["나채빈", "정형진", "윤지혜", "이상민", "이정문", "신영은", "오미리"];
const PLAYERS_PER_MATCH = 4;
const RP_CONFIG = { WIN: 30, LOSS: 10, ATTENDANCE: 20, WIN_STREAK_BONUS: 20 };
const LEVEL_ORDER = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 5 };

const getLevelColor = (level, isGuest) => {
    if (isGuest) return '#00BFFF';
    switch (level) {
        case 'A조': return '#FF4F4F'; case 'B조': return '#FF9100';
        case 'C조': return '#FFD600'; case 'D조': return '#00E676';
        default: return '#A1A1AA';
    }
};

const generateSchedule = (players, gamesPerPlayer) => {
    const createBalancedMatches = (playerList, gamesPerPlayer) => {
        if (playerList.length < 4) return [];
        const totalPlayerSlots = playerList.length * gamesPerPlayer;
        const totalMatches = Math.floor(totalPlayerSlots / 4);
        let schedule = [];
        const playerGameCounts = playerList.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {});

        for (let i = 0; i < totalMatches; i++) {
            const sortedPlayers = [...playerList].sort((a, b) => playerGameCounts[a.id] - playerGameCounts[b.id] || Math.random() - 0.5);
            const matchPlayers = sortedPlayers.slice(0, 4);
            if (matchPlayers.length < 4) continue;

            const pairings = [
                [[matchPlayers[0], matchPlayers[1]], [matchPlayers[2], matchPlayers[3]]],
                [[matchPlayers[0], matchPlayers[2]], [matchPlayers[1], matchPlayers[3]]],
                [[matchPlayers[0], matchPlayers[3]], [matchPlayers[1], matchPlayers[2]]],
            ];
            let bestPairing = pairings[0];
            let minScore = Infinity;
            pairings.forEach(p => {
                const s = (p[0][0].partnerHistory?.[p[0][1].id] || 0) + (p[1][0].partnerHistory?.[p[1][1].id] || 0);
                if (s < minScore) { minScore = s; bestPairing = p; }
            });
            const finalMatch = [...bestPairing[0], ...bestPairing[1]].map(p => p.id);
            schedule.push({ players: finalMatch });
            finalMatch.forEach(id => playerGameCounts[id]++);
        }
        return schedule;
    };
    const malePlayers = players.filter(p => p.gender === '남');
    const femalePlayers = players.filter(p => p.gender === '여');
    const maleSchedule = createBalancedMatches(malePlayers, gamesPerPlayer);
    const femaleSchedule = createBalancedMatches(femalePlayers, gamesPerPlayer);
    return [...maleSchedule, ...femaleSchedule];
};


// ===================================================================================
// 자식 컴포넌트들
// ===================================================================================
const PlayerCard = React.memo(({ player, context, isAdmin, onCardClick, onAction, isCurrentUser, isMovable = true, isSelected = false, isSelectedForWin = false }) => {
    const genderStyle = { boxShadow: `inset 4px 0 0 0 ${player.gender === '남' ? '#3B82F6' : '#EC4899'}` };
    const adminIcon = ADMIN_NAMES.includes(player.name) ? '👑' : '';
    const levelColor = getLevelColor(player.level, player.isGuest);
    const cardStyle = { ...genderStyle, borderWidth: '1px', borderStyle: 'solid', borderColor: 'transparent', transition: 'all 0.2s ease-in-out', backgroundColor: '#2d3748' };
    if (isSelected || isSelectedForWin) { cardStyle.borderColor = '#34d399'; cardStyle.transform = 'scale(1.1)'; cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 15px 5px rgba(52, 211, 153, 0.9)`; }
    if (isCurrentUser) { cardStyle.borderColor = '#FBBF24'; cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 12px 4px rgba(251, 191, 36, 0.9)`; }
    
    return (
        <div className={`player-card p-1 rounded-md relative flex flex-col justify-center text-center h-14 w-full ${player.isResting ? 'filter grayscale' : ''}`} style={cardStyle} onClick={isMovable && onCardClick ? onCardClick : null} >
            <div>
                <div className="player-name text-white text-xs font-bold whitespace-nowrap leading-tight tracking-tighter">{adminIcon}{player.name}</div>
                <div className="player-info text-gray-400 text-[10px] leading-tight mt-px whitespace-nowrap">
                    <span style={{ color: levelColor, fontWeight: 'bold', fontSize: '14px', textShadow: `0 0 5px ${levelColor}` }}>{player.level.replace('조','')}</span>|{player.todayWins || 0}승 {player.todayLosses || 0}패
                </div>
            </div>
            {isAdmin && isMovable && context.location === 'manual' && (
                <button onClick={(e) => { e.stopPropagation(); onAction(player); }} className={`absolute -top-2 -right-2 p-1 text-gray-500 hover:text-yellow-400`}><i className={"fas fa-times-circle fa-xs"}></i></button>
            )}
        </div>
    );
});
const EmptySlot = ({ onSlotClick }) => ( <div className="player-slot h-14 bg-black/30 rounded-md flex items-center justify-center text-gray-600 border-2 border-dashed border-gray-700 cursor-pointer hover:bg-gray-700/50 hover:border-yellow-400 transition-all" onClick={onSlotClick}><span className="text-xl font-bold">+</span></div> );
const CourtTimer = ({ court }) => {
    const [time, setTime] = useState('00:00');
    useEffect(() => {
        if (court && court.startTime) {
            const timerId = setInterval(() => {
                const now = new Date().getTime(); const startTime = new Date(court.startTime).getTime(); const diff = Math.floor((now - startTime) / 1000);
                setTime(`${String(Math.floor(diff / 60)).padStart(2, '0')}:${String(diff % 60).padStart(2, '0')}`);
            }, 1000);
            return () => clearInterval(timerId);
        } else { setTime('00:00'); }
    }, [court]);
    return <div className="text-center text-xs font-mono text-white mt-1 tracking-wider">{time}</div>;
};

const WaitingListSection = React.memo(({ waitingPlayers, selectedPlayerIds, isAdmin, onCardClick, handleDeleteFromWaiting, currentUser }) => (
    <section className="bg-gray-800/50 rounded-lg p-2">
        <h2 className="text-sm font-bold mb-2 text-yellow-400 arcade-font flicker-text">대기 명단 ({waitingPlayers.length})</h2>
        <div className="grid grid-cols-5 gap-1">
            {waitingPlayers.map(player => <PlayerCard key={player.id} player={player} context={{ location: 'waiting' }} isAdmin={isAdmin} onCardClick={() => onCardClick(player.id)} onAction={handleDeleteFromWaiting} isCurrentUser={currentUser?.id === player.id} isSelected={selectedPlayerIds.includes(player.id)} />)}
        </div>
    </section>
));

const ScheduleTable = React.memo(({ type, title, titleColor, gameState, players, selected, isAdmin, onCardClick, onSlotClick, onStartMatch, onClear, onDelete, currentUser }) => {
    const scheduleData = type === 'auto' ? gameState.autoScheduledMatches : gameState.manualScheduledMatches;
    const scheduleEntries = Object.entries(scheduleData || {});
    const pressTimerRef = useRef(null);

    const minSlots = type === 'manual' ? gameState.numScheduledMatches || 4 : 0;
    const numToRender = Math.max(minSlots, scheduleEntries.length);
    const renderKeys = Array.from({ length: numToRender }, (_, i) => String(i));
    if(type==='auto') renderKeys.splice(0, renderKeys.length, ...Object.keys(scheduleData || {}));

    const handlePressStart = (key) => { if (isAdmin) pressTimerRef.current = setTimeout(() => onDelete(key), 1000); };
    const handlePressEnd = () => { if (pressTimerRef.current) clearTimeout(pressTimerRef.current); };

    return (
        <section>
            <div className="flex justify-between items-center mb-2 px-1">
                <h2 className={`text-lg font-bold ${titleColor} arcade-font`}>{title}</h2>
                {isAdmin && <button onClick={onClear} className="text-xs text-red-400 hover:text-red-300">전체삭제</button>}
            </div>
            <div className="flex flex-col gap-2">
                {numToRender === 0 && <p className="text-center text-gray-500 text-sm py-4">예정된 경기가 없습니다.</p>}
                {renderKeys.map((key, index) => {
                    const match = scheduleData?.[key] || Array(PLAYERS_PER_MATCH).fill(null);
                    const playerCount = match.filter(p => p).length;
                    return (
                        <div key={`${type}-${key}`} className="flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1">
                            <div className="flex-shrink-0 w-6 text-center" onMouseDown={() => handlePressStart(key)} onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd} onTouchStart={() => handlePressStart(key)} onTouchEnd={handlePressEnd}>
                                <p className="font-bold text-lg text-white arcade-font cursor-pointer">{index + 1}</p>
                            </div>
                            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                {match.map((playerId, slotIndex) => {
                                    const player = players[playerId];
                                    const isSelected = selected?.type === type && selected?.matchKey === key && selected?.slotIndex === slotIndex;
                                    return player ? <PlayerCard key={`${playerId}-${key}-${slotIndex}`} player={player} context={{ location: type }} isAdmin={isAdmin} onCardClick={() => onCardClick({type, playerId, matchKey: key, slotIndex })} isCurrentUser={currentUser?.id === playerId} isSelected={isSelected} /> : <EmptySlot key={`empty-${type}-${key}-${slotIndex}`} onSlotClick={() => onSlotClick({ type, matchKey: key, slotIndex })} />;
                                })}
                            </div>
                            <div className="flex-shrink-0 w-14 text-center">
                                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === 4 && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== 4 || !isAdmin} onClick={() => onStartMatch(key, type)}>START</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});

const InProgressCourtsSection = React.memo(({ numInProgressCourts, inProgressCourts, players, isAdmin, onEndMatch, currentUser }) => (
    <section>
        <h2 className="text-lg font-bold mb-2 text-red-500 px-1 arcade-font">경기 진행</h2>
        <div className="flex flex-col gap-2">
            {Array.from({ length: numInProgressCourts }).map((_, courtIndex) => {
                const court = inProgressCourts[courtIndex];
                return (
                    <div key={`court-${courtIndex}`} className="flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1">
                        <div className="flex-shrink-0 w-6 flex flex-col items-center justify-center"><p className="font-bold text-lg text-white arcade-font">{courtIndex + 1}</p><p className="font-semibold text-[8px] text-gray-400 arcade-font">코트</p></div>
                        <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                            {(court?.players || Array(4).fill(null)).map((pId, i) => players[pId] ? <PlayerCard key={pId} player={players[pId]} context={{}} isAdmin={isAdmin} isCurrentUser={currentUser?.id === pId} isMovable={false} /> : <EmptySlot key={`court-empty-${i}`} />)}
                        </div>
                        <div className="flex-shrink-0 w-14 text-center">
                            <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition text-[10px] ${court && isAdmin ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={!court || !isAdmin} onClick={() => onEndMatch(courtIndex)}>FINISH</button>
                            <CourtTimer court={court} />
                        </div>
                    </div>
                );
            })}
        </div>
    </section>
));

// ===================================================================================
// Main App Component
// ===================================================================================
export default function App() {
    const [allPlayers, setAllPlayers] = useState({});
    const [gameState, setGameState] = useState(null);
    const [seasonConfig, setSeasonConfig] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [selectedCard, setSelectedCard] = useState(null); // For Auto-match swap
    const [selectedPlayerIds, setSelectedPlayerIds] = useState([]); // For Manual multi-select
    const [modal, setModal] = useState(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState('main');

    const activePlayers = useMemo(() => Object.values(allPlayers).filter(p => p.status === 'active').reduce((acc, p) => ({...acc, [p.id]: p}), {}), [allPlayers]);
    const waitingPlayers = useMemo(() => {
        if (!gameState) return [];
        const manualPlayerIds = new Set(Object.values(gameState.manualScheduledMatches || {}).flat());
        const inProgressPlayerIds = new Set(Object.values(gameState.inProgressCourts || {}).flat().map(p => p?.id).filter(Boolean));
        return Object.values(activePlayers).filter(p => !manualPlayerIds.has(p.id) && !inProgressPlayerIds.has(p.id)).sort((a,b) => (LEVEL_ORDER[a.level] || 99) - (LEVEL_ORDER[b.level] || 99));
    }, [activePlayers, gameState]);

    useEffect(() => {
        const init = () => {
            const unsubPlayers = onSnapshot(playersRef, s => setAllPlayers(s.docs.reduce((acc,d) => ({...acc, [d.id]:d.data()}),{})));
            const unsubGameState = onSnapshot(gameStateRef, d => setGameState(d.exists() ? d.data() : { manualScheduledMatches: {}, autoScheduledMatches: {}, inProgressCourts: Array(4).fill(null), numScheduledMatches: 4, numInProgressCourts: 4 }));
            const unsubConfig = onSnapshot(configRef, d => setSeasonConfig(d.exists() ? d.data() : null));
            
            const savedUserId = localStorage.getItem('badminton-currentUser-id');
            if(savedUserId) getDoc(doc(playersRef, savedUserId)).then(snap => { if(snap.exists() && snap.data().status === 'active') setCurrentUser(snap.data()); });
            
            setIsLoading(false);
            return () => { unsubPlayers(); unsubGameState(); unsubConfig(); };
        };
        const unsubscribe = init();
        return unsubscribe;
    }, []);
    
    useEffect(() => {
        if(currentUser?.id) {
            const unsub = onSnapshot(doc(playersRef, currentUser.id), (doc) => {
                if(!doc.exists() || doc.data().status !== 'active') {
                    handleLogout(false); // don't show confirm modal
                } else {
                    setCurrentUser(doc.data());
                }
            });
            return unsub;
        }
    }, [currentUser?.id]);

    const updateGameState = useCallback(async (updateFn) => {
        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(gameStateRef);
                const currentData = docSnap.exists() ? docSnap.data() : {};
                const newData = updateFn(currentData);
                transaction.set(gameStateRef, newData, { merge: true });
            });
        } catch (e) {
            console.error("Update failed: ", e);
            setModal({ type: 'alert', data: { title: '오류', body: e.message } });
        }
    }, []);
    
    const handleManualCardClick = useCallback((playerId) => {
        setSelectedPlayerIds(ids => ids.includes(playerId) ? ids.filter(id => id !== playerId) : [...ids, playerId]);
    }, []);

    const handleAutoCardClick = useCallback((cardInfo) => {
        if (!selectedCard) {
            setSelectedCard(cardInfo);
        } else {
            if (selectedCard.playerId === cardInfo.playerId && selectedCard.matchKey === cardInfo.matchKey) {
                setSelectedCard(null); return;
            }
            updateGameState(current => {
                const newState = JSON.parse(JSON.stringify(current));
                const { playerId: p1, matchKey: m1, slotIndex: s1 } = selectedCard;
                const { playerId: p2, matchKey: m2, slotIndex: s2 } = cardInfo;
                newState.autoScheduledMatches[m1][s1] = p2;
                newState.autoScheduledMatches[m2][s2] = p1;
                return newState;
            });
            setSelectedCard(null);
        }
    }, [selectedCard, updateGameState]);

    const handleManualSlotClick = useCallback((slotInfo) => {
        if (selectedPlayerIds.length === 0) return;
        updateGameState(current => {
            const newState = JSON.parse(JSON.stringify(current));
            if(!newState.manualScheduledMatches) newState.manualScheduledMatches = {};
            let match = newState.manualScheduledMatches[slotInfo.matchKey] || Array(4).fill(null);
            const playersToPlace = [...selectedPlayerIds];
            for(let i=0; i<4 && playersToPlace.length > 0; i++){
                if(match[i] === null) match[i] = playersToPlace.shift();
            }
            newState.manualScheduledMatches[slotInfo.matchKey] = match;
            return newState;
        });
        setSelectedPlayerIds([]);
    }, [selectedPlayerIds, updateGameState]);

    const handleStartMatch = useCallback((matchKey, type) => {
        const schedule = gameState?.[`${type}ScheduledMatches`];
        if(!schedule || !schedule[matchKey] || schedule[matchKey].filter(p=>p).length !== 4) return;
        
        const emptyCourtIdx = gameState.inProgressCourts.findIndex(c => c === null);
        if(emptyCourtIdx === -1) { setModal({type: 'alert', data: { title: "시작 불가", body: "빈 코트가 없습니다." }}); return; }

        updateGameState(current => {
            const newState = JSON.parse(JSON.stringify(current));
            newState.inProgressCourts[emptyCourtIdx] = { players: [...schedule[matchKey]], startTime: new Date().toISOString() };
            delete newState[`${type}ScheduledMatches`][matchKey];
            if(type === 'manual'){ // Re-index manual matches
                const sortedKeys = Object.keys(newState.manualScheduledMatches || {}).sort((a, b) => a - b);
                const reIndexed = {};
                sortedKeys.forEach((key, i) => { reIndexed[i] = newState.manualScheduledMatches[key]; });
                newState.manualScheduledMatches = reIndexed;
            }
            return newState;
        });
    }, [gameState, updateGameState]);

    const handleEndMatch = useCallback((courtIndex) => {
        const court = gameState.inProgressCourts[courtIndex];
        if (!court) return;
        const matchPlayers = court.players.map(pid => allPlayers[pid]).filter(Boolean);
        if (matchPlayers.length !== 4) return;
        setModal({ type: 'resultInput', data: { courtIndex, players: matchPlayers } });
    }, [gameState, allPlayers]);
    
    const processMatchResult = useCallback(async (courtIndex, winningTeam) => {
        const court = gameState.inProgressCourts[courtIndex];
        if (!court) return;
        const allMatchPlayerIds = court.players;
        const batch = writeBatch(db);
        const winners = winningTeam;
        const losers = allMatchPlayerIds.filter(pId => !winningTeam.includes(pId));

        allMatchPlayerIds.forEach(pId => {
            const player = allPlayers[pId]; if(!player) return;
            const isWinner = winningTeam.includes(pId);
            const updatedData = {
                todayWins: increment(isWinner ? 1 : 0), todayLosses: increment(isWinner ? 0 : 1),
                todayWinStreak: isWinner ? (player.todayWinStreak || 0) + 1 : 0,
                todayWinStreakCount: (isWinner && (player.todayWinStreak || 0) + 1 >= 3) ? increment(1) : player.todayWinStreakCount,
            };
            batch.update(doc(playersRef, pId), updatedData);
        });
        
        const [p1, p2] = winners; const [p3, p4] = losers;
        if(p1 && p2){ batch.update(doc(playersRef, p1), { [`partnerHistory.${p2}`]: increment(1) }); batch.update(doc(playersRef, p2), { [`partnerHistory.${p1}`]: increment(1) }); }
        if(p3 && p4){ batch.update(doc(playersRef, p3), { [`partnerHistory.${p4}`]: increment(1) }); batch.update(doc(playersRef, p4), { [`partnerHistory.${p3}`]: increment(1) }); }
        
        await batch.commit();
        updateGameState(current => {
            const newState = JSON.parse(JSON.stringify(current));
            newState.inProgressCourts[courtIndex] = null;
            return newState;
        });
        setModal(null);
    }, [gameState, allPlayers, updateGameState]);

    const handleGenerateSchedule = useCallback(async (gamesPerPlayer) => {
        setModal({ type: 'alert', data: { title: '생성 중...', body: '자동으로 경기를 생성하고 있습니다...' } });
        const playersToMatch = Object.values(allPlayers).filter(p => p.status === 'active' && !p.isGuest);
        const newSchedule = generateSchedule(playersToMatch, gamesPerPlayer);
        if (newSchedule.length === 0) { setModal({ type: 'alert', data: { title: '생성 불가', body: '경기를 생성할 선수가 부족합니다.' } }); return; }
        
        updateGameState(current => {
            const newState = JSON.parse(JSON.stringify(current));
            if(!newState.autoScheduledMatches) newState.autoScheduledMatches = {};
            const existingAutoMatches = newState.autoScheduledMatches;
            const nextKey = Object.keys(existingAutoMatches).length > 0 ? Math.max(...Object.keys(existingAutoMatches).map(Number)) + 1 : 0;
            newSchedule.forEach((match, index) => {
                newState.autoScheduledMatches[nextKey + index] = match.players;
            });
            return newState;
        });
        setModal({ type: 'alert', data: { title: '성공', body: `${newSchedule.length}개의 경기가 추가되었습니다.` } });
    }, [allPlayers, updateGameState]);

    const handleClearSchedule = useCallback((type) => {
        setModal({ type: 'confirm', data: { title: '전체 삭제', body: '모든 예정 경기를 삭제하시겠습니까?', onConfirm: () => {
            updateGameState(current => ({ ...current, [`${type}ScheduledMatches`]: {} }));
            setModal(null);
        }}});
    }, [updateGameState]);

    const handleDeleteMatch = useCallback((key, type) => {
        const matchNum = type === 'auto' ? parseInt(key) + 1 : Object.keys(gameState[`${type}ScheduledMatches`] || {}).sort((a,b)=>a-b).indexOf(key) + 1;
        setModal({ type: 'confirm', data: { title: '경기 삭제', body: `${matchNum}번 경기를 삭제하시겠습니까?`, onConfirm: () => {
            updateGameState(current => {
                const newState = { ...current };
                delete newState[`${type}ScheduledMatches`][key];
                return newState;
            });
            setModal(null);
        }}});
    }, [gameState, updateGameState]);
    
    const handleEnter = async (formData) => {
        const id = formData.name.replace(/\s+/g, '_');
        const playerDocRef = doc(playersRef, id);
        let docSnap = await getDoc(playerDocRef);
        let playerData = docSnap.exists() ? { ...docSnap.data(), ...formData, status: 'active' } : { id, ...formData, status: 'active', entryTime: new Date().toISOString(), wins: 0, losses: 0, rp: 0, todayWins: 0, todayLosses: 0, partnerHistory: {} };
        await setDoc(playerDocRef, playerData, { merge: true });
        setCurrentUser(playerData);
        localStorage.setItem('badminton-currentUser-id', id);
    };
    
    const handleLogout = (showConfirm = true) => {
        const logoutAction = () => {
             updateDoc(doc(playersRef, currentUser.id), { status: 'inactive' });
            localStorage.removeItem('badminton-currentUser-id');
            setCurrentUser(null);
            setModal(null);
        }
        if(showConfirm) {
            setModal({type: 'confirm', data: {title: '나가기', body: '정말 나가시겠습니까?', onConfirm: logoutAction }});
        } else {
            logoutAction();
        }
    };

    if (isLoading) return <div className="bg-black text-white min-h-screen flex items-center justify-center"><div className="arcade-font text-yellow-400">LOADING...</div></div>;
    if (!currentUser) return <EntryPage onEnter={handleEnter} />;
    const isAdmin = ADMIN_NAMES.includes(currentUser.name);

    return (
        <div className="bg-black text-white min-h-screen font-sans flex flex-col" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
            {modal?.type === 'autoMatch' && <AutoMatchModal onGenerate={handleGenerateSchedule} onClose={() => setModal(null)} />}
            {modal?.type === 'resultInput' && <ResultInputModal {...modal.data} onResultSubmit={processMatchResult} onClose={() => setModal(null)} />}
            {modal?.type === 'confirm' && <ConfirmationModal {...modal.data} onCancel={() => setModal(null)} />}
            {modal?.type === 'alert' && <AlertModal {...modal.data} onClose={() => setModal(null)} />}
            {/* Other modals can be added back here */}
            
            <header className="flex-shrink-0 p-2 flex flex-col gap-1 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-20 border-b border-gray-700">
                <div className="flex items-center justify-between gap-2">
                    <h1 className="text-sm sm:text-lg font-bold text-yellow-400 arcade-font flicker-text">⚡ COCKSLIGHTING</h1>
                    <div><span className="text-xs font-bold">{isAdmin ? '👑' : ''} {currentUser.name}</span><button onClick={handleLogout} className="ml-2 bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-md text-xs">나가기</button></div>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                    {isAdmin && <button onClick={() => setModal({type: 'autoMatch'})} className="text-gray-400 hover:text-white text-lg px-1"><i className="fas fa-magic"></i></button>}
                    {isAdmin && <button onClick={() => setIsSettingsOpen(true)} className="text-gray-400 hover:text-white text-lg px-1"><i className="fas fa-cog"></i></button>}
                    <button onClick={() => setCurrentPage(p => p === 'main' ? 'ranking' : 'main')} className="arcade-button py-1.5 px-2.5 rounded-md text-xs font-bold bg-gray-700 hover:bg-gray-600 text-yellow-300"> {currentPage === 'main' ? '⭐ 콕스타' : '🕹️ 현황판'}</button>
                </div>
            </header>

            <main className="flex-grow flex flex-col gap-3 p-1.5 overflow-y-auto">
                {currentPage === 'main' && gameState ? (
                    <>
                        <WaitingListSection waitingPlayers={waitingPlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} onCardClick={handleManualCardClick} currentUser={currentUser} />
                        <ScheduleTable type="auto" title="자동 매칭" titleColor="text-purple-400" gameState={gameState} players={allPlayers} selected={selectedCard} isAdmin={isAdmin} onCardClick={handleAutoCardClick} onSlotClick={()=>{/* No op for auto */}} onStartMatch={handleStartMatch} onClear={() => handleClearSchedule('auto')} onDelete={(key) => handleDeleteMatch(key, 'auto')} currentUser={currentUser} />
                        <ScheduleTable type="manual" title="경기 예정" titleColor="text-cyan-400" gameState={gameState} players={allPlayers} selected={null /* Manual selection is different */} isAdmin={isAdmin} onCardClick={(info)=>setSelectedPlayerIds(ids => ids.includes(info.playerId) ? ids.filter(id=>id!==info.playerId) : [...ids, info.playerId])} onSlotClick={handleManualSlotClick} onStartMatch={handleStartMatch} onClear={() => handleClearSchedule('manual')} onDelete={(key) => handleDeleteMatch(key, 'manual')} currentUser={currentUser} />
                        <InProgressCourtsSection numInProgressCourts={gameState.numInProgressCourts} inProgressCourts={gameState.inProgressCourts} players={allPlayers} isAdmin={isAdmin} onEndMatch={handleEndMatch} currentUser={currentUser} />
                    </>
                ) : (
                    <RankingPage players={Object.values(allPlayers)} currentUser={currentUser} isAdmin={isAdmin} />
                )}
            </main>
            <style>{`.arcade-font { font-family: 'Press Start 2P', cursive; } .arcade-button { position: relative; border: 2px solid #222; box-shadow: inset -2px -2px 0px 0px #333, inset 2px 2px 0px 0px #FFF; } .arcade-button:active { transform: translateY(2px); box-shadow: inset -1px -1px 0px 0px #333, inset 1px 1px 0px 0px #FFF; } @keyframes flicker { 0%, 100% { opacity: 1; text-shadow: 0 0 8px #FFD700; } 50% { opacity: 0.8; text-shadow: 0 0 12px #FFD700; } } .flicker-text { animation: flicker 1.5s infinite; }`}</style>
        </div>
    );
}

// ===================================================================================
// Other Components (Modals, EntryPage, etc.)
// ===================================================================================
function EntryPage({ onEnter }) {
    const [formData, setFormData] = useState({ name: '', level: 'A조', gender: '남', isGuest: false });
    const handleChange = (e) => { const { name, value, type, checked } = e.target; setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value })); };
    const handleSubmit = (e) => { e.preventDefault(); onEnter(formData); };
    return (
        <div className="bg-black text-white min-h-screen flex items-center justify-center p-4">
            <div className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-sm">
                <h1 className="text-3xl font-bold text-yellow-400 mb-6 text-center arcade-font flicker-text">⚡ COCKSLIGHTING</h1>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="text" name="name" placeholder="이름" value={formData.name} onChange={handleChange} className="w-full bg-gray-700 text-white p-3 rounded-lg focus:outline-none ring-2 ring-transparent focus:ring-yellow-400" required />
                    <div className="grid grid-cols-4 gap-2">
                        {['A조', 'B조', 'C조', 'D조'].map(level => (
                            <button key={level} type="button" onClick={() => setFormData(p => ({ ...p, level }))} className={`w-full p-3 rounded-md font-bold transition-colors arcade-button ${formData.level === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}>{level}</button>
                        ))}
                    </div>
                    <div className="flex justify-around items-center text-lg">
                        <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="남" checked={formData.gender === '남'} onChange={handleChange} className="mr-2 h-4 w-4" /> 남자</label>
                        <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="여" checked={formData.gender === '여'} onChange={handleChange} className="mr-2 h-4 w-4" /> 여자</label>
                    </div>
                    <div className="text-center"><label className="flex items-center justify-center text-lg cursor-pointer"><input type="checkbox" name="isGuest" checked={formData.isGuest} onChange={handleChange} className="mr-2 h-4 w-4" /> 게스트</label></div>
                    <button type="submit" className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 rounded-lg">입장하기</button>
                </form>
            </div>
        </div>
    );
}
function AutoMatchModal({ onGenerate, onClose }) {
    const [gamesPerPlayer, setGamesPerPlayer] = useState(3);
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font">균등 경기 생성</h3>
                <p className="text-gray-300 mb-6">선수당 진행할 평균 게임 수를 선택하세요.</p>
                <div className="flex items-center justify-center gap-4 my-4">
                    <button onClick={() => setGamesPerPlayer(g => Math.max(1, g - 1))} className="w-12 h-12 bg-gray-600 rounded-full text-2xl">-</button>
                    <span className="text-4xl font-bold w-16 text-center arcade-font">{gamesPerPlayer}</span>
                    <button onClick={() => setGamesPerPlayer(g => g + 1)} className="w-12 h-12 bg-gray-600 rounded-full text-2xl">+</button>
                </div>
                <div className="flex gap-4 mt-8">
                    <button onClick={onClose} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg">취소</button>
                    <button onClick={() => onGenerate(gamesPerPlayer)} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg">생성</button>
                </div>
            </div>
        </div>
    );
}
function ResultInputModal({ courtIndex, players, onResultSubmit, onClose }) {
    const [winners, setWinners] = useState([]);
    const handlePlayerClick = (playerId) => setWinners(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : (prev.length < 2 ? [...prev, playerId] : prev));
    useEffect(() => { if (winners.length === 2) { const timer = setTimeout(() => onResultSubmit(courtIndex, winners), 500); return () => clearTimeout(timer); } }, [winners, courtIndex, onResultSubmit]);
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md text-center shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font flicker-text">승리팀 선택</h3>
                <p className="text-gray-300 mb-6">승리한 선수 2명을 선택하세요.</p>
                <div className="grid grid-cols-4 gap-2">{players.map(p => (<PlayerCard key={p.id} player={p} context={{}} isMovable={true} onCardClick={() => handlePlayerClick(p.id)} isSelectedForWin={winners.includes(p.id)}/>))}</div>
                <button onClick={onClose} className="mt-6 w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg">취소</button>
            </div>
        </div>
    );
}
function RankingPage({ players, currentUser, isAdmin }) {
    const [rankingPeriod, setRankingPeriod] = useState('today');
    const rankedPlayers = useMemo(() => {
        let playersToRank = Object.values(players).filter(p => !p.isGuest);
        if (rankingPeriod === 'today') {
            playersToRank = playersToRank.map(p => ({ ...p, todayRp: ((p.todayWins || 0) * 30) + ((p.todayLosses || 0) * 10) + ((p.todayWinStreakCount || 0) * 20) })).filter(p => (p.todayWins || 0) + (p.todayLosses || 0) > 0).sort((a, b) => b.todayRp - a.todayRp);
        } else {
            playersToRank = playersToRank.filter(p => (p.wins || 0) > 0 || (p.losses || 0) > 0).sort((a, b) => (b.rp || 0) - (a.rp || 0));
        }
        return playersToRank.map((p, index) => ({ ...p, rank: index + 1 }));
    }, [players, rankingPeriod]);
    
    return (
        <div className="p-2">
            <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold text-yellow-400 arcade-font">⭐ COCKS STAR</h2></div>
            <div className="flex justify-center gap-2 mb-4">
                <button onClick={() => setRankingPeriod('today')} className={`arcade-button py-2 px-4 rounded-md text-xs font-bold ${rankingPeriod === 'today' ? 'bg-yellow-500 text-black' : 'bg-gray-700'}`}>오늘</button>
                <button onClick={() => setRankingPeriod('monthly')} className={`arcade-button py-2 px-4 rounded-md text-xs font-bold ${rankingPeriod === 'monthly' ? 'bg-yellow-500 text-black' : 'bg-gray-700'}`}>이번달</button>
            </div>
            <div className="space-y-2">
                {rankedPlayers.map(p => {
                    const wins = rankingPeriod === 'today' ? p.todayWins : p.wins;
                    const losses = rankingPeriod === 'today' ? p.todayLosses : p.losses;
                    const rp = rankingPeriod === 'today' ? p.todayRp : p.rp;
                    const winRate = (wins + losses) > 0 ? `${Math.round(wins/(wins+losses)*100)}%` : '-';
                    return (
                        <div key={p.id} className={`p-3 rounded-lg flex items-center gap-4 border ${p.id === currentUser.id ? 'ring-2 ring-blue-400' : ''} bg-gray-800`}>
                            <span className="text-xl font-bold w-12 text-center">{p.rank}</span>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold truncate">{p.name}</p>
                                <p className="text-xs text-gray-400">{rp} RP | {wins}승 {losses}패 ({winRate})</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function AlertModal({ title, body, onClose }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-yellow-400 mb-4">{title}</h3><p className="text-gray-300 mb-6">{body}</p><button onClick={onClose} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg">확인</button></div></div> ); }
const ConfirmationModal = ({ title, body, onConfirm, onCancel }) => <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"><div className="bg-gray-800 p-6 rounded-lg text-center"><h3 className="font-bold text-lg">{title}</h3><p className="py-4">{body}</p><div className="flex gap-4"><button onClick={onCancel} className="bg-gray-600 px-4 py-2 rounded">취소</button><button onClick={onConfirm} className="bg-red-600 px-4 py-2 rounded">확인</button></div></div></div>;
const SeasonModal = ({onClose}) => {useEffect(onClose,[]); return null};

