import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getFirestore, doc, getDoc, setDoc, onSnapshot, 
    collection, deleteDoc, updateDoc, writeBatch, runTransaction 
} from 'firebase/firestore';

// ===================================================================================
// Firebase 설정
// ===================================================================================
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
const playersRef = collection(db, "players");
const gameStateRef = doc(db, "gameState", "live");
const ADMIN_NAMES = ["나채빈", "정형진", "윤지혜", "이상민", "이정문", "신영은", "오미리"];

// ===================================================================================
// Helper 함수
// ===================================================================================
const generateId = (name) => name.replace(/\s+/g, '_');

// ===================================================================================
// 자식 컴포넌트들
// ===================================================================================
const PlayerCard = React.memo(({ player, context, isAdmin, onCardClick, onAction, onLongPress }) => {
    let pressTimer = null;
    const handleMouseDown = (e) => { e.preventDefault(); pressTimer = setTimeout(() => onLongPress(player), 1000); };
    const handleMouseUp = () => { clearTimeout(pressTimer); };
    const handleContextMenu = (e) => { e.preventDefault(); };
    
    const genderStyle = {
        boxShadow: `inset 3px 0 0 0 ${player.gender === '남' ? '#3B82F6' : '#EC4899'}`
    };

    const adminIcon = ADMIN_NAMES.includes(player.name) ? '👑' : '';
    const isWaiting = !context.location;
    const buttonHoverColor = isWaiting ? 'hover:text-red-500' : 'hover:text-yellow-400';
    const buttonIcon = "fas fa-times-circle fa-xs";
    const playerNameClass = `player-name text-white text-[11px] font-bold whitespace-nowrap leading-tight`;
    const playerInfoClass = `player-info text-gray-400 text-[10px] leading-tight mt-px whitespace-nowrap`;

    return (
        <div 
            className={`player-card bg-gray-700 p-1 rounded-md cursor-pointer border-2 relative flex flex-col justify-center text-center h-14`}
            style={{
                borderColor: context.selected ? '#FBBF24' : 'transparent',
                ...genderStyle
            }}
            onClick={() => onCardClick(player.id)}
            onMouseDown={isAdmin ? handleMouseDown : null}
            onMouseUp={isAdmin ? handleMouseUp : null}
            onTouchStart={isAdmin ? handleMouseDown : null}
            onTouchEnd={isAdmin ? handleMouseUp : null}
            onMouseLeave={isAdmin ? handleMouseUp : null}
            onContextMenu={isAdmin ? handleContextMenu : null}
        >
            <div>
                <div className={playerNameClass}>{adminIcon}{player.name}</div>
                <div className={playerInfoClass}>
                    <span className={player.gender === '남' ? 'text-blue-400' : 'text-pink-400'}>{player.gender}</span>|{player.level}|{player.gamesPlayed}겜
                </div>
            </div>
            {isAdmin && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onAction(player); }} 
                    className={`absolute -top-2 -right-2 p-1 text-gray-500 ${buttonHoverColor}`}
                    aria-label={isWaiting ? '선수 삭제' : '대기자로 이동'}
                ><i className={buttonIcon}></i></button>
            )}
        </div>
    );
});

const EmptySlot = ({ onSlotClick }) => ( <div className="player-slot h-14 bg-gray-900/50 rounded-md flex items-center justify-center text-gray-500 border-2 border-dashed border-gray-600 cursor-pointer" onClick={onSlotClick}><span className="text-lg">+</span></div> );

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
    return <div className="text-center text-sm font-mono text-white mt-1">{time}</div>;
};

// ===================================================================================
// 메인 앱 컴포넌트
// ===================================================================================
export default function App() {
    const [players, setPlayers] = useState({});
    const [scheduledMatches, setScheduledMatches] = useState({});
    const [inProgressCourts, setInProgressCourts] = useState([null, null, null, null]);
    const [currentUser, setCurrentUser] = useState(null);
    const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);
    const [modal, setModal] = useState({ type: null, data: null });

    const isAdmin = useMemo(() => currentUser && ADMIN_NAMES.includes(currentUser.name), [currentUser]);

    useEffect(() => {
        const unsubscribePlayers = onSnapshot(playersRef, (snapshot) => {
            const playersData = {};
            snapshot.forEach(doc => playersData[doc.id] = doc.data());
            setPlayers(playersData);
        });
        const unsubscribeGameState = onSnapshot(gameStateRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setScheduledMatches(data.scheduledMatches || {});
                setInProgressCourts(data.inProgressCourts || [null, null, null, null]);
            } else {
                setDoc(gameStateRef, { scheduledMatches: {}, inProgressCourts: [null, null, null, null] });
            }
        });
        return () => { unsubscribePlayers(); unsubscribeGameState(); };
    }, []);
    
    useEffect(() => {
        const savedUserId = localStorage.getItem('badminton-currentUser-id');
        if (savedUserId && !currentUser) {
            getDoc(doc(playersRef, savedUserId)).then(docSnap => {
                if (docSnap.exists()) { setCurrentUser(docSnap.data()); } 
                else { localStorage.removeItem('badminton-currentUser-id'); }
            });
        }
    }, [currentUser]);

    const updateGameState = useCallback(async (updateFunction) => {
        try {
            await runTransaction(db, async (transaction) => {
                const gameStateDoc = await transaction.get(gameStateRef);
                if (!gameStateDoc.exists()) throw "Game state document does not exist!";
                const currentState = gameStateDoc.data();
                const newState = updateFunction(currentState);
                transaction.set(gameStateRef, newState);
            });
            setSelectedPlayerIds([]);
        } catch (err) {
            console.error("Transaction failed: ", err);
            setModal({ type: 'alert', data: { title: '업데이트 충돌', body: '다른 관리자와 동시에 변경했습니다. 데이터가 자동으로 새로고침됩니다.' }});
        }
    }, []);

    const scheduledMatchesArray = useMemo(() => 
        Array(4).fill(null).map((_, i) => scheduledMatches[String(i)] || Array(4).fill(null))
    , [scheduledMatches]);
    
    const playerLocations = useMemo(() => {
        const locations = {};
        Object.keys(players).forEach(pId => locations[pId] = { location: 'waiting' });
        for (let i = 0; i < 4; i++) {
            const match = scheduledMatches[String(i)];
            if (match) { match.forEach((playerId, j) => { if (playerId) locations[playerId] = { location: 'schedule', matchIndex: i, slotIndex: j }; }); }
        }
        for (let i = 0; i < 4; i++) {
            const court = inProgressCourts[i];
            if (court && court.players) { court.players.forEach((playerId, j) => { if (playerId) locations[playerId] = { location: 'court', matchIndex: i, slotIndex: j }; });}
        }
        return locations;
    }, [players, scheduledMatches, inProgressCourts]);

    const findPlayerLocation = useCallback((playerId) => playerLocations[playerId] || { location: 'waiting' }, [playerLocations]);
    
    const handleReturnToWaiting = useCallback(async (player) => {
        const loc = findPlayerLocation(player.id);
        if (!loc || loc.location === 'waiting') return;
        await updateGameState(currentState => {
            const newState = JSON.parse(JSON.stringify(currentState));
            if (loc.location === 'schedule') {
                newState.scheduledMatches[String(loc.matchIndex)][loc.slotIndex] = null;
            } else if (loc.location === 'court') {
                newState.inProgressCourts[loc.matchIndex].players[loc.slotIndex] = null;
                if (newState.inProgressCourts[loc.matchIndex].players.every(p => p === null)) {
                    newState.inProgressCourts[loc.matchIndex] = null;
                }
            }
            return newState;
        });
    }, [findPlayerLocation, updateGameState]);
    
    const handleDeleteFromWaiting = useCallback((player) => {
        setModal({ type: 'confirm', data: { title: '선수 내보내기', body: `${player.name} 선수를 내보낼까요?`,
            onConfirm: async () => { await deleteDoc(doc(playersRef, player.id)); setModal({ type: null, data: null }); }
        }});
    }, []);

    const handleEnter = useCallback(async (formData) => {
        const { name, level, gender } = formData;
        if (!name) { setModal({ type: 'alert', data: { title: '오류', body: '이름을 입력해주세요.' } }); return; }
        const id = generateId(name);
        const playerDocRef = doc(playersRef, id);
        let docSnap = await getDoc(playerDocRef);
        let playerData = docSnap.exists() ? docSnap.data() : { id, name, level, gender, gamesPlayed: 0, entryTime: new Date().toISOString() };
        if (!docSnap.exists()) await setDoc(playerDocRef, playerData);
        setCurrentUser(playerData);
        localStorage.setItem('badminton-currentUser-id', id);
    }, []);

    const handleLogout = useCallback(() => {
        setModal({ type: 'confirm', data: { title: '로그아웃', body: '로그아웃하고 이름 입력 화면으로 돌아가시겠습니까?',
            onConfirm: () => {
                localStorage.removeItem('badminton-currentUser-id');
                setCurrentUser(null);
                setModal({ type: null, data: null });
            }
        }});
    }, []);
    
    const handleCardClick = useCallback((playerId) => {
        if (!isAdmin) return;
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
                updateGameState(currentState => {
                    const newState = JSON.parse(JSON.stringify(currentState));
                    const getValue = (l) => l.location === 'schedule' ? newState.scheduledMatches[String(l.matchIndex)][l.slotIndex] : newState.inProgressCourts[l.matchIndex].players[l.slotIndex];
                    const setValue = (l, value) => {
                        if (l.location === 'schedule') newState.scheduledMatches[String(l.matchIndex)][l.slotIndex] = value;
                        else if(l.location === 'court') newState.inProgressCourts[l.matchIndex].players[l.slotIndex] = value;
                    };
                    const valA = getValue(firstSelectedLoc);
                    const valB = getValue(loc);
                    setValue(firstSelectedLoc, valB);
                    setValue(loc, valA);
                    return newState;
                });
            } else { setSelectedPlayerIds([playerId]); }
        }
    }, [isAdmin, selectedPlayerIds, findPlayerLocation, updateGameState]);
    
    const handleSlotClick = useCallback(async (context) => {
        if (!isAdmin || selectedPlayerIds.length === 0) return;
        const isWaitingPlayersSelected = selectedPlayerIds.every(id => findPlayerLocation(id)?.location === 'waiting');

        if (isWaitingPlayersSelected && context.location === 'schedule') {
             await updateGameState(currentState => {
                const newState = JSON.parse(JSON.stringify(currentState));
                const { matchIndex } = context;
                newState.scheduledMatches[String(matchIndex)] = newState.scheduledMatches[String(matchIndex)] || Array(4).fill(null);
                const targetMatch = newState.scheduledMatches[String(matchIndex)];
                const availableSlots = targetMatch.filter(p => p === null).length;
                if (selectedPlayerIds.length > availableSlots) { console.warn("Not enough slots!"); return currentState; }
                const playersToMove = [...selectedPlayerIds];
                for (let i = 0; i < 4 && playersToMove.length > 0; i++) { if (targetMatch[i] === null) { targetMatch[i] = playersToMove.shift(); } }
                return newState;
            });
        } else if (selectedPlayerIds.length === 1) {
            const playerToMoveId = selectedPlayerIds[0];
            const originalLoc = findPlayerLocation(playerToMoveId);
            if (!originalLoc) return;

            if (context.location === 'court' && originalLoc.location === 'waiting') {
                const playerRef = doc(playersRef, playerToMoveId);
                const player = players[playerToMoveId];
                if (player) { await updateDoc(playerRef, { gamesPlayed: player.gamesPlayed + 1 }); }
            }
            
            await updateGameState(currentState => {
                const newState = JSON.parse(JSON.stringify(currentState));
                if (originalLoc.location === 'schedule') {
                    newState.scheduledMatches[String(originalLoc.matchIndex)][originalLoc.slotIndex] = null;
                } else if (originalLoc.location === 'court') {
                    newState.inProgressCourts[originalLoc.matchIndex].players[originalLoc.slotIndex] = null;
                }

                if (context.location === 'schedule') {
                    const { matchIndex, slotIndex } = context;
                    newState.scheduledMatches[String(matchIndex)] = newState.scheduledMatches[String(matchIndex)] || Array(4).fill(null);
                    if (!newState.scheduledMatches[String(matchIndex)][slotIndex]) { newState.scheduledMatches[String(matchIndex)][slotIndex] = playerToMoveId; } 
                    else { return currentState; }
                } else if (context.location === 'court') {
                    const { courtIndex, slotIndex } = context;
                    if (!newState.inProgressCourts[courtIndex]) { newState.inProgressCourts[courtIndex] = { players: Array(4).fill(null), startTime: new Date().toISOString() }; }
                    if (!newState.inProgressCourts[courtIndex].players[slotIndex]) { newState.inProgressCourts[courtIndex].players[slotIndex] = playerToMoveId; } 
                    else { return currentState; }
                }
                return newState;
            });
        }
    }, [isAdmin, selectedPlayerIds, players, findPlayerLocation, updateGameState]);
    
    const handleStartMatch = useCallback(async (matchIndex) => {
        const match = scheduledMatchesArray[matchIndex] || [];
        if (match.filter(p => p).length !== 4) return;
        
        const emptyCourts = inProgressCourts.map((c, i) => c ? -1 : i).filter(i => i !== -1);
        if (emptyCourts.length === 0) { setModal({type: 'alert', data: { title: "시작 불가", body: "빈 코트가 없습니다." } }); return; }

        const start = async (courtIndex) => {
            const playersToMove = scheduledMatches[String(matchIndex)].filter(p => p);
            const batch = writeBatch(db);
            playersToMove.forEach(playerId => {
                const player = players[playerId];
                if (player) { const playerRef = doc(playersRef, playerId); batch.update(playerRef, { gamesPlayed: player.gamesPlayed + 1 }); }
            });
            await batch.commit();

            await updateGameState(currentState => {
                const newState = JSON.parse(JSON.stringify(currentState));
                newState.inProgressCourts[courtIndex] = { players: playersToMove, startTime: new Date().toISOString() };
                const currentScheduledArray = Array(4).fill(null).map((_, i) => newState.scheduledMatches[String(i)] || null);
                currentScheduledArray.splice(matchIndex, 1);
                currentScheduledArray.push(null);
                const updatedScheduledMatches = {};
                currentScheduledArray.forEach((match, i) => { if (match && match.some(p => p !== null)) { updatedScheduledMatches[String(i)] = match; }});
                newState.scheduledMatches = updatedScheduledMatches;
                return newState;
            });
            setModal({type:null, data:null});
        };

        if (emptyCourts.length === 1) { start(emptyCourts[0]); } 
        else { setModal({ type: 'courtSelection', data: { courts: emptyCourts, onSelect: start } }); }
    }, [scheduledMatchesArray, inProgressCourts, players, updateGameState, scheduledMatches]);

    const handleEndMatch = useCallback(async (courtIndex) => {
        await updateGameState(currentState => {
            const newState = JSON.parse(JSON.stringify(currentState));
            newState.inProgressCourts[courtIndex] = null;
            return newState;
        });
    }, [updateGameState]);
    
    const handleMoveOrSwapCourt = useCallback(async(sourceCourtIndex, targetCourtIndex) => {
        await updateGameState(currentState => {
            const newState = JSON.parse(JSON.stringify(currentState));
            const sourceCourt = newState.inProgressCourts[sourceCourtIndex];
            const targetCourt = newState.inProgressCourts[targetCourtIndex];
            newState.inProgressCourts[targetCourtIndex] = sourceCourt;
            newState.inProgressCourts[sourceCourtIndex] = targetCourt;
            return newState;
        });
        setModal({ type: null, data: null });
    }, [updateGameState]);

    if (!currentUser) { return <EntryPage onEnter={handleEnter} />; }

    // [오류 수정] useMemo를 남용하면 오류가 발생할 수 있으므로, 간단한 필터링은 일반 상수로 변경
    const waitingPlayers = Object.values(players)
        .filter(p => playerLocations[p.id]?.location === 'waiting')
        .sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime));
    
    const maleWaitingPlayers = waitingPlayers.filter(p => p.gender === '남');
    const femaleWaitingPlayers = waitingPlayers.filter(p => p.gender === '여');

    return (
        <div className="bg-black text-white min-h-screen font-sans flex flex-col" style={{ minWidth: '320px' }}>
            {modal.type === 'confirm' && <ConfirmationModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal.type === 'courtSelection' && <CourtSelectionModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal.type === 'editGames' && <EditGamesModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} onSave={async (newCount) => { await updateDoc(doc(playersRef, modal.data.player.id), { gamesPlayed: newCount }); setModal({ type: null, data: null }); }} />}
            {modal.type === 'alert' && <AlertModal {...modal.data} onClose={() => setModal({ type: null, data: null })} />}
            {modal.type === 'moveCourt' && <MoveCourtModal {...modal.data} courts={inProgressCourts} onSelect={handleMoveOrSwapCourt} onCancel={() => setModal({ type: null, data: null })} />}

            <header className="flex-shrink-0 p-2 flex justify-between items-center bg-gray-900 sticky top-0 z-10">
                <h1 className="text-lg font-bold text-yellow-400">Cockslighting</h1>
                <div className="text-right">
                    <span className="text-xs">{isAdmin ? '👑' : ''} {currentUser.name}</span>
                    <button onClick={handleLogout} className="ml-2 bg-gray-600 hover:bg-gray-700 text-white font-bold py-1 px-2 rounded-md text-xs">로그아웃</button>
                </div>
            </header>

            <main className="flex-grow flex flex-col gap-4 p-1">
                <section className="flex-shrink-0 bg-gray-800/50 rounded-lg p-2">
                    <h2 className="text-sm font-bold mb-2 text-yellow-400">대기자 명단 ({waitingPlayers.length})</h2>
                    {maleWaitingPlayers.length > 0 && (
                        <div id="male-waiting-list" className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                            {maleWaitingPlayers.map(player => ( <PlayerCard key={player.id} player={player} context={{ location: null, selected: selectedPlayerIds.includes(player.id) }} isAdmin={isAdmin} onCardClick={handleCardClick} onAction={handleDeleteFromWaiting} onLongPress={(p) => setModal({type: 'editGames', data: { player: p }})}/> ))}
                        </div>
                    )}
                    {maleWaitingPlayers.length > 0 && femaleWaitingPlayers.length > 0 && (
                        <div className="my-2 border-t-2 border-dashed border-gray-600"></div>
                    )}
                    {femaleWaitingPlayers.length > 0 && (
                        <div id="female-waiting-list" className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                            {femaleWaitingPlayers.map(player => ( <PlayerCard key={player.id} player={player} context={{ location: null, selected: selectedPlayerIds.includes(player.id) }} isAdmin={isAdmin} onCardClick={handleCardClick} onAction={handleDeleteFromWaiting} onLongPress={(p) => setModal({type: 'editGames', data: { player: p }})}/> ))}
                        </div>
                    )}
                </section>
                
                <section>
                    <h2 className="text-sm font-bold mb-2 text-yellow-400 px-1">경기 예정</h2>
                    <div id="scheduled-matches" className="flex flex-col gap-2">
                        {scheduledMatchesArray.map((match, matchIndex) => (
                            <div key={matchIndex} className="flex items-center w-full bg-gray-800 rounded-lg p-1 gap-1">
                                <div className="flex-shrink-0 w-12 text-center">
                                    <p className="font-semibold text-[10px] text-gray-400">예정</p>
                                    <p className="font-bold text-base text-white">{matchIndex + 1}</p>
                                </div>
                                <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                    {Array(4).fill(null).map((_, slotIndex) => {
                                        const playerId = match[slotIndex];
                                        const player = players[playerId];
                                        const context = {location: 'schedule', matchIndex, slotIndex, selected: selectedPlayerIds.includes(playerId)};
                                        return player ? ( <PlayerCard key={playerId} player={player} context={context} isAdmin={isAdmin} onCardClick={handleCardClick} onAction={handleReturnToWaiting} onLongPress={(p) => setModal({type: 'editGames', data: { player: p }})}/> ) : ( <EmptySlot key={slotIndex} onSlotClick={() => handleSlotClick({ location: 'schedule', matchIndex, slotIndex })} /> )
                                    })}
                                </div>
                                <div className="flex-shrink-0 w-14 text-center">
                                     <button className={`w-full py-2 px-1 rounded-md font-semibold transition duration-300 text-[10px] ${match.filter(p=>p).length === 4 && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={match.filter(p=>p).length !== 4 || !isAdmin} onClick={() => handleStartMatch(matchIndex)}>경기 시작</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <h2 className="text-sm font-bold mb-2 text-yellow-400 px-1">경기 진행 코트</h2>
                    <div id="in-progress-courts" className="flex flex-col gap-2">
                       {inProgressCourts.map((court, courtIndex) => (
                           <div key={courtIndex} className="flex items-center w-full bg-gray-800 rounded-lg p-1 gap-1">
                                <div className="flex-shrink-0 w-12 text-center">
                                    <p className="font-bold text-base text-white">{courtIndex + 1}</p>
                                    <p className="font-semibold text-[10px] text-gray-400">코트</p>
                                </div>
                               <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                    {(court?.players || Array(4).fill(null)).map((playerId, slotIndex) => {
                                        const player = players[playerId];
                                        const context = { location: 'court', matchIndex: courtIndex, selected: selectedPlayerIds.includes(playerId) };
                                        return player ? ( <PlayerCard key={playerId || `court-empty-${courtIndex}-${slotIndex}`} player={player} context={context} isAdmin={isAdmin} onCardClick={handleCardClick} onAction={handleReturnToWaiting} onLongPress={() => setModal({type: 'moveCourt', data: { sourceCourtIndex: courtIndex }})}/> ) : ( <EmptySlot key={`court-empty-${courtIndex}-${slotIndex}`} onSlotClick={() => handleSlotClick({ location: 'court', courtIndex, slotIndex })} /> )
                                    })}
                               </div>
                                <div className="flex-shrink-0 w-14 text-center">
                                    <button className={`w-full py-2 px-1 rounded-md font-semibold transition duration-300 text-[10px] ${court && isAdmin ? 'bg-white hover:bg-gray-200 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={!court || !isAdmin} onClick={() => handleEndMatch(courtIndex)}>경기 종료</button>
                                    <CourtTimer court={court} />
                               </div>
                           </div>
                       ))}
                    </div>
                </section>
            </main>
            <style>{`.player-card {-webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none;}`}</style>
        </div>
    );
}

// ===================================================================================
// 진입 페이지 및 모달 컴포넌트들
// ===================================================================================
function EntryPage({ onEnter }) {
    const [formData, setFormData] = useState({ name: '', level: 'A조', gender: '남' });
    useEffect(() => {
        const savedUserId = localStorage.getItem('badminton-currentUser-id');
        if (savedUserId) {
             getDoc(doc(playersRef, savedUserId)).then(docSnap => {
                if (docSnap.exists()) { setFormData(docSnap.data()); }
            });
        }
    }, []);
    const handleChange = (e) => { const { name, value } = e.target; setFormData(prev => ({ ...prev, [name]: value })); };
    const handleSubmit = (e) => { e.preventDefault(); onEnter(formData); };
    return (
        <div className="bg-black text-white min-h-screen flex items-center justify-center font-sans p-4">
            <div className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-sm">
                <h1 className="text-3xl font-bold text-yellow-400 mb-6 text-center">Cockslighting</h1>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="text" name="name" placeholder="이름" value={formData.name} onChange={handleChange} className="w-full bg-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400" required />
                    <select name="level" value={formData.level} onChange={handleChange} className="w-full bg-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"><option>A조</option><option>B조</option><option>C조</option><option>D조</option></select>
                    <div className="flex justify-around text-lg">
                        <label className="flex items-center"><input type="radio" name="gender" value="남" checked={formData.gender === '남'} onChange={handleChange} className="mr-2 h-4 w-4 text-yellow-500 bg-gray-700 border-gray-600 focus:ring-yellow-500" /> 남자</label>
                        <label className="flex items-center"><input type="radio" name="gender" value="여" checked={formData.gender === '여'} onChange={handleChange} className="mr-2 h-4 w-4 text-pink-500 bg-gray-700 border-gray-600 focus:ring-pink-500" /> 여자</label>
                    </div>
                    <button type="submit" className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 rounded-lg transition duration-300">입장하기</button>
                </form>
            </div>
        </div>
    );
}
function ConfirmationModal({ title, body, onConfirm, onCancel }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-white mb-4">{title}</h3><p className="text-gray-300 mb-6">{body}</p><div className="flex gap-4"><button onClick={onCancel} className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button><button onClick={onConfirm} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg transition-colors">확인</button></div></div></div>); }
function CourtSelectionModal({ courts, onSelect, onCancel }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-yellow-400 mb-4">코트 선택</h3><p className="text-gray-300 mb-6">경기를 시작할 코트를 선택해주세요.</p><div className="flex flex-col gap-3">{courts.map(courtIdx => ( <button key={courtIdx} onClick={() => onSelect(courtIdx)} className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors">{courtIdx + 1}번 코트에서 시작</button> ))}</div><button onClick={onCancel} className="mt-6 w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button></div></div> ); }
function EditGamesModal({ player, onSave, onCancel }) {
    const [count, setCount] = useState(player.gamesPlayed);
    return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-xs text-center shadow-lg"><h3 className="text-xl font-bold text-yellow-400 mb-4">{player.name} 경기 수 수정</h3><div className="flex items-center justify-center gap-4 my-6"><button onClick={() => setCount(c => Math.max(0, c - 1))} className="px-4 py-2 bg-gray-600 rounded-full text-2xl w-14 h-14 flex items-center justify-center">-</button><span className="text-4xl font-bold w-16 text-center text-white">{count}</span><button onClick={() => setCount(c => c + 1)} className="px-4 py-2 bg-gray-600 rounded-full text-2xl w-14 h-14 flex items-center justify-center">+</button></div><div className="flex gap-4"><button onClick={onCancel} className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button><button onClick={() => onSave(count)} className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors">저장</button></div></div></div> );
}
function AlertModal({ title, body, onClose }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-yellow-400 mb-4">{title}</h3><p className="text-gray-300 mb-6">{body}</p><button onClick={onClose} className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors">확인</button></div></div> ); }
function MoveCourtModal({ sourceCourtIndex, courts, onSelect, onCancel }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-yellow-400 mb-4">{sourceCourtIndex + 1}번 코트 경기 이동</h3><p className="text-gray-300 mb-6">어느 코트로 이동/교체할까요?</p><div className="flex flex-col gap-3">{courts.map((court, idx) => { if (idx === sourceCourtIndex) return null; return ( <button key={idx} onClick={() => onSelect(sourceCourtIndex, idx)} className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 rounded-lg transition-colors">{idx + 1}번 코트</button> )})}</div><button onClick={onCancel} className="mt-6 w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button></div></div> ); }

