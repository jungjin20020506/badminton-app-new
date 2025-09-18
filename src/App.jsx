import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut, 
    onAuthStateChanged 
} from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    onSnapshot, 
    doc, 
    writeBatch,
    serverTimestamp,
    runTransaction
} from 'firebase/firestore';

// ===================================================================================
// 중요: Firebase 설정
// 여기에 본인의 Firebase 프로젝트 설정 객체를 붙여넣으세요.
// ===================================================================================
const firebaseConfig = {
    apiKey: "AIzaSyCKT1JZ8MkA5WhBdL3XXxtm_0wLbnOBi5I",
    authDomain: "project-104956788310687609.firebaseapp.com",
    projectId: "project-104956788310687609",
    storageBucket: "project-104956788310687609.firebasestorage.app",
    messagingSenderId: "384562806148",
    appId: "1:384562806148:web:d8bfb83b28928c13e671d1"
};

// Firebase 앱 초기화
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=
//  헬퍼 함수 및 상수
// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=

const COURT_COUNT = 4; // 전체 코트 수

// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=
//  메인 App 컴포넌트
// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=

function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [localUserName, setLocalUserName] = useState('');

    useEffect(() => {
        // 로컬 스토리지에서 사용자 이름 확인
        const storedName = localStorage.getItem('userName');
        if (storedName) {
            setLocalUserName(storedName);
        }

        // Firebase 인증 상태 리스너
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);
                // Firebase 로그인 시 로컬 스토리지 이름 동기화/제거
                localStorage.removeItem('userName'); 
            } else {
                setUser(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleLocalLogin = (name) => {
        if (name.trim()) {
            localStorage.setItem('userName', name.trim());
            setLocalUserName(name.trim());
        }
    };
    
    const handleLocalLogout = () => {
        localStorage.removeItem('userName');
        setLocalUserName('');
    };
    
    const handleGoogleLogin = async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Google 로그인 에러:", error);
        }
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
            handleLocalLogout(); // 모든 로그아웃 처리
        } catch (error) {
            console.error("로그아웃 에러:", error);
        }
    };
    
    if (loading) {
        return <div className="loading-screen">로딩 중...</div>;
    }

    const currentUserName = user?.displayName || localUserName;

    return (
        <div className="app-container">
            <header className="app-header">
                <h1>배드민턴 경기 관리 시스템</h1>
                {currentUserName && (
                    <div className="user-info">
                        <span>환영합니다, {currentUserName} 님</span>
                        <button onClick={handleLogout} className="logout-button">로그아웃</button>
                    </div>
                )}
            </header>
            
            {!currentUserName ? (
                <LoginScreen onLocalLogin={handleLocalLogin} onGoogleLogin={handleGoogleLogin} />
            ) : (
                <BadmintonManager />
            )}
        </div>
    );
}

// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=
//  로그인 화면 컴포넌트
// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=

function LoginScreen({ onLocalLogin, onGoogleLogin }) {
    const [name, setName] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onLocalLogin(name);
    };

    return (
        <div className="login-container">
            <h2>입장하기</h2>
            <form onSubmit={handleSubmit} className="login-form">
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="이름을 입력하세요"
                    className="name-input"
                />
                <button type="submit" className="login-button">입장</button>
            </form>
            <div className="social-login">
                <p>또는</p>
                <button onClick={onGoogleLogin} className="google-login-button">
                    Google 계정으로 로그인
                </button>
            </div>
        </div>
    );
}


// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=
//  배드민턴 관리자 메인 컴포넌트
// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=

function BadmintonManager() {
    const [players, setPlayers] = useState([]);
    const [courts, setCourts] = useState(Array(COURT_COUNT).fill(null));
    const [selectedPlayers, setSelectedPlayers] = useState([]);
    const [error, setError] = useState('');
    const [movePlayerInfo, setMovePlayerInfo] = useState(null); // 코트 이동/교체 모달 상태

    // 데이터베이스 실시간 구독
    useEffect(() => {
        const unsubscribePlayers = onSnapshot(collection(db, "players"), (snapshot) => {
            const playersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setPlayers(playersData);
        });

        const unsubscribeCourts = onSnapshot(collection(db, "courts"), (snapshot) => {
            const courtsData = Array(COURT_COUNT).fill(null);
            snapshot.docs.forEach(doc => {
                const court = { id: doc.id, ...doc.data() };
                if (court.courtIndex >= 0 && court.courtIndex < COURT_COUNT) {
                    courtsData[court.courtIndex] = court;
                }
            });
            setCourts(courtsData);
        });

        return () => {
            unsubscribePlayers();
            unsubscribeCourts();
        };
    }, []);
    
    const showError = (message) => {
        setError(message);
        setTimeout(() => setError(''), 3000);
    };

    // 선수 카드 클릭 핸들러 (다중 선택)
    const handlePlayerCardClick = (playerId) => {
        setSelectedPlayers(prev => 
            prev.includes(playerId) 
                ? prev.filter(id => id !== playerId)
                : [...prev, playerId]
        );
    };
    
    // '경기 예정' 테이블로 일괄 이동
    const handleMoveToScheduled = async () => {
        if (selectedPlayers.length === 0) {
            showError("이동할 선수를 먼저 선택해주세요.");
            return;
        }

        const scheduledPlayersCount = players.filter(p => p.status === 'scheduled').length;
        // 예시: 경기 예정 테이블의 최대 인원을 8명으로 가정
        const availableSlots = 8 - scheduledPlayersCount; 

        if (selectedPlayers.length > availableSlots) {
            showError(`선택한 선수의 수(${selectedPlayers.length}명)가 빈자리(${availableSlots}개)보다 많습니다.`);
            return;
        }

        // 낙관적 UI 업데이트 (선택 사항, 실시간 DB에서는 즉시 반영되므로 큰 효과 없을 수 있음)
        // const updatedPlayers = players.map(p => 
        //     selectedPlayers.includes(p.id) ? { ...p, status: 'scheduled' } : p
        // );
        // setPlayers(updatedPlayers);

        try {
            const batch = writeBatch(db);
            selectedPlayers.forEach(playerId => {
                const playerRef = doc(db, "players", playerId);
                batch.update(playerRef, { status: 'scheduled' });
            });
            await batch.commit();
            setSelectedPlayers([]); // 성공 시 선택 해제
        } catch (err) {
            console.error("일괄 이동 실패:", err);
            showError("다른 관리자가 변경하여 작업에 실패했습니다. 다시 시도해주세요.");
            // 낙관적 UI 업데이트를 했다면 여기서 원래 상태로 롤백
            // setPlayers(players); 
        }
    };
    
    // 경기 진행 중 선수 길게 누르기 핸들러
    const handlePlayerLongPress = (player) => {
        setMovePlayerInfo(player);
    };

    // 코트 이동/교체 실행
    const handleCourtChange = async (targetCourtIndex) => {
        if (!movePlayerInfo) return;

        const sourcePlayer = movePlayerInfo;
        const sourceCourtIndex = courts.findIndex(c => c && c.players.some(p => p.id === sourcePlayer.id));
        const sourceCourt = courts[sourceCourtIndex];
        const targetCourt = courts[targetCourtIndex];

        try {
            await runTransaction(db, async (transaction) => {
                const sourceCourtRef = doc(db, "courts", sourceCourt.id);
                
                if (!targetCourt) { // 시나리오 A: 빈 코트로 이동
                    const newCourtRef = doc(collection(db, "courts"));
                    transaction.set(newCourtRef, {
                        ...sourceCourt,
                        courtIndex: targetCourtIndex,
                        id: newCourtRef.id // 문서 ID도 저장
                    });
                    transaction.delete(sourceCourtRef);
                } else { // 시나리오 B: 코트 교체
                    const targetCourtRef = doc(db, "courts", targetCourt.id);
                    // Firestore 트랜잭션 내에서는 읽기 후 쓰기를 수행해야 함
                    const sourceCourtDoc = await transaction.get(sourceCourtRef);
                    const targetCourtDoc = await transaction.get(targetCourtRef);

                    if (!sourceCourtDoc.exists() || !targetCourtDoc.exists()) {
                        throw "코트 정보를 찾을 수 없습니다.";
                    }

                    const sourceCourtData = sourceCourtDoc.data();
                    const targetCourtData = targetCourtDoc.data();

                    // Swap
                    transaction.update(sourceCourtRef, { ...targetCourtData, courtIndex: sourceCourtIndex });
                    transaction.update(targetCourtRef, { ...sourceCourtData, courtIndex: targetCourtIndex });
                }
            });
        } catch (err) {
            console.error("코트 이동/교체 실패:", err);
            showError("코트 이동/교체에 실패했습니다. 다시 시도해주세요.");
        } finally {
            setMovePlayerInfo(null); // 모달 닫기
        }
    };

    // 선수 리스트 필터링
    const waitingPlayers = players.filter(p => p.status === 'waiting');
    const scheduledPlayers = players.filter(p => p.status === 'scheduled');
    const playingPlayers = players.filter(p => p.status === 'playing');

    return (
        <div className="manager-container">
            {error && <div className="error-toast">{error}</div>}
            
            {movePlayerInfo && (
                <CourtMoveModal
                    player={movePlayerInfo}
                    courts={courts}
                    onSelectCourt={handleCourtChange}
                    onClose={() => setMovePlayerInfo(null)}
                />
            )}

            <div className="player-sections">
                <section className="player-list-section">
                    <h2>선수 대기 ({waitingPlayers.length})</h2>
                    <div className="player-list">
                        {waitingPlayers.map(player => (
                            <PlayerCard 
                                key={player.id} 
                                player={player} 
                                isSelected={selectedPlayers.includes(player.id)}
                                onClick={() => handlePlayerCardClick(player.id)}
                            />
                        ))}
                    </div>
                </section>

                <section className="player-list-section">
                    <h2>경기 예정 ({scheduledPlayers.length})</h2>
                    <div className="player-list scheduled-box" onClick={handleMoveToScheduled}>
                        {scheduledPlayers.map(player => (
                            <PlayerCard key={player.id} player={player} />
                        ))}
                        {scheduledPlayers.length === 0 && <div className="placeholder-text">선택한 선수를 여기로 옮기세요</div>}
                    </div>
                </section>
            </div>

            <section className="court-section">
                <h2>경기 진행</h2>
                <div className="court-grid">
                    {courts.map((court, index) => (
                        <div key={index} className="court">
                            <h3>{index + 1}번 코트</h3>
                            <div className="court-players">
                                {court ? (
                                    court.players.map(player => (
                                       <PlayerCard 
                                         key={player.id}
                                         player={players.find(p => p.id === player.id)}
                                         isLongPressable={true}
                                         onLongPress={handlePlayerLongPress}
                                       />
                                    ))
                                ) : (
                                    <div className="placeholder-text">빈 코트</div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=
//  재사용 가능한 PlayerCard 컴포넌트
// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=

function PlayerCard({ player, isSelected, onClick, isLongPressable, onLongPress }) {
    const longPressTimer = useRef();

    const handleContextMenu = (e) => {
        // 모바일 길게 누르기 기본 동작(컨텍스트 메뉴) 방지
        e.preventDefault();
    };

    const handleMouseDown = () => {
        if (!isLongPressable) return;
        longPressTimer.current = setTimeout(() => {
            onLongPress(player);
        }, 700); // 700ms 이상 누르면 롱 프레스로 간주
    };

    const handleMouseUp = () => {
        clearTimeout(longPressTimer.current);
    };

    const handleTouchStart = () => handleMouseDown();
    const handleTouchEnd = () => handleMouseUp();
    
    if (!player) return null;

    return (
        <div
            className={`player-card ${isSelected ? 'selected' : ''}`}
            onClick={onClick}
            onContextMenu={handleContextMenu}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            <span className="player-name">{player.name}</span>
            <span className="player-matches">({player.matchCount || 0}회)</span>
        </div>
    );
}

// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=
//  코트 이동/교체 모달 컴포넌트
// =_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=_=

function CourtMoveModal({ player, courts, onSelectCourt, onClose }) {
    const currentCourtIndex = courts.findIndex(c => c && c.players.some(p => p.id === player.id));

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h3>"{player.name}" 선수 이동</h3>
                <p>몇 번 코트로 이동/교체할까요?</p>
                <div className="court-selection-buttons">
                    {Array.from({ length: COURT_COUNT }).map((_, index) => {
                        if (index === currentCourtIndex) return null;
                        return (
                            <button 
                                key={index} 
                                onClick={() => onSelectCourt(index)}
                                className="court-select-button"
                            >
                                {index + 1}번 코트
                                {courts[index] ? ' (교체)' : ' (이동)'}
                            </button>
                        );
                    })}
                </div>
                <button onClick={onClose} className="modal-close-button">취소</button>
            </div>
        </div>
    );
}


export default App;

