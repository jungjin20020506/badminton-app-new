import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    firebaseService, readyPromise, runDailyResetIfDue, runAutoSomoimSyncIfDue,
    startPresenceHeartbeat, isPresenceFresh,
} from '../lib/firebase';
import { GHOST_ADMIN_NAME, STORAGE_KEYS, TIMING } from '../lib/constants';

// ===================================================================================
// [앱 데이터] Firestore 구독 → React 상태, 세션 복원, 자동 운영 타이머, 접속 하트비트
// -----------------------------------------------------------------------------------
//  · firebaseService(lib/firebase.js)가 리스너를 들고 있고, 이 훅은 그 캐시를 React 상태로 옮긴다
//  · 세션 복원: 유령 관리자 키 → 저장된 선수 id (문서가 있고 active 일 때만)
//  · 내 문서가 사라지거나 status 가 active 가 아니게 되면 즉시 로그아웃 (관리자가 내보낸 경우)
//  · 접속 표시는 "접속 중 집합"이 실제로 바뀔 때만 상태를 갱신한다 (하트비트마다 리렌더 방지)
// ===================================================================================
export const makeGhostAdminUser = () => ({ id: 'ghost-admin', name: GHOST_ADMIN_NAME, isGhostAdmin: true });

export function useAppData() {
    const [allPlayers, setAllPlayers] = useState({});
    const [gameState, setGameState] = useState(null);
    const [seasonConfig, setSeasonConfig] = useState(null);
    const [roster, setRoster] = useState({});
    const [somoimSync, setSomoimSync] = useState(null);
    const [onlineIds, setOnlineIds] = useState(() => new Set());
    const [currentUser, setCurrentUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const onlineSigRef = useRef('');

    const syncOnlineIds = useCallback(() => {
        const p = firebaseService.getPresence() || {};
        const ids = Object.entries(p).filter(([, at]) => isPresenceFresh(at)).map(([id]) => id).sort();
        const sig = ids.join('|');
        if (sig !== onlineSigRef.current) {
            onlineSigRef.current = sig;
            setOnlineIds(new Set(ids));
        }
    }, []);

    useEffect(() => {
        const initializeApp = async () => {
            await readyPromise;

            const playersFromDB = firebaseService.getAllPlayers();
            setAllPlayers(playersFromDB);

            // [유령 관리자] 유령 모드로 입장해 있었다면 선수 문서 없이 그대로 복원한다
            if (localStorage.getItem(STORAGE_KEYS.ghostAdmin) === '1') {
                setCurrentUser(makeGhostAdminUser());
            } else {
                const savedUserId = localStorage.getItem(STORAGE_KEYS.currentUserId);
                if (savedUserId && playersFromDB[savedUserId] && playersFromDB[savedUserId].status === 'active') {
                    setCurrentUser(playersFromDB[savedUserId]);
                } else if (savedUserId) {
                    localStorage.removeItem(STORAGE_KEYS.currentUserId);
                }
            }

            setGameState(firebaseService.getGameState());
            setSeasonConfig(firebaseService.getSeasonConfig());
            setRoster(firebaseService.getRoster());
            setSomoimSync(firebaseService.getSomoimSync());
            syncOnlineIds();
            setIsLoading(false);

            return firebaseService.subscribe(() => {
                const updatedPlayers = firebaseService.getAllPlayers();
                setAllPlayers(updatedPlayers);
                setGameState(firebaseService.getGameState());
                setSeasonConfig(firebaseService.getSeasonConfig());
                setRoster(firebaseService.getRoster());
                setSomoimSync(firebaseService.getSomoimSync());
                syncOnlineIds();

                setCurrentUser((prevUser) => {
                    if (!prevUser) return null;
                    if (prevUser.isGhostAdmin) return prevUser; // 선수 문서가 없으므로 자동 로그아웃 검사 제외
                    const updatedUser = updatedPlayers[prevUser.id];
                    if (!updatedUser || updatedUser.status !== 'active') {
                        localStorage.removeItem(STORAGE_KEYS.currentUserId);
                        return null;
                    }
                    return JSON.stringify(prevUser) !== JSON.stringify(updatedUser) ? updatedUser : prevUser;
                });
            });
        };

        const unsubscribePromise = initializeApp();
        return () => { unsubscribePromise.then((unsubscribe) => unsubscribe && unsubscribe()); };
    }, [syncOnlineIds]);

    // [새벽 2시 자동 초기화] 운영일이 바뀌면 한 기기만 초기화를 수행 (서버 크론이 먼저 돌면 건너뛴다)
    useEffect(() => {
        if (isLoading) return undefined;
        runDailyResetIfDue();
        const id = setInterval(runDailyResetIfDue, TIMING.dailyCheckMs);
        return () => clearInterval(id);
    }, [isLoading]);

    // [소모임 동기화] 정모 당일 18시(KST)가 지나면 참석 인원에 맞춰 선수카드를 자동 생성
    useEffect(() => {
        if (isLoading) return undefined;
        runAutoSomoimSyncIfDue();
        const id = setInterval(runAutoSomoimSyncIfDue, TIMING.dailyCheckMs);
        return () => clearInterval(id);
    }, [isLoading]);

    // [접속 표시] 입장해 있는 동안 하트비트, 나가면 정리 (유령 관리자는 제외)
    useEffect(() => {
        if (!currentUser?.id || currentUser.isGhostAdmin) return undefined;
        return startPresenceHeartbeat(currentUser.id);
    }, [currentUser?.id, currentUser?.isGhostAdmin]);

    const activePlayers = useMemo(
        () => Object.values(allPlayers).filter((p) => p.status === 'active').reduce((acc, p) => { acc[p.id] = p; return acc; }, {}),
        [allPlayers]
    );
    const onlineCount = useMemo(() => Object.keys(activePlayers).filter((id) => onlineIds.has(id)).length, [activePlayers, onlineIds]);

    return {
        allPlayers, activePlayers, gameState, seasonConfig, roster, somoimSync,
        onlineIds, onlineCount, currentUser, setCurrentUser, isLoading,
    };
}
