import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    doc, getDoc, setDoc, updateDoc, writeBatch, runTransaction,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
    db, storage, playersRef, gameStateRef, configRef, somoimSyncRef,
    firebaseService, readyPromise, runDailyResetIfDue, runAutoSomoimSyncIfDue,
    syncSomoimAttendees, getKstParts,
} from './lib/firebase';
import {
    getAdminNames, generateId, filterTodayGames, calculateLocations,
    PLAYERS_PER_MATCH, LEVEL_ORDER,
} from './lib/helpers';
import {
    findSingleBestMatch, findSingleBestMixedMatch, getBestLevelSplit, getBestMixedLevelSplit,
    getAutoMatchMinScore, getSensitivity,
} from './lib/matching';
import { WaitingListSection, ScheduledMatchesSection, AutoMatchesSection, InProgressCourtsSection } from './components/Sections';
import { EntryPage } from './components/EntryPage';
import { SeasonModal, AdminEditPlayerModal, ConfirmationModal, AlertModal, CourtSelectionModal, SomoimSyncResultModal, MyHistoryModal } from './components/Modals';
import { SkeletonScreen } from './components/Skeleton';
import { SettingsModal } from './components/SettingsModal';
import { RosterManageModal } from './components/RosterManageModal';
import {
    readLocalTutorialSeen, markTutorialSeen, TUTORIAL_ADMIN_STEPS, TUTORIAL_USER_STEPS,
    TutorialIntroModal, TutorialOverlay,
} from './tutorial/Tutorial';

// ===================================================================================
// Main App Component
// ===================================================================================
export default function App() {
    const [allPlayers, setAllPlayers] = useState({});
    const [gameState, setGameState] = useState(null);
    const [seasonConfig, setSeasonConfig] = useState(null);
    // [선수 명단/소모임 동기화] 명단과 동기화 상태
    const [roster, setRoster] = useState({});
    const [somoimSync, setSomoimSync] = useState(null);
    const [isRosterOpen, setIsRosterOpen] = useState(false);
       const [currentUser, setCurrentUser] = useState(null);

    // --- [인앱 브라우저 감지 상태] ---
    const [isInAppBrowser, setIsInAppBrowser] = useState(false);

   useEffect(() => {
        // 인앱 브라우저 감지 (카카오톡, 라인, 인스타그램 등)
        const userAgent = navigator.userAgent.toLowerCase();
        const inAppKeywords = ['kakao', 'line', 'instagram', 'naver', 'everytime'];
        const isIab = inAppKeywords.some(keyword => userAgent.includes(keyword));
        setIsInAppBrowser(isIab);
    }, []);
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
    // [디자인 개편] 상단 아바타 프로필 메뉴 열림 상태
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

    // [튜트리얼] { mode: 'admin' | 'user', phase: 'intro' | 'run', step: number } · null이면 끔
    const [tutorial, setTutorial] = useState(null);
    // 자동 실행은 한 접속당 한 번만 시도한다(닫은 뒤 다시 뜨는 것 방지)
    const tutorialAutoTriedRef = useRef(false);

    // [당겨서 새로고침] PWA standalone 모드에는 브라우저 기본 새로고침이 없으므로 직접 구현
    const mainScrollRef = useRef(null);
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        const el = mainScrollRef.current;
        if (!el) return;
        const THRESHOLD = 55;    // 이 거리 이상 당기면 새로고침 실행
        const MAX_PULL = 100;    // 최대 당김 거리
        let startY = 0;
        let pulling = false;
        let currentPull = 0;

        const onTouchStart = (e) => {
            if (isRefreshing) return;
            // 스크롤이 최상단일 때만 당김 제스처 시작
            if (el.scrollTop <= 0) {
                startY = e.touches[0].clientY;
                pulling = true;
                currentPull = 0;
            }
        };
        const onTouchMove = (e) => {
            if (!pulling || isRefreshing) return;
            const delta = e.touches[0].clientY - startY;
            if (delta > 0 && el.scrollTop <= 0) {
                e.preventDefault(); // 당기는 동안 콘텐츠 스크롤/바운스 방지
                currentPull = Math.min(MAX_PULL, delta * 0.55); // 저항감 적용
                setPullDistance(currentPull);
            } else {
                // 다시 위로 올리거나 아래로 스크롤하면 취소
                pulling = false;
                currentPull = 0;
                setPullDistance(0);
            }
        };
        const finishPull = () => {
            if (!pulling) return;
            pulling = false;
            if (currentPull >= THRESHOLD) {
                setIsRefreshing(true);
                setPullDistance(THRESHOLD);
                // 스피너를 잠깐 보여준 뒤 새로고침
                setTimeout(() => window.location.reload(), 450);
            } else {
                setPullDistance(0);
            }
            currentPull = 0;
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', finishPull, { passive: true });
        el.addEventListener('touchcancel', finishPull, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', finishPull);
            el.removeEventListener('touchcancel', finishPull);
        };
    }, [isRefreshing, isLoading, currentUser, isInAppBrowser]);

    // [스와이프 탭 전환] 모바일에서 화면을 좌우로 밀어 경기 예정 ↔ 경기 진행 이동
    useEffect(() => {
        if (!isMobile || isLoading || !currentUser) return;
        const el = mainScrollRef.current;
        if (!el) return;
        let sx = 0, sy = 0, tracking = false;
        const onStart = (e) => {
            sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
        };
        const onEnd = (e) => {
            if (!tracking) return;
            tracking = false;
            const dx = e.changedTouches[0].clientX - sx;
            const dy = e.changedTouches[0].clientY - sy;
            // 수평 이동이 충분히 크고, 수직 스크롤보다 확실히 수평일 때만
            if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.8) {
                setActiveTab(dx < 0 ? 'inProgress' : 'matching');
            }
        };
        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchend', onEnd, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchend', onEnd);
        };
    }, [isMobile, isLoading, currentUser]);

    // [관리자 권한] 설정에서 관리하는 관리자 목록(config/season.adminNames) 기준으로 판정
    const adminNames = useMemo(() => getAdminNames(seasonConfig), [seasonConfig]);
    const isAdmin = !!currentUser && adminNames.includes(currentUser.name);
    const autoMatches = gameState?.autoMatches || {};
    // [자동매칭] '매칭 만들기' 중복 실행 방지 (버튼 연타 방지)
    const isGeneratingRef = useRef(false);
    const [generatingGender, setGeneratingGender] = useState(null);

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

        return () => {
            window.removeEventListener('resize', handleResize);
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
            setRoster(firebaseService.getRoster());
            setSomoimSync(firebaseService.getSomoimSync());
            setIsLoading(false);

            const unsubscribe = firebaseService.subscribe(() => {
                const updatedPlayers = firebaseService.getAllPlayers();
                setAllPlayers(updatedPlayers);
                setGameState(firebaseService.getGameState());
                setSeasonConfig(firebaseService.getSeasonConfig());
                setRoster(firebaseService.getRoster());
                setSomoimSync(firebaseService.getSomoimSync());

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

    // [새벽 2시 자동 초기화] 앱이 열려 있는 동안 운영일(새벽 2시 기준)이 바뀌면
    // 모든 선수 내보내기 + 일일 기록/게임 수 삭제 + 경기방 비우기를 수행한다.
    // 트랜잭션으로 단 하나의 클라이언트만 실행하므로 여러 기기가 동시에 켜져 있어도 안전하다.
    useEffect(() => {
        if (isLoading) return;
        runDailyResetIfDue();                                   // 진입 즉시 1회 확인
        const intervalId = setInterval(runDailyResetIfDue, 60 * 1000); // 이후 1분마다 확인
        return () => clearInterval(intervalId);
    }, [isLoading]);

    // [소모임 동기화] 정모 당일 18시(KST)가 지나면 참석 인원에 맞춰 선수카드를 자동 생성.
    // 새벽 2시 초기화와 동일하게 1분마다 확인하며, 트랜잭션으로 한 기기만 실행한다.
    useEffect(() => {
        if (isLoading) return;
        runAutoSomoimSyncIfDue();
        const intervalId = setInterval(runAutoSomoimSyncIfDue, 60 * 1000);
        return () => clearInterval(intervalId);
    }, [isLoading]);

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

    // ── [튜트리얼] 첫 접속 온보딩 ─────────────────────────────────────────────
    // 공지창이 뜰 차례라면 튜트리얼은 기다린다. (두 창이 겹쳐 뜨는 것 방지)
    const seasonModalPending = useMemo(() => {
        if (isLoading || !seasonConfig) return true;
        if (seasonConfig.announcementType === 'none') return false;
        if (isSeasonModalDismissed) return false;
        return localStorage.getItem(`seen-${seasonConfig.seasonId}`) !== new Date().toDateString();
    }, [isLoading, seasonConfig, isSeasonModalDismissed]);

    // 관리자 권한을 받은 뒤 첫 1회 / 일반 선수 첫 입장 1회 자동 실행
    useEffect(() => {
        if (isLoading || !currentUser || isInAppBrowser) return;
        if (tutorial || tutorialAutoTriedRef.current) return;
        if (seasonModalPending || modal?.type || isSettingsOpen || isRosterOpen) return;

        // 선수 문서 기록이 기준이고, 로컬 기록은 오프라인 대비 보조 수단이다.
        const seen = { ...readLocalTutorialSeen(currentUser.id), ...(currentUser.tutorialSeen || {}) };
        const mode = isAdmin ? (seen.admin ? null : 'admin') : (seen.user ? null : 'user');
        if (!mode) return;

        const timer = setTimeout(() => {
            tutorialAutoTriedRef.current = true;
            setTutorial({ mode, phase: 'intro', step: 0 });
        }, 700);
        return () => clearTimeout(timer);
    }, [isLoading, currentUser, isAdmin, isInAppBrowser, tutorial, seasonModalPending, modal, isSettingsOpen, isRosterOpen]);

    // 환경에 없는 단계(모바일 전용 등)는 걸러낸다
    const tutorialSteps = useMemo(() => {
        if (!tutorial) return [];
        const raw = tutorial.mode === 'admin' ? TUTORIAL_ADMIN_STEPS : TUTORIAL_USER_STEPS;
        return raw.filter(s => !s.only || (s.only === 'mobile' ? isMobile : !isMobile));
    }, [tutorial, isMobile]);

    // 각 단계가 요구하는 화면(설정창·명단창·프로필 메뉴·모바일 탭)을 열어준다
    const prepareTutorialStep = useCallback((step) => {
        const surface = step?.surface || 'main';
        setIsProfileMenuOpen(surface === 'menu');
        setIsSettingsOpen(surface === 'settings' || surface === 'roster');
        setIsRosterOpen(surface === 'roster');
        if (step?.tab && isMobile) setActiveTab(step.tab);
    }, [isMobile]);

    const finishTutorial = useCallback((mode) => {
        setTutorial(null);
        setIsProfileMenuOpen(false);
        setIsSettingsOpen(false);
        setIsRosterOpen(false);
        setActiveTab('matching'); // 끝나면 기본 화면(경기 예정 탭)으로
        if (currentUser) markTutorialSeen(currentUser.id, mode);
    }, [currentUser]);

    const handleTutorialNext = useCallback(() => {
        if (!tutorial) return;
        if (tutorial.step >= tutorialSteps.length - 1) {
            finishTutorial(tutorial.mode);
            return;
        }
        setTutorial({ ...tutorial, step: tutorial.step + 1 });
    }, [tutorial, tutorialSteps.length, finishTutorial]);

    const handleTutorialPrev = useCallback(() => {
        setTutorial(t => (t ? { ...t, step: Math.max(0, t.step - 1) } : t));
    }, []);

    // 프로필 메뉴 ▸ 튜트리얼 다시 보기 (관리자는 관리자용, 일반 선수는 사용자용)
    const handleReplayTutorial = useCallback(() => {
        tutorialAutoTriedRef.current = true;
        setModal({ type: null, data: null });
        setIsSettingsOpen(false);
        setIsRosterOpen(false);
        setTutorial({ mode: isAdmin ? 'admin' : 'user', phase: 'intro', step: 0 });
    }, [isAdmin]);

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
        const name = (formData.name || '').trim();
        let { level, gender } = formData;
        const isGuest = !!formData.isGuest;
        if (!name) { setModal({ type: 'alert', data: { title: '오류', body: '이름을 입력해주세요.' }}); return; }

        // [선수 명단] 일반(회원) 선수는 급수를 선택하지 않는다 — 명단에서 자동으로 가져온다.
        // 명단에 없으면 입장 불가 (EntryPage에서 1차로 걸러지지만, 이중 안전장치)
        if (!isGuest) {
            const rosterEntry = Object.values(firebaseService.getRoster() || {}).find(r => r.name === name);
            if (!rosterEntry || !rosterEntry.level || !rosterEntry.gender) {
                setModal({ type: 'alert', data: { title: '입장 불가', body: '등록된 선수 정보가 없습니다. 관리자에게 문의해주세요.' }});
                return;
            }
            level = rosterEntry.level;
            gender = rosterEntry.gender;
        }
        if (!level || !gender) { setModal({ type: 'alert', data: { title: '오류', body: '급수와 성별을 선택해주세요.' }}); return; }
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
        // [내 기록] 일반 선수는 자기 카드를 탭하면 오늘 기록을 볼 수 있다
        if (!isAdmin) {
            if (currentUser && playerId === currentUser.id) {
                setModal({ type: 'myHistory', data: null });
            }
            return;
        }
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
    }, [isAdmin, currentUser, selectedPlayerIds, findPlayerLocation, updateGameState, courtMove]);

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

                // [중복 방지 #1] 동시에 여러 관리자가 START를 눌렀을 때, 대상 코트가
                // 이미 사용 중이면 이 트랜잭션은 중단한다. (코트 덮어쓰기/중복 배정 방지)
                if (newState.inProgressCourts[courtIndex]) {
                    throw new Error("이미 다른 관리자가 이 코트에서 경기를 시작했습니다.");
                }

                if (matchType === 'schedule') {
                    const currentMatch = newState.scheduledMatches[String(matchIndex)] || [];
                    if(currentMatch.filter(p=>p).length !== PLAYERS_PER_MATCH) {
                        throw new Error("경기를 시작할 수 없습니다. 다른 관리자가 먼저 시작했을 수 있습니다.");
                    }
                    playersToMove = [...currentMatch];
                } else { // 'auto'
                    const currentMatch = newState.autoMatches[String(matchIndex)] || [];
                    if(currentMatch.filter(p=>p).length !== PLAYERS_PER_MATCH) {
                        throw new Error("경기를 시작할 수 없습니다. 다른 관리자가 먼저 시작했을 수 있습니다.");
                    }
                    playersToMove = [...currentMatch];
                }

                // [중복 방지 #2] 이 선수들이 이미 다른 코트에서 경기 중이면 중단한다.
                // (동일 경기가 두 코트에 올라가 히스토리/경기수가 2배로 쌓이는 문제 방지)
                const playersAlreadyOnCourt = new Set(
                    newState.inProgressCourts
                        .filter(c => c && c.players)
                        .flatMap(c => c.players)
                        .filter(Boolean)
                );
                if (playersToMove.some(pid => pid && playersAlreadyOnCourt.has(pid))) {
                    throw new Error("선택한 선수가 이미 다른 코트에서 경기 중입니다.");
                }

                // 검증 통과 후에만 목록에서 제거/시프트한다.
                if (matchType === 'schedule') {
                    // 수동 매칭 목록 당기기
                    for (let i = matchIndex; i < newState.numScheduledMatches - 1; i++) {
                        newState.scheduledMatches[String(i)] = newState.scheduledMatches[String(i + 1)] || Array(PLAYERS_PER_MATCH).fill(null);
                    }
                    newState.scheduledMatches[String(newState.numScheduledMatches - 1)] = Array(PLAYERS_PER_MATCH).fill(null);
                } else { // 'auto'
                    // 자동 매칭 목록에서 제거 및 재인덱싱
                    delete newState.autoMatches[matchIndex];
                    const reindexedMatches = {};
                    Object.values(newState.autoMatches).forEach((m, i) => {
                        reindexedMatches[String(i)] = m;
                    });
                    newState.autoMatches = reindexedMatches;
                }

                newState.inProgressCourts[courtIndex] = {
                    players: playersToMove,
                    startTime: new Date().toISOString(),
                    matchId: `${courtIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                };

                return { newState };
            };

            await updateGameState(updateFunction, '경기를 시작하는 데 실패했습니다. 다른 관리자가 먼저 시작했을 수 있습니다.');

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
        // [나간 선수] 코트만 존재하면 종료 가능. 나간 선수(빈 슬롯)가 있어도 막지 않는다.
        if (!court || !court.players) return;

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
                            //    (코트가 null이면 이미 종료된 것이므로 히스토리가 중복으로 쌓이지 않는다.)
                            if (!currentCourt || !currentCourt.players) {
                                return; // 이미 다른 관리자에 의해 종료됨
                            }

                            const allMatchPlayerIds = currentCourt.players;
                            // [나간 선수] 나간 선수(null)는 제외하고 실제 남아있는 선수만 기록 처리
                            const validPlayerIds = allMatchPlayerIds.filter(Boolean);
                            const now = new Date().toISOString();

                            const teamA = [allMatchPlayerIds[0], allMatchPlayerIds[1]].filter(Boolean);
                            const teamB = [allMatchPlayerIds[2], allMatchPlayerIds[3]].filter(Boolean);

                            // 3. 최신 선수 데이터 가져오기 (동시성 보장)
                            const playerRefs = validPlayerIds.map(pId => doc(playersRef, pId));
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

                                // 최근 20경기 유지 (공평 계산용 경기수 누적 + 다양성 판단)
                                const recentGames = (pData.todayRecentGames || []).slice(0, 19);
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

    // [자동 매칭] '매칭 만들기' — 버튼을 누를 때마다 "한 경기"만 생성한다.
    //  (기존: ON/OFF + 3초 주기 자동 생성 → 변경: 관리자가 누를 때마다 1경기)
    //  매칭 기준(점수·민감도·급수 밸런스·휴식 제외)은 기존 자동매칭과 완전히 동일하다.
    //  gender: '남' | '여' | '혼복'(남2+여2, 팀은 남1+여1로 배치)
    const handleGenerateMatch = useCallback(async (gender) => {
        const isMixed = gender === '혼복';
        const genderLabel = isMixed ? '혼복' : (gender === '남' ? '남자' : '여자');

        if (!isAdmin || isGeneratingRef.current) return;
        if (!allPlayers || !gameState) {
            setModal({ type: 'alert', data: { title: '잠시만요', body: '데이터를 불러오는 중입니다. 잠시 후 다시 눌러주세요.' }});
            return;
        }

        isGeneratingRef.current = true;
        setGeneratingGender(gender);
        try {
            const config = seasonConfig?.autoMatchConfig || {};

            // 현재 자동 매칭 목록에 있는 선수들
            const autoMatchedPlayerIds = new Set(
                Object.values(gameState.autoMatches || {}).flatMap(match => match)
            );

            // '휴식' 중이거나 이미 '자동 매칭' 목록에 있는 선수는 풀에서 제외
            const pool = waitingPlayers.filter(p =>
                (isMixed || p.gender === gender) &&
                !autoMatchedPlayerIds.has(p.id) &&
                !p.isResting // <-- 휴식 선수 제외
            );

            // 커트라인은 "대기석"이 아니라 현재 접속 중인 전체 인원 기준으로 계산한다.
            //  (경기대기 + 경기예정 + 경기진행에 있는 해당 성별 선수 모두 포함, 휴식/비활성 제외, 게스트 포함)
            //  혼복은 남녀 전체 인원 기준.
            const genderActive = Object.values(allPlayers)
                .filter(p => p.status === 'active' && !p.isResting && (isMixed || p.gender === gender));

            // [자동매칭] 민감도 프리셋 → 커트라인 오프셋 (성별별 따로 설정 가능, 혼복은 대표 민감도 사용)
            const masterSens = config.sensitivity || 'normal';
            const perGender = !!config.perGenderSensitivity;
            const sensKey = (perGender && !isMixed)
                ? ((gender === '남' ? config.maleSensitivity : config.femaleSensitivity) || masterSens)
                : masterSens;
            const sens = getSensitivity(sensKey);
            const appliedMinScore = getAutoMatchMinScore(genderActive.length) + sens.offset;

            // [공평 강화] 대기시간/경기차 보정용 컨텍스트 (해당 풀 최다 경기수 기준)
            const fairnessCtx = {
                now: Date.now(),
                maxGames: genderActive.reduce((m, p) => Math.max(m, p.todayRecentGames?.length ?? 0), 0),
            };

            const result = isMixed
                ? findSingleBestMixedMatch(
                    pool.filter(p => p.gender === '남'),
                    pool.filter(p => p.gender === '여'),
                    allPlayers, appliedMinScore, fairnessCtx)
                : findSingleBestMatch(pool, allPlayers, appliedMinScore, fairnessCtx);

            // (1) 매칭 가능한 대기 인원 부족
            if (result.status === 'notEnough') {
                setModal({ type: 'alert', data: {
                    title: `${genderLabel} 매칭 불가`,
                    body: isMixed
                        ? `혼복 매칭은 남자 2명, 여자 2명 이상 대기해야 합니다.\n(현재 남 ${result.maleCount}명 · 여 ${result.femaleCount}명 · 휴식/이미 매칭된 선수 제외)`
                        : `매칭할 수 있는 ${genderLabel} 대기 선수가 4명 이상이어야 합니다.\n(현재 ${result.poolSize}명 · 휴식/이미 매칭된 선수 제외)`
                }});
                return;
            }

            // (2) 조합은 있지만 전부 최소 점수(커트라인) 미달 → 매칭 난이도 낮추기 안내
            if (result.status === 'belowMinScore') {
                setModal({ type: 'alert', data: {
                    title: '매칭 난이도를 낮춰주세요',
                    body: `지금 만들 수 있는 ${genderLabel} 조합이 모두 기준 점수에 못 미칩니다.\n(가장 좋은 조합 ${result.bestScore}점 / 기준 ${result.minScore}점)\n\n현재 민감도는 '${sens.label}(${sens.short})' 입니다.\n설정 ▸ 🤖 콕스타 자동 매칭 ▸ 매칭 민감도를 한 단계 낮추거나(예: 높음 → 보통), 경기가 끝나 대기 선수가 늘어난 뒤 다시 눌러주세요.`
                }});
                return;
            }

            // (3) 정상 생성 — 자동 매칭 목록 맨 뒤에 1경기 추가
            let added = true;
            await updateGameState((currentState) => {
                const newState = JSON.parse(JSON.stringify(currentState));
                if (!newState.autoMatches) newState.autoMatches = {};

                // 트랜잭션 내부에서 "현재 DB 상태"의 선수 목록을 다시 확인한다.
                // (다른 관리자가 방금 같은 선수를 매칭에 넣었을 수 있음)
                const currentAutoMatchedIds = new Set(
                    Object.values(newState.autoMatches).flatMap(match => match)
                );
                if (result.match.some(p => currentAutoMatchedIds.has(p.id))) {
                    added = false;
                    return { newState };
                }

                // [급수 밸런스] 두 팀(슬롯 0,1 / 2,3)의 급수가 최대한 맞도록 선수 순서 재배열
                // 혼복은 반드시 남1+여1 vs 남1+여1이 되도록 전용 분배를 쓴다
                const balancedOrder = isMixed
                    ? getBestMixedLevelSplit(result.match, allPlayers)
                    : getBestLevelSplit(result.match, allPlayers).order;
                const nextIndex = Object.keys(newState.autoMatches).length;
                newState.autoMatches[String(nextIndex)] = balancedOrder.map(p => p.id); // Store IDs
                return { newState };
            }, "자동 매칭 생성에 실패했습니다.");

            if (!added) {
                setModal({ type: 'alert', data: {
                    title: '다시 눌러주세요',
                    body: '방금 다른 관리자가 같은 선수를 매칭에 넣었습니다. 한 번 더 눌러주세요.'
                }});
            }
        } catch (error) {
            console.error("Auto-match generate error:", error);
            setModal({ type: 'alert', data: { title: '오류', body: '자동 매칭 생성에 실패했습니다.' }});
        } finally {
            isGeneratingRef.current = false;
            setGeneratingGender(null);
        }
    }, [isAdmin, seasonConfig, allPlayers, gameState, waitingPlayers, updateGameState]);

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
        // [내 기록] 일반 선수도 자동 매칭에 올라간 자기 카드를 탭하면 기록을 볼 수 있다
        if (!isAdmin) {
            const pid = gameState?.autoMatches?.[matchIndex]?.[slotIndex];
            if (pid && currentUser && pid === currentUser.id) {
                setModal({ type: 'myHistory', data: null });
            }
            return;
        }

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

    }, [isAdmin, currentUser, gameState, selectedPlayerIds, handleCardClick, handleSlotClick]);

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

    // [소모임 동기화] 관리자 설정의 '소모임 동기화' 버튼 — 당일 정모 참석 인원과 동일하게
    // 선수카드를 생성한다. (이미 입장한 선수는 건드리지 않으므로 여러 번 눌러도 안전)
    const handleSomoimSync = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '소모임 정모 동기화',
            body: '오늘 소모임 정모의 참석 인원을 확인하여 선수카드를 자동 생성합니다. 진행할까요?',
            onConfirm: async () => {
                setModal({ type: 'alert', data: { title: '동기화 중...', body: '소모임에서 참석 명단을 가져오고 있습니다. 잠시만 기다려주세요.' }});
                try {
                    const result = await syncSomoimAttendees();
                    // 수동 동기화 성공 시 자동 동기화 오류 상태도 함께 해소한다
                    const { dateKey } = getKstParts();
                    await setDoc(somoimSyncRef, {
                        lastResult: { ...result, at: new Date().toISOString(), trigger: 'manual' },
                        lastError: null,
                        ...(result.noEvent ? {} : { auto: { key: dateKey, status: 'done', finishedAt: new Date().toISOString() } }),
                    }, { merge: true }).catch(err => console.error('[소모임 동기화] 결과 기록 실패:', err));
                    setModal({ type: 'somoimSyncResult', data: result });
                } catch (e) {
                    const code = e.code || 'UNKNOWN';
                    console.error('[소모임 동기화] 수동 동기화 실패:', code, e);
                    setModal({ type: 'alert', data: {
                        title: '동기화 실패',
                        body: `소모임 동기화에 실패하였습니다 (오류코드: ${code}) 관리자에게 문의해주세요.\n\n${e.message || ''}`,
                    }});
                }
            }
        }});
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

            // 1. 코트 수(gameState)는 동시성 보장을 위해 트랜잭션으로 갱신
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
            });

            // 2. 설정(config)은 gameState 경합과 분리하여 별도로 확실히 저장한다.
            //    (자동매칭 스케줄러가 gameState를 자주 갱신해도 설정 저장이 누락되지 않도록 함)
            // Firestore에 저장하기 전, File 객체 필드를 확실히 제거
            const pureAutoMatchConfig = { ...autoMatchConfig };
            delete pureAutoMatchConfig.photoFile;
            // 공지 타입/사진을 객체 내부에도 기록하여 초기 로드 시 누락 방지
            pureAutoMatchConfig.announcementType = announcementType || 'text';
            pureAutoMatchConfig.announcementPhotoUrl = finalPhotoUrl;

            // [자동매칭] ON/OFF 방식 폐지 — 이제 '매칭 만들기' 버튼으로 1경기씩 만든다.
            delete pureAutoMatchConfig.isMaleEnabled;
            delete pureAutoMatchConfig.isFemaleEnabled;
            delete pureAutoMatchConfig.isEnabled;

            // [자동매칭] 민감도 프리셋 저장 (기본값 normal)
            pureAutoMatchConfig.sensitivity = pureAutoMatchConfig.sensitivity || 'normal';
            pureAutoMatchConfig.perGenderSensitivity = !!pureAutoMatchConfig.perGenderSensitivity;
            pureAutoMatchConfig.maleSensitivity = pureAutoMatchConfig.maleSensitivity || pureAutoMatchConfig.sensitivity;
            pureAutoMatchConfig.femaleSensitivity = pureAutoMatchConfig.femaleSensitivity || pureAutoMatchConfig.sensitivity;
            // 더 이상 쓰지 않는 수동 점수 필드 제거(있으면)
            delete pureAutoMatchConfig.minMaleScore;
            delete pureAutoMatchConfig.minFemaleScore;
            delete pureAutoMatchConfig.isManualConfig;

            await setDoc(configRef, {
                announcement,
                autoMatchConfig: pureAutoMatchConfig,
                announcementType: announcementType || 'text', // 루트 레벨 저장
                announcementPhotoUrl: finalPhotoUrl // 루트 레벨 저장
            }, { merge: true });

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

    // [COX UI] 하단 FAB: 내 카드 위치로 스크롤 + 하이라이트 (모바일에선 알맞은 탭으로 전환)
    const handleLocateMe = useCallback(() => {
        if (!currentUser) return;
        const onCourt = inProgressPlayerIds.has(currentUser.id);
        if (isMobile) setActiveTab(onCourt ? 'inProgress' : 'matching');
        setTimeout(() => {
            const el = document.getElementById('my-player-card');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('cox-flash');
                setTimeout(() => el.classList.remove('cox-flash'), 1600);
            }
        }, 140);
    }, [currentUser, inProgressPlayerIds, isMobile]);


     if (isLoading) {
        // [스켈레톤 로딩] 실제 화면 구조가 은은하게 반짝이며 자리 잡는 로딩 화면
        return <SkeletonScreen />;
    }

    // 인앱 브라우저 접속 시 강제 안내 화면 (외부 브라우저 유도)
    if (isInAppBrowser) {
        return (
            <div className="cox-dark text-white min-h-screen flex flex-col items-center justify-center font-sans p-6 text-center" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                <div className="bg-gray-800 p-8 rounded-2xl shadow-[0_0_20px_rgba(205,251,71,0.15)] w-full max-w-sm border border-yellow-500/30">
                    <div className="text-5xl mb-4">🚀</div>
                    <h2 className="text-xl font-bold text-yellow-400 mb-2">앗! 전용 브라우저가 필요해요</h2>
                    <p className="text-gray-300 text-sm mb-6 leading-relaxed">
                        카카오톡 등 현재 화면에서는<br/>콕스라이팅의 실시간 매칭이 끊길 수 있어요.<br/><br/>
                        <span className="text-white font-bold bg-red-500/20 px-2 py-1 rounded">오류 없는 쾌적한 경기 진행</span>을 위해<br/>
                        아래 버튼을 눌러 외부 브라우저로 접속해주세요!
                    </p>
                    <button 
                        onClick={() => {
                            const targetUrl = window.location.href;
                            // 안드로이드 카카오톡 외부 브라우저 열기 인텐트
                            if (navigator.userAgent.toLowerCase().includes('android') && navigator.userAgent.toLowerCase().includes('kakao')) {
                                window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(targetUrl)}`;
                            } else {
                                // 아이폰 또는 기타 브라우저는 클립보드 복사 유도
                                navigator.clipboard.writeText(targetUrl).then(() => {
                                    alert("링크가 복사되었습니다! 사파리(Safari)나 크롬(Chrome) 주소창에 붙여넣어주세요.");
                                });
                            }
                        }}
                        className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 rounded-lg text-sm"
                    >
                        {navigator.userAgent.toLowerCase().includes('android') ? '외부 브라우저로 열기' : '링크 복사해서 열기'}
                    </button>
                    {/* 아이폰 사용자를 위한 추가 안내 */}
                    {!navigator.userAgent.toLowerCase().includes('android') && (
                        <p className="text-gray-500 text-[10px] mt-4">
                            우측 하단 [⋯] 버튼을 누르고<br/>'다른 브라우저로 열기'를 선택하셔도 됩니다.
                        </p>
                    )}
                </div>
            </div>
        );
    }

   if (!currentUser) {
        return <EntryPage onEnter={handleEnter} roster={roster} />;
    }

    // [소모임 동기화] 오늘 자동 동기화가 실패했는지 (실패 배너 표시 조건)
    const todayKstKey = getKstParts().dateKey;
    const showSyncErrorBanner = somoimSync?.auto?.status === 'error'
        && somoimSync?.lastError?.dateKey === todayKstKey;

    return (
        <div className="cox-dark text-white min-h-screen font-sans flex flex-col" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
            
            {/* --- [소모임 동기화] 자동 동기화 실패 배너 --- */}
            {showSyncErrorBanner && (
                <div className="bg-orange-600 text-white p-3 flex items-center justify-between shadow-lg sticky top-0 z-[54]">
                    <div className="flex-1 pr-2">
                        <p className="font-bold text-[11px] leading-tight">
                            ⚠️ 소모임 동기화에 실패하였습니다 (오류코드: {somoimSync?.lastError?.code || 'UNKNOWN'}) 관리자에게 문의해주세요.
                        </p>
                    </div>
                    {isAdmin && (
                        <button
                            onClick={handleSomoimSync}
                            className="bg-white text-orange-600 px-2 py-1.5 rounded text-xs font-bold shadow-sm active:scale-95 flex-shrink-0"
                        >
                            다시 시도
                        </button>
                    )}
                </div>
            )}

           {modal?.type === 'season' && <SeasonModal {...modal.data} onClose={() => {
                setIsSeasonModalDismissed(true); // 현재 세션에서 공지를 닫았음을 기록
                setModal({ type: null, data: null });
            }} />}
            {modal?.type === 'adminEditPlayer' && <AdminEditPlayerModal player={modal.data.player} allPlayers={allPlayers} onClose={() => setModal({ type: null, data: null })} setModal={setModal} />}
            {modal?.type === 'confirm' && <ConfirmationModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'courtSelection' && <CourtSelectionModal {...modal.data} onCancel={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'alert' && <AlertModal {...modal.data} onClose={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'somoimSyncResult' && <SomoimSyncResultModal result={modal.data} onClose={() => setModal({ type: null, data: null })} />}
            {modal?.type === 'myHistory' && <MyHistoryModal player={currentUser} allPlayers={allPlayers} onClose={() => setModal({ type: null, data: null })} />}
            {isRosterOpen && <RosterManageModal roster={roster} onClose={() => setIsRosterOpen(false)} setModal={setModal} />}

          {isSettingsOpen && <SettingsModal
            isAdmin={isAdmin}
            scheduledCount={gameState.numScheduledMatches}
            courtCount={gameState.numInProgressCourts}
            seasonConfig={seasonConfig}
            activePlayers={activePlayers} /* [수정] '대기'가 아닌 '전체 활성' 선수 전달 */
            allPlayers={allPlayers}       /* [하루 요약 카드] 나간 사람 포함 오늘 참석자 집계용 */
            currentUser={currentUser}     /* [관리자 권한] 자기 자신 해임 확인용 */
            roster={roster}               /* [관리자 권한] 이름 자동완성/명단 확인용 */
            onSave={handleSettingsUpdate} // [수정] App 컴포넌트에서 정의된 함수 전달
            onCancel={() => setIsSettingsOpen(false)}
            setModal={setModal}
            onSystemReset={handleSystemReset}
            onClearPlayerHistory={handleClearPlayerHistory}
            onGenerateRobots={handleGenerateRobots}
            onAdminAddPlayer={handleAdminAddPlayer}
            onSomoimSync={handleSomoimSync}
            onOpenRoster={() => setIsRosterOpen(true)}
            somoimSync={somoimSync}
        />}

            <header className="cox-appbar">
                <div className="cox-appbar-brand">
                    <div className="cox-hello">
                        <span className="cox-livedot"></span>
                        <span>{isAdmin ? '👑 관리자' : `${currentUser.name} 님`} · 콕스라이팅</span>
                    </div>
                    <h1 className="cox-title">
                        {activeTab === 'inProgress'
                            ? (<>경기 <em>진행</em></>)
                            : (<>오늘의 <em>경기</em></>)}
                    </h1>
                </div>

                <div className="relative flex-shrink-0">
                    <button
                        className={`cox-avatar-btn ${isAdmin ? 'admin' : ''}`}
                        onClick={() => setIsProfileMenuOpen(o => !o)}
                        aria-label="프로필 메뉴"
                        data-tut="avatar"
                    >
                        {currentUser.name.slice(-2)}
                    </button>

                    {isProfileMenuOpen && (
                        <>
                            <div className="cox-menu-backdrop" onClick={() => setIsProfileMenuOpen(false)} />
                            <div className="cox-menu" data-tut="menu">
                                <div className="cox-menu-head">
                                    <div className={`cox-avatar-btn ${isAdmin ? 'admin' : ''}`} style={{ width: 38, height: 38, borderRadius: 12, pointerEvents: 'none' }}>
                                        {currentUser.name.slice(-2)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="nm truncate">{currentUser.name}</div>
                                        <div className="rl">{isAdmin ? '관리자 계정' : `${currentUser.level} · ${currentUser.isGuest ? '게스트' : '회원'}`}</div>
                                    </div>
                                </div>

                                <button
                                    className={`cox-menu-item ${currentUser.isResting ? 'accent' : ''}`}
                                    onClick={() => { setIsProfileMenuOpen(false); handleToggleRest(); }}
                                >
                                    <i className={`fas fa-${currentUser.isResting ? 'play' : 'mug-hot'}`}></i>
                                    {currentUser.isResting ? '경기 복귀하기' : '잠시 휴식하기'}
                                </button>

                                {isAdmin && (
                                    <button
                                        className="cox-menu-item"
                                        onClick={() => { setIsProfileMenuOpen(false); setIsSettingsOpen(true); }}
                                        data-tut="menu-settings"
                                    >
                                        <i className="fas fa-sliders"></i>
                                        관리자 설정
                                    </button>
                                )}

                                {/* [튜트리얼] 언제든 다시 볼 수 있게 프로필 메뉴에 넣어 둔다 */}
                                <button
                                    className="cox-menu-item"
                                    onClick={() => { setIsProfileMenuOpen(false); handleReplayTutorial(); }}
                                    data-tut="menu-tutorial"
                                >
                                    <i className="fas fa-graduation-cap"></i>
                                    튜트리얼 다시 보기
                                </button>

                                <button
                                    className="cox-menu-item danger"
                                    onClick={() => { setIsProfileMenuOpen(false); handleLogout(); }}
                                >
                                    <i className="fas fa-right-from-bracket"></i>
                                    나가기
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </header>

            {(pullDistance > 0 || isRefreshing) && (
                <div
                    className="ptr-indicator"
                    style={{
                        transform: `translateX(-50%) translateY(${Math.min(pullDistance, 64)}px)`,
                        opacity: isRefreshing ? 1 : Math.min(1, pullDistance / 45),
                    }}
                >
                    <div className={`ptr-circle ${isRefreshing ? 'refreshing' : ''}`}>
                        <svg viewBox="0 0 24 24" style={!isRefreshing ? { transform: `rotate(${pullDistance * 3}deg)` } : undefined}>
                            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                            <path d="M21 3v6h-6" />
                        </svg>
                    </div>
                </div>
            )}

            <main ref={mainScrollRef} className="flex-grow flex flex-col gap-3 p-1.5 overflow-y-auto" style={{ paddingBottom: isMobile ? 'calc(104px + env(safe-area-inset-bottom, 0px))' : '16px' }}>
                {isMobile ? (
                    <div className="flex flex-col gap-3">
                            {activeTab === 'matching' && (
                                <div key="tab-matching" className="flex flex-col gap-3 tab-fade-in">
                                    <WaitingListSection maleWaitingPlayers={maleWaitingPlayers} femaleWaitingPlayers={femaleWaitingPlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleDeleteFromWaiting={handleDeleteFromWaiting} setModal={setModal} currentUser={currentUser} inProgressPlayerIds={inProgressPlayerIds} onClearAllWaitingPlayers={handleClearAllWaitingPlayers} />
                                    <AutoMatchesSection autoMatches={autoMatches} players={activePlayers} isAdmin={isAdmin} handleStartAutoMatch={handleStartAutoMatch} handleReturnToWaiting={handleReturnToWaiting} handleClearAutoMatches={handleClearAutoMatches} handleDeleteAutoMatch={handleDeleteAutoMatch} currentUser={currentUser} handleAutoMatchCardClick={handleAutoMatchCardClick} selectedAutoMatchSlot={selectedAutoMatchSlot} inProgressPlayerIds={inProgressPlayerIds} handleAutoMatchSlotClick={handleAutoMatchSlotClick} handleGenerateMatch={handleGenerateMatch} generatingGender={generatingGender}/>
                                    <ScheduledMatchesSection numScheduledMatches={gameState.numScheduledMatches} scheduledMatches={gameState.scheduledMatches} players={activePlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleReturnToWaiting={handleReturnToWaiting} setModal={setModal} handleSlotClick={handleSlotClick} handleStartMatch={handleStartMatch} currentUser={currentUser} handleClearScheduledMatches={handleClearScheduledMatches} handleDeleteScheduledMatch={handleDeleteScheduledMatch} inProgressPlayerIds={inProgressPlayerIds} />
                                </div>
                            )}
                            {activeTab === 'inProgress' && (
                                <div key="tab-inprogress" className="tab-fade-in">
                                <InProgressCourtsSection numInProgressCourts={gameState.numInProgressCourts} inProgressCourts={gameState.inProgressCourts} players={activePlayers} allPlayers={allPlayers} isAdmin={isAdmin} handleEndMatch={handleEndMatch} currentUser={currentUser} courtMove={courtMove} setCourtMove={setCourtMove} handleMoveOrSwapCourt={handleMoveOrSwapCourt} />
                                </div>
                            )}
                    </div>
            ) : (
                <div className="flex flex-col gap-3">
                    <WaitingListSection maleWaitingPlayers={maleWaitingPlayers} femaleWaitingPlayers={femaleWaitingPlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleDeleteFromWaiting={handleDeleteFromWaiting} setModal={setModal} currentUser={currentUser} inProgressPlayerIds={inProgressPlayerIds} onClearAllWaitingPlayers={handleClearAllWaitingPlayers} />
                    <AutoMatchesSection autoMatches={autoMatches} players={activePlayers} isAdmin={isAdmin} handleStartAutoMatch={handleStartAutoMatch} handleReturnToWaiting={handleReturnToWaiting} handleClearAutoMatches={handleClearAutoMatches} handleDeleteAutoMatch={handleDeleteAutoMatch} currentUser={currentUser} handleAutoMatchCardClick={handleAutoMatchCardClick} selectedAutoMatchSlot={selectedAutoMatchSlot} inProgressPlayerIds={inProgressPlayerIds} handleAutoMatchSlotClick={handleAutoMatchSlotClick} handleGenerateMatch={handleGenerateMatch} generatingGender={generatingGender}/>
                    <ScheduledMatchesSection numScheduledMatches={gameState.numScheduledMatches} scheduledMatches={gameState.scheduledMatches} players={activePlayers} selectedPlayerIds={selectedPlayerIds} isAdmin={isAdmin} handleCardClick={handleCardClick} handleReturnToWaiting={handleReturnToWaiting} setModal={setModal} handleSlotClick={handleSlotClick} handleStartMatch={handleStartMatch} currentUser={currentUser} handleClearScheduledMatches={handleClearScheduledMatches} handleDeleteScheduledMatch={handleDeleteScheduledMatch} inProgressPlayerIds={inProgressPlayerIds} />
                    <InProgressCourtsSection numInProgressCourts={gameState.numInProgressCourts} inProgressCourts={gameState.inProgressCourts} players={activePlayers} allPlayers={allPlayers} isAdmin={isAdmin} handleEndMatch={handleEndMatch} currentUser={currentUser} courtMove={courtMove} setCourtMove={setCourtMove} handleMoveOrSwapCourt={handleMoveOrSwapCourt} />
                </div>
            )}
            </main>

            {/* --- COX 하단 글래스 네비게이션 (모바일) + 가운데 라임 FAB --- */}
            {isMobile && (
                <nav className="cox-bottomnav" data-tut="nav">
                    <button
                        className={`cox-nav-btn ${activeTab === 'matching' ? 'active' : ''}`}
                        onClick={() => setActiveTab('matching')}
                    >
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="17" rx="2.5" />
                            <path d="M3 9h18M8 2.5v3M16 2.5v3" />
                        </svg>
                        <span>경기 예정</span>
                    </button>

                    <button className="cox-fab" onClick={handleLocateMe} title="내 위치 찾기" aria-label="내 위치 찾기" data-tut="fab">
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3.2" />
                            <circle cx="12" cy="12" r="8" />
                            <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
                        </svg>
                    </button>

                    <button
                        className={`cox-nav-btn ${activeTab === 'inProgress' ? 'active' : ''}`}
                        onClick={() => setActiveTab('inProgress')}
                    >
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12h3l2.5-7 5 16 2.5-9H21" />
                        </svg>
                        <span>경기 진행</span>
                    </button>
                </nav>
            )}

            {/* --- [튜트리얼] 인사 화면 → 스포트라이트 안내 (가장 위에 뜬다) --- */}
            {tutorial?.phase === 'intro' && (
                <TutorialIntroModal
                    mode={tutorial.mode}
                    userName={currentUser.name}
                    onStart={() => setTutorial(t => (t ? { ...t, phase: 'run', step: 0 } : t))}
                    onSkip={() => finishTutorial(tutorial.mode)}
                />
            )}
            {tutorial?.phase === 'run' && tutorialSteps.length > 0 && (
                <TutorialOverlay
                    mode={tutorial.mode}
                    steps={tutorialSteps}
                    stepIndex={Math.min(tutorial.step, tutorialSteps.length - 1)}
                    prepare={prepareTutorialStep}
                    activeTab={activeTab}
                    onPrev={handleTutorialPrev}
                    onNext={handleTutorialNext}
                    onSkip={() => finishTutorial(tutorial.mode)}
                />
            )}
        </div>
    );
}
