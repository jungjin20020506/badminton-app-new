import React, { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
    db, storage, playersRef, configRef, somoimSyncRef,
    firebaseService, syncSomoimAttendees, getKstParts, runTx, writeAuditLog,
} from './lib/firebase';
import { verifyHiddenKey } from './lib/secret';
import { isSoundEnabled, setSoundEnabled } from './lib/sound';
import { log } from './lib/logger';
import { toastSuccess } from './lib/toast';
import { resizeImageFile } from './lib/image';
import { GHOST_ADMIN_NAME, STORAGE_KEYS } from './lib/constants';
import { getThemePreference, cycleTheme, subscribeTheme, THEME_LABEL } from './lib/theme';
import { startRest, resumeFromRest, restRemainingMin } from './lib/rest';
import {
    getAdminNames, generateId, filterTodayGames, calculateLocations, PLAYERS_PER_MATCH,
    isTeamMode, MATCH_MODE_NORMAL, MATCH_MODE_TEAM, TEAM_BLUE, TEAM_WHITE, TEAM_META,
    getTeamOf, emptyTeamScores,
} from './lib/helpers';
import { computeRankings, computeAceIds, rankOf } from './lib/ranking';

import { CoxMark } from './components/Logo';
import { Icon } from './components/Icons';
import { WaitingListSection, ScheduledMatchesSection, AutoMatchesSection, InProgressCourtsSection } from './components/Sections';
import { EntryPage } from './components/EntryPage';
import { SkeletonScreen } from './components/Skeleton';
import { InAppBrowserGuide } from './components/InAppBrowserGuide';
import { TeamScoreBoard } from './components/TeamScoreBoard';
import { TeamRankingSection } from './components/TeamRanking';
import {
    SeasonModal, AdminEditPlayerModal, ConfirmationModal, AlertModal, CourtSelectionModal,
    SomoimSyncResultModal, MyHistoryModal, HiddenKeyModal, TeamMatchEndModal, TeamScoreEditModal,
    TeamLogModal, RestTimerModal,
} from './components/modals';

import { useAppData, makeGhostAdminUser } from './hooks/useAppData';
import { useGameState } from './hooks/useGameState';
import { useCourtActions } from './hooks/useCourtActions';
import { useMatchActions } from './hooks/useMatchActions';
import { useIsMobile } from './hooks/useIsMobile';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import { useSwipeTabs } from './hooks/useSwipeTabs';
import { useFlipAnimation } from './hooks/useFlipAnimation';
import { useInAppBrowser } from './hooks/useInAppBrowser';
import { useLiveResultBanner } from './hooks/useLiveResultBanner';
import { useHiddenKeyGesture } from './hooks/useHiddenKeyGesture';
import { useOnboarding } from './hooks/useOnboarding';
import { useRestTimer } from './hooks/useRestTimer';

// [성능] 무거운 화면은 처음 열 때 내려받는다 — 설정·명단·튜트리얼·안내·매칭 후보 시트
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const RosterManageModal = lazy(() => import('./components/RosterManageModal').then((m) => ({ default: m.RosterManageModal })));
const MatchOptionsModal = lazy(() => import('./components/modals/MatchOptionsModal').then((m) => ({ default: m.MatchOptionsModal })));
const TutorialIntroModal = lazy(() => import('./tutorial/Tutorial').then((m) => ({ default: m.TutorialIntroModal })));
const TutorialOverlay = lazy(() => import('./tutorial/Tutorial').then((m) => ({ default: m.TutorialOverlay })));
const AutoMatchGuide = lazy(() => import('./tutorial/AutoMatchGuide').then((m) => ({ default: m.AutoMatchGuide })));

const CLOSED_MODAL = { type: null, data: null };

// ===================================================================================
// App — 화면 조립 + 입장/퇴장·선수 배치·관리자 설정 핸들러
// -----------------------------------------------------------------------------------
// 데이터 구독은 useAppData, gameState 갱신·파생값은 useGameState, 코트 운영은 useCourtActions,
// 자동 매칭은 useMatchActions, 온보딩은 useOnboarding, 화면 제스처는 각 훅(src/hooks)에 있다.
// 이 파일은 "무엇을 어디에 그리는가"와 선수 카드 선택·배치 로직만 들고 있다.
// ===================================================================================
export default function App() {
    // ── 데이터 ───────────────────────────────────────────────────────────────
    const {
        allPlayers, activePlayers, gameState, seasonConfig, roster, somoimSync,
        onlineIds, onlineCount, currentUser, setCurrentUser, isLoading,
    } = useAppData();

    // ── 화면 상태 ─────────────────────────────────────────────────────────────
    const [soundOn, setSoundOn] = useState(isSoundEnabled);
    const [themePref, setThemePref] = useState(getThemePreference);
    useEffect(() => subscribeTheme((_resolved, pref) => setThemePref(pref)), []);
    const [isRosterOpen, setIsRosterOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    // 프로필 메뉴: Esc 로 닫기
    useEffect(() => {
        if (!isProfileMenuOpen) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setIsProfileMenuOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isProfileMenuOpen]);
    const [modal, setModal] = useState(CLOSED_MODAL);
    const closeModal = useCallback(() => setModal(CLOSED_MODAL), []);
    const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);
    const [courtMove, setCourtMove] = useState({ sourceIndex: null });
    const [isSeasonModalDismissed, setIsSeasonModalDismissed] = useState(false);
    const [activeTab, setActiveTab] = useState('matching');
    const isMobile = useIsMobile();
    const [isInAppBrowser, dismissInAppGuide] = useInAppBrowser();
    const mainScrollRef = useRef(null);

    // ── 파생 값 ───────────────────────────────────────────────────────────────
    const adminNames = useMemo(() => getAdminNames(seasonConfig), [seasonConfig]);
    const isAdmin = !!currentUser && (currentUser.isGhostAdmin || adminNames.includes(currentUser.name));
    const autoMatches = gameState?.autoMatches || {};
    const teamMode = isTeamMode(seasonConfig);
    const teamScores = useMemo(() => ({ ...emptyTeamScores(), ...(gameState?.teamScores || {}) }), [gameState?.teamScores]);

    const {
        updateGameState, findPlayerLocation,
        waitingPlayers, maleWaitingPlayers, femaleWaitingPlayers, inProgressPlayerIds, courtIndexByPlayer,
    } = useGameState({ gameState, activePlayers });

    const rankings = useMemo(() => (teamMode ? computeRankings(activePlayers) : null), [teamMode, activePlayers]);
    const aceIds = useMemo(() => (rankings ? computeAceIds(rankings) : null), [rankings]);
    const myRankInfo = useMemo(
        () => (rankings && currentUser && !currentUser.isGhostAdmin ? rankOf(rankings, currentUser.id) : null),
        [rankings, currentUser]
    );
    const teamCounts = useMemo(() => {
        const c = { blue: 0, white: 0 };
        if (!teamMode) return c;
        Object.values(activePlayers).forEach((p) => { const t = getTeamOf(p); if (t === TEAM_BLUE) c.blue += 1; else if (t === TEAM_WHITE) c.white += 1; });
        return c;
    }, [teamMode, activePlayers]);

    // ── 화면 훅 ───────────────────────────────────────────────────────────────
    const { pullDistance, isRefreshing } = usePullToRefresh(mainScrollRef, [isLoading, currentUser, isInAppBrowser]);
    useSwipeTabs(mainScrollRef, isMobile && !isLoading && !!currentUser, setActiveTab);
    useFlipAnimation(mainScrollRef, activeTab, [gameState, activePlayers]);
    const { liveBanner, edgeFlash, clearLiveBanner } = useLiveResultBanner(gameState?.lastTeamResult, teamMode, allPlayers);
    useRestTimer({ currentUser, activePlayers, isAdmin });

    // 공지 사진 미리 불러오기 + 시즌 공지 모달
    useEffect(() => {
        if (!isLoading && seasonConfig?.announcementType === 'photo' && seasonConfig?.announcementPhotoUrl) {
            const img = new Image();
            img.src = seasonConfig.announcementPhotoUrl;
        }
        if (isLoading || !seasonConfig || modal?.type || isSeasonModalDismissed) return;
        if (seasonConfig.announcementType === 'none') return;
        const lastSeen = localStorage.getItem(`${STORAGE_KEYS.seenSeasonPrefix}${seasonConfig.seasonId}`);
        if (lastSeen !== new Date().toDateString()) setModal({ type: 'season', data: seasonConfig });
    }, [isLoading, seasonConfig, isSeasonModalDismissed, modal]);

    const onboarding = useOnboarding({
        isLoading, currentUser, isAdmin, isInAppBrowser, isMobile, teamMode, seasonConfig,
        modal, setModal, isSettingsOpen, setIsSettingsOpen, isRosterOpen, setIsRosterOpen,
        setIsProfileMenuOpen, setActiveTab, isSeasonModalDismissed,
    });

    // ── 코트 운영 · 자동 매칭 ─────────────────────────────────────────────────
    const court = useCourtActions({ gameState, allPlayers, inProgressPlayerIds, teamMode, currentUser, updateGameState, setModal, setCourtMove });
    const matching = useMatchActions({ isAdmin, allPlayers, gameState, seasonConfig, inProgressPlayerIds, teamMode, updateGameState, setModal });

    // ── 선수 이동 · 선택 ──────────────────────────────────────────────────────
    const handleReturnToWaiting = useCallback(async (player) => {
        const loc = findPlayerLocation(player.id);
        if (!loc || loc.location === 'waiting') return;
        await updateGameState((currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            if (loc.location === 'schedule') newState.scheduledMatches[String(loc.matchIndex)][loc.slotIndex] = null;
            if (loc.location === 'auto') newState.autoMatches[String(loc.matchIndex)][loc.slotIndex] = null;
            return { newState };
        }, '선수를 대기 명단으로 옮기는 데 실패했습니다.').catch(() => {});
    }, [findPlayerLocation, updateGameState]);

    const handleDeleteFromWaiting = useCallback((player) => {
        setModal({ type: 'confirm', data: {
            title: '선수 내보내기', body: `${player.name} 선수를 내보낼까요? (기록은 유지됩니다)`, confirmLabel: '내보내기',
            onConfirm: async () => {
                await updateDoc(doc(playersRef, player.id), { status: 'inactive' }).catch(() => {
                    setModal({ type: 'alert', data: { title: '오류', body: '선수 내보내기에 실패했습니다.' } });
                });
                setModal(CLOSED_MODAL);
            },
        } });
    }, []);

    const handleCardClick = useCallback(async (playerId) => {
        if (!isAdmin) {
            if (currentUser && playerId === currentUser.id) setModal({ type: 'myHistory', data: null });
            return;
        }
        if (courtMove.sourceIndex !== null) { setCourtMove({ sourceIndex: null }); return; }

        const loc = findPlayerLocation(playerId);
        const firstSelectedId = selectedPlayerIds.length > 0 ? selectedPlayerIds[0] : null;
        const firstSelectedLoc = firstSelectedId ? findPlayerLocation(firstSelectedId) : null;

        if (loc.location === 'waiting') {
            if (!firstSelectedLoc || firstSelectedLoc.location === 'waiting') {
                setSelectedPlayerIds((ids) => (ids.includes(playerId) ? ids.filter((id) => id !== playerId) : [...ids, playerId]));
            } else setSelectedPlayerIds([playerId]);
            return;
        }
        if (!firstSelectedId) { setSelectedPlayerIds([playerId]); return; }
        if (selectedPlayerIds.length === 1 && firstSelectedLoc.location !== 'waiting') {
            // [청백전] 경기 예정 칸은 왼쪽 2칸 청 · 오른쪽 2칸 백 — 다른 팀 칸으로 가는 교환은 막는다
            if (teamMode && firstSelectedLoc.location === 'schedule' && loc.location === 'schedule') {
                const slotTeam = (i) => (i < 2 ? TEAM_BLUE : TEAM_WHITE);
                const a = allPlayers[firstSelectedId], b = allPlayers[playerId];
                if (getTeamOf(a) !== slotTeam(loc.slotIndex) || getTeamOf(b) !== slotTeam(firstSelectedLoc.slotIndex)) {
                    setSelectedPlayerIds([]);
                    setModal({ type: 'alert', data: { title: '자리를 바꿀 수 없어요', body: '경기 예정은 왼쪽 2칸이 청팀, 오른쪽 2칸이 백팀 자리예요.\n같은 팀 칸끼리만 바꿀 수 있습니다.' } });
                    return;
                }
            }
            // 수동/자동 매칭 간 교환
            await updateGameState((currentState) => {
                const newState = JSON.parse(JSON.stringify(currentState));
                const getValue = (l) => (l.location === 'schedule' ? newState.scheduledMatches[String(l.matchIndex)][l.slotIndex]
                    : l.location === 'auto' ? newState.autoMatches[String(l.matchIndex)][l.slotIndex] : null);
                const setValue = (l, value) => {
                    if (l.location === 'schedule') newState.scheduledMatches[String(l.matchIndex)][l.slotIndex] = value;
                    if (l.location === 'auto') newState.autoMatches[String(l.matchIndex)][l.slotIndex] = value;
                };
                const ok = (l) => l.location === 'schedule' || l.location === 'auto';
                if (!ok(firstSelectedLoc) || !ok(loc)) return { newState };
                const valA = getValue(firstSelectedLoc);
                const valB = getValue(loc);
                setValue(firstSelectedLoc, valB);
                setValue(loc, valA);
                return { newState };
            }, '선수 위치를 바꾸는 데 실패했습니다.').catch(() => {});
            setSelectedPlayerIds([]);
        } else setSelectedPlayerIds([playerId]);
    }, [isAdmin, currentUser, selectedPlayerIds, findPlayerLocation, updateGameState, courtMove, teamMode, allPlayers]);

    const handleSlotClick = useCallback(async (context) => {
        if (!isAdmin || selectedPlayerIds.length === 0) return;
        const schedSlotTeam = (i) => (i < 2 ? TEAM_BLUE : TEAM_WHITE);
        if (teamMode && context.location === 'schedule') {
            const selected = selectedPlayerIds.map((id) => allPlayers[id]).filter(Boolean);
            const wrong = selected.filter((p) => getTeamOf(p) !== schedSlotTeam(context.slotIndex));
            if (wrong.length > 0 && wrong.length === selected.length) {
                const slotLabel = TEAM_META[schedSlotTeam(context.slotIndex)].label;
                const names = wrong.map((p) => `${p.name}(${getTeamOf(p) ? TEAM_META[getTeamOf(p)].short : '팀 미정'})`).join(', ');
                setSelectedPlayerIds([]);
                setModal({ type: 'alert', data: { title: `${slotLabel} 칸이에요`, body: `${names} 선수는 ${slotLabel} 칸에 넣을 수 없어요.\n왼쪽 2칸은 청팀, 오른쪽 2칸은 백팀 자리입니다.` } });
                return;
            }
        }

        await updateGameState((currentState) => {
            const newState = JSON.parse(JSON.stringify(currentState));
            const currentLocations = calculateLocations(newState, activePlayers);
            const areAllFromWaiting = selectedPlayerIds.every((id) => currentLocations[id]?.location === 'waiting');
            const listOf = (l) => (l === 'schedule' ? newState.scheduledMatches : newState.autoMatches);

            if (areAllFromWaiting) {
                if (context.location !== 'schedule' && context.location !== 'auto') return { newState };
                const playersToMove = [...selectedPlayerIds];
                const targetArray = listOf(context.location)[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                if (teamMode && context.location === 'schedule') {
                    // [청백전] 각 선수를 자기 팀 반쪽의 빈 칸에만 넣는다 (누른 칸부터 우선)
                    for (const pid of playersToMove) {
                        const team = getTeamOf(allPlayers[pid]);
                        const half = team === TEAM_BLUE ? [0, 1] : team === TEAM_WHITE ? [2, 3] : [];
                        const order = half.includes(context.slotIndex) ? [context.slotIndex, ...half.filter((i) => i !== context.slotIndex)] : half;
                        const free = order.find((i) => targetArray[i] === null);
                        if (free === undefined) throw new Error(`${TEAM_META[team]?.label || '팀 미정'} 자리가 부족합니다.`);
                        targetArray[free] = pid;
                    }
                } else {
                    const availableSlots = targetArray.filter((p) => p === null).length;
                    if (playersToMove.length > availableSlots) throw new Error(`자리가 부족합니다. (${availableSlots}자리 남음)`);
                    for (let i = 0; i < PLAYERS_PER_MATCH && playersToMove.length > 0; i += 1) {
                        if (targetArray[i] === null) targetArray[i] = playersToMove.shift();
                    }
                }
                listOf(context.location)[String(context.matchIndex)] = targetArray;
            } else if (selectedPlayerIds.length === 1) {
                const playerId = selectedPlayerIds[0];
                const sourceLocation = currentLocations[playerId];
                const setValue = (l, value) => {
                    if (l.location === 'schedule') newState.scheduledMatches[String(l.matchIndex)][l.slotIndex] = value;
                    if (l.location === 'auto') newState.autoMatches[String(l.matchIndex)][l.slotIndex] = value;
                };
                if (!sourceLocation || (sourceLocation.location !== 'schedule' && sourceLocation.location !== 'auto')) return { newState };
                if (context.location !== 'schedule' && context.location !== 'auto') return { newState };
                setValue(sourceLocation, null);
                const destArray = listOf(context.location)[String(context.matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                if (destArray[context.slotIndex]) setValue(sourceLocation, destArray[context.slotIndex]); // 차 있으면 교환
                destArray[context.slotIndex] = playerId;
                listOf(context.location)[String(context.matchIndex)] = destArray;
            }
            return { newState };
        }, '선수를 경기에 배정하는 데 실패했습니다.').catch(() => {});
        setSelectedPlayerIds([]);
    }, [isAdmin, selectedPlayerIds, activePlayers, updateGameState, teamMode, allPlayers]);

    const handleAutoMatchCardClick = useCallback((matchIndex, slotIndex) => {
        const pid = gameState?.autoMatches?.[matchIndex]?.[slotIndex];
        if (!isAdmin) {
            if (pid && currentUser && pid === currentUser.id) setModal({ type: 'myHistory', data: null });
            return;
        }
        if (pid) handleCardClick(pid);
        else handleSlotClick({ location: 'auto', matchIndex, slotIndex });
    }, [isAdmin, currentUser, gameState, handleCardClick, handleSlotClick]);

    const handleAutoMatchSlotClick = useCallback((matchIndex, slotIndex) => {
        if (!isAdmin) return;
        handleSlotClick({ location: 'auto', matchIndex, slotIndex });
    }, [isAdmin, handleSlotClick]);

    const handleClearScheduledMatches = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '전체 삭제', body: '모든 (수동) 예정 경기를 삭제할까요?', confirmLabel: '삭제',
            onConfirm: async () => {
                await updateGameState((currentState) => ({ newState: { ...currentState, scheduledMatches: {} } })).catch(() => {});
                setModal(CLOSED_MODAL);
            },
        } });
    }, [updateGameState]);

    const handleDeleteScheduledMatch = useCallback((matchIndex) => {
        setModal({ type: 'confirm', data: {
            title: '경기 삭제', body: `${matchIndex + 1}번 (수동) 예정 경기를 삭제할까요?`, confirmLabel: '삭제',
            onConfirm: async () => {
                await updateGameState((currentState) => {
                    const newState = { ...currentState, scheduledMatches: { ...currentState.scheduledMatches } };
                    for (let i = matchIndex; i < newState.numScheduledMatches - 1; i += 1) {
                        newState.scheduledMatches[String(i)] = newState.scheduledMatches[String(i + 1)] || Array(4).fill(null);
                    }
                    newState.scheduledMatches[String(newState.numScheduledMatches - 1)] = Array(4).fill(null);
                    return { newState };
                }).catch(() => {});
                setModal(CLOSED_MODAL);
            },
        } });
    }, [updateGameState]);

    // ── 히든 키 ───────────────────────────────────────────────────────────────
    const handleLogoSecretTap = useHiddenKeyGesture(isAdmin, useCallback(() => setModal({ type: 'hiddenKey', data: {} }), []));
    const handleHiddenKeySubmit = useCallback(async (inputKey) => {
        const ok = await verifyHiddenKey(inputKey);
        if (!ok) {
            writeAuditLog('전체내보내기-키오류', { by: currentUser?.name || null });
            setModal({ type: 'alert', data: { title: '오류', body: '히든 키가 올바르지 않습니다.' } });
            return;
        }
        if (waitingPlayers.length === 0) { setModal({ type: 'alert', data: { title: '오류', body: '내보낼 선수가 없습니다.' } }); return; }
        try {
            const batch = writeBatch(db);
            waitingPlayers.forEach((player) => batch.update(doc(playersRef, player.id), { status: 'inactive' }));
            await batch.commit();
            writeAuditLog('전체내보내기', { by: currentUser?.name || null, count: waitingPlayers.length, names: waitingPlayers.map((p) => p.name) });
            setModal({ type: 'alert', data: { title: '완료', body: '대기 중인 모든 선수를 내보냈습니다.' } });
        } catch (error) {
            setModal({ type: 'alert', data: { title: '오류', body: '선수들을 내보내는 중 오류가 발생했습니다.' } });
            log.error('Failed to clear all waiting players:', error);
        }
    }, [waitingPlayers, currentUser]);

    // ── 입장 · 퇴장 ───────────────────────────────────────────────────────────
    const handleEnter = useCallback(async (formData) => {
        const name = (formData.name || '').trim();
        let { level, gender } = formData;
        let isGuest = !!formData.isGuest;
        if (!name) { setModal({ type: 'alert', data: { title: '오류', body: '이름을 입력해주세요.' } }); return; }

        if (formData.isGhostAdmin || name === GHOST_ADMIN_NAME) {
            localStorage.setItem(STORAGE_KEYS.ghostAdmin, '1');
            localStorage.removeItem(STORAGE_KEYS.currentUserId);
            setCurrentUser(makeGhostAdminUser());
            return;
        }
        const nowTeamMode = isTeamMode(firebaseService.getSeasonConfig());
        if (nowTeamMode !== !!formData.isTeamEntry) {
            setModal({ type: 'alert', data: { title: '경기 방식이 바뀌었어요', body: nowTeamMode ? '청백전 모드로 바뀌었습니다. 팀을 골라 다시 입장해주세요.' : '일반 모드로 돌아왔습니다. 다시 입장해주세요.' } });
            return;
        }
        let team = null;
        if (nowTeamMode) {
            team = formData.team === TEAM_BLUE || formData.team === TEAM_WHITE ? formData.team : null;
            if (!team) { setModal({ type: 'alert', data: { title: '오류', body: '청팀 / 백팀 중 하나를 골라주세요.' } }); return; }
            isGuest = false;
        }
        if (!isGuest && !nowTeamMode) {
            const rosterEntry = Object.values(firebaseService.getRoster() || {}).find((r) => r.name === name);
            if (!rosterEntry || !rosterEntry.level || !rosterEntry.gender) {
                setModal({ type: 'alert', data: { title: '입장 불가', body: '등록된 선수 정보가 없습니다. 관리자에게 문의해주세요.' } });
                return;
            }
            level = rosterEntry.level;
            gender = rosterEntry.gender;
        }
        if (!level || !gender) { setModal({ type: 'alert', data: { title: '오류', body: '급수와 성별을 선택해주세요.' } }); return; }
        const id = generateId(name);
        try {
            const playerDocRef = doc(playersRef, id);
            const docSnap = await getDoc(playerDocRef);
            let playerData;
            if (docSnap.exists()) {
                const existingData = docSnap.data();
                const todayGames = filterTodayGames(existingData.todayRecentGames);
                const keepWl = todayGames.length > 0 || (existingData.todayRecentGames || []).length === 0;
                playerData = {
                    ...existingData, level, gender, isGuest, team, status: 'active',
                    todayRecentGames: todayGames,
                    todayWins: keepWl ? (existingData.todayWins || 0) : 0,
                    todayLosses: keepWl ? (existingData.todayLosses || 0) : 0,
                    isResting: existingData.isResting || false, // 재입장해도 휴식 상태는 유지
                };
            } else {
                playerData = {
                    id, name, level, gender, isGuest, team,
                    entryTime: new Date().toISOString(), isResting: false, status: 'active',
                    todayRecentGames: [], todayWins: 0, todayLosses: 0,
                };
            }
            await setDoc(playerDocRef, playerData, { merge: true });
            setCurrentUser(playerData);
            localStorage.setItem(STORAGE_KEYS.currentUserId, id);
        } catch (error) {
            log.error('Enter failed: ', error);
            setModal({ type: 'alert', data: { title: '오류', body: '입장 처리 중 문제가 발생했습니다.' } });
        }
    }, [setCurrentUser]);

    const handleLogout = useCallback(() => {
        if (!currentUser) return;
        if (currentUser.isGhostAdmin) {
            setModal({ type: 'confirm', data: {
                title: '나가기', body: '관리자 모드를 종료하시겠습니까?', confirmLabel: '나가기',
                onConfirm: () => { localStorage.removeItem(STORAGE_KEYS.ghostAdmin); setCurrentUser(null); setModal(CLOSED_MODAL); },
            } });
            return;
        }
        setModal({ type: 'confirm', data: {
            title: '나가기', body: '나가시면 현황판에서 제외됩니다. 정말 나가시겠습니까? (기록은 유지됩니다)', confirmLabel: '나가기',
            onConfirm: async () => {
                try {
                    const isPlaying = inProgressPlayerIds.has(currentUser.id);
                    await updateGameState((currentState) => {
                        const newState = JSON.parse(JSON.stringify(currentState));
                        const playerId = currentUser.id;
                        const clearFrom = (lists) => Object.values(lists || {}).forEach((match) => {
                            if (!match) return;
                            const idx = match.indexOf(playerId);
                            if (idx > -1) match[idx] = null;
                        });
                        clearFrom(newState.scheduledMatches);
                        clearFrom(newState.autoMatches);
                        // 경기 진행 중이면 코트는 그대로 둔다 (관리자가 종료할 수 있게)
                        if (!isPlaying) {
                            newState.inProgressCourts.forEach((c, i) => {
                                if (c?.players) {
                                    const idx = c.players.indexOf(playerId);
                                    if (idx > -1) c.players[idx] = null;
                                    if (c.players.every((p) => p === null)) newState.inProgressCourts[i] = null;
                                }
                            });
                        }
                        return { newState };
                    }).catch(() => {}); // 실패해도 퇴장은 진행 (예약 정리는 repair 가 한다)
                    if (isPlaying) await updateDoc(doc(playersRef, currentUser.id), { isResting: true });
                    else await updateDoc(doc(playersRef, currentUser.id), { status: 'inactive' });
                    localStorage.removeItem(STORAGE_KEYS.currentUserId);
                    setCurrentUser(null);
                    setModal(CLOSED_MODAL);
                } catch (error) {
                    log.error(error);
                    setModal({ type: 'alert', data: { title: '오류', body: '나가는 도중 문제가 발생했습니다.' } });
                }
            },
        } });
    }, [currentUser, updateGameState, inProgressPlayerIds, setCurrentUser]);

    // ── 휴식 (타이머) ─────────────────────────────────────────────────────────
    const handleToggleRest = useCallback(() => {
        if (!currentUser || currentUser.isGhostAdmin) return;
        if (currentUser.isResting) {
            resumeFromRest(currentUser.id).catch(() => setModal({ type: 'alert', data: { title: '오류', body: '휴식 상태 변경에 실패했습니다.' } }));
            return;
        }
        setModal({ type: 'restTimer', data: {} });
    }, [currentUser]);

    const handleStartRest = useCallback(async (minutes) => {
        if (!currentUser || currentUser.isGhostAdmin) return;
        try {
            const loc = findPlayerLocation(currentUser.id);
            if (loc.location === 'schedule' || loc.location === 'auto') await handleReturnToWaiting(currentUser);
            await startRest(currentUser.id, minutes);
            setModal(CLOSED_MODAL);
            toastSuccess(minutes ? `☕ ${minutes}분 뒤 자동으로 복귀해요` : '☕ 휴식 중 — 메뉴에서 복귀할 수 있어요');
        } catch {
            setModal({ type: 'alert', data: { title: '오류', body: '휴식 상태 변경에 실패했습니다.' } });
        }
    }, [currentUser, findPlayerLocation, handleReturnToWaiting]);

    // ── 관리자 설정 ───────────────────────────────────────────────────────────
    const handleSwitchMatchMode = useCallback((mode) => {
        const toTeam = mode === MATCH_MODE_TEAM;
        const activeList = Object.values(allPlayers).filter((p) => p.status === 'active');
        setModal({ type: 'confirm', data: {
            title: toTeam ? '⚔️ 청백전으로 전환' : '🏸 일반 모드로 전환',
            body: `[경고] 접속 중인 선수 ${activeList.length}명이 모두 내보내지고, 진행/예정/자동매칭 경기와 팀 점수판이 비워집니다.\n선수들은 ${toTeam ? '팀을 골라 ' : ''}다시 입장해야 합니다. (오늘 경기 기록은 유지)\n\n계속할까요?`,
            confirmLabel: '전환',
            onConfirm: async () => {
                setModal(CLOSED_MODAL);
                setIsSettingsOpen(false);
                try {
                    let batch = writeBatch(db);
                    let n = 0;
                    for (const p of activeList) {
                        batch.update(doc(playersRef, p.id), { status: 'inactive', isResting: false });
                        n += 1;
                        if (n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
                    }
                    if (n % 400 !== 0) await batch.commit();
                    await updateGameState((currentState) => {
                        const newState = JSON.parse(JSON.stringify(currentState));
                        newState.scheduledMatches = {};
                        newState.autoMatches = {};
                        newState.inProgressCourts = Array(newState.numInProgressCourts || 4).fill(null);
                        newState.teamScores = emptyTeamScores();
                        delete newState.lastTeamResult;
                        delete newState.teamResultLog;
                        return { newState };
                    }, '경기방 초기화에 실패했습니다.');
                    await setDoc(configRef, { matchMode: mode, matchModeChangedAt: new Date().toISOString() }, { merge: true });
                    writeAuditLog('경기방식전환', { by: currentUser?.name || null, mode, kicked: n });
                    if (currentUser?.isGhostAdmin) {
                        setModal({ type: 'alert', data: { title: '전환 완료', body: `${toTeam ? '청백전' : '일반'} 모드로 바뀌었습니다. 선수 ${n}명을 내보냈어요.` } });
                    }
                } catch (e) {
                    log.error('경기 방식 전환 실패:', e);
                    setModal({ type: 'alert', data: { title: '오류', body: '경기 방식 전환 중 문제가 발생했습니다.' } });
                }
            },
        } });
    }, [allPlayers, currentUser, updateGameState]);

    const handleSystemReset = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '모두 대기로 이동',
            body: '[경고] 진행/예정/자동매칭 경기가 모두 사라지고 방 안의 선수들이 모두 대기 명단으로 이동합니다. 선수 기록은 유지됩니다. 계속하시겠습니까?',
            confirmLabel: '이동',
            onConfirm: async () => {
                try {
                    await updateGameState((currentState) => {
                        const newState = JSON.parse(JSON.stringify(currentState));
                        newState.scheduledMatches = {};
                        newState.inProgressCourts = Array(newState.numInProgressCourts).fill(null);
                        newState.autoMatches = {};
                        return { newState };
                    }, '이동 처리에 실패했습니다.');
                } catch { return; }
                setModal({ type: 'alert', data: { title: '완료', body: '모든 선수가 대기 명단으로 이동되었습니다.' } });
            },
        } });
    }, [updateGameState]);

    const handleClearPlayerHistory = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '선수 히스토리 삭제',
            body: '[경고] 현재 활성화된 모든 선수의 오늘 경기 기록(히스토리 및 게임 수)이 완전히 삭제됩니다. (매일 새벽 2시 자동 초기화 기능과 동일) 계속하시겠습니까?',
            confirmLabel: '삭제',
            onConfirm: async () => {
                try {
                    const batch = writeBatch(db);
                    Object.values(activePlayers).forEach((player) => batch.update(doc(playersRef, player.id), {
                        todayWins: 0, todayLosses: 0, todayWinStreakCount: 0, todayRecentGames: [],
                    }));
                    await batch.commit();
                    setModal({ type: 'alert', data: { title: '완료', body: '모든 선수의 히스토리가 초기화되었습니다.' } });
                } catch (error) {
                    log.error('히스토리 초기화 실패: ', error);
                    setModal({ type: 'alert', data: { title: '오류', body: '선수 히스토리 초기화 중 문제가 발생했습니다.' } });
                }
            },
        } });
    }, [activePlayers]);

    const handleAdminAddPlayer = useCallback(async (formData) => {
        const { name, level, gender, isGuest } = formData;
        const team = formData.team === TEAM_BLUE || formData.team === TEAM_WHITE ? formData.team : null;
        if (!name) { setModal({ type: 'alert', data: { title: '오류', body: '이름을 입력해주세요.' } }); return; }
        const id = generateId(name);
        try {
            const playerDocRef = doc(playersRef, id);
            const docSnap = await getDoc(playerDocRef);
            const playerData = docSnap.exists()
                ? { ...docSnap.data(), level, gender, isGuest, team, status: 'active', todayRecentGames: filterTodayGames(docSnap.data().todayRecentGames), isResting: docSnap.data().isResting || false }
                : { id, name, level, gender, isGuest, team, entryTime: new Date().toISOString(), isResting: false, status: 'active', todayRecentGames: [], todayWins: 0, todayLosses: 0 };
            await setDoc(playerDocRef, playerData, { merge: true });
            setModal({ type: 'alert', data: { title: '추가 완료', body: `${name} 선수가 수동으로 추가되었습니다.` } });
        } catch (error) {
            log.error('Admin add player failed: ', error);
            setModal({ type: 'alert', data: { title: '오류', body: '선수 추가 처리 중 문제가 발생했습니다.' } });
        }
    }, []);

    const handleSomoimSync = useCallback(() => {
        setModal({ type: 'confirm', data: {
            title: '소모임 정모 동기화', body: '오늘 소모임 정모의 참석 인원을 확인하여 선수카드를 자동 생성합니다. 진행할까요?', confirmLabel: '동기화', tone: 'primary',
            onConfirm: async () => {
                setModal({ type: 'alert', data: { title: '동기화 중...', body: '소모임에서 참석 명단을 가져오고 있습니다. 잠시만 기다려주세요.' } });
                try {
                    const result = await syncSomoimAttendees();
                    const { dateKey } = getKstParts();
                    await setDoc(somoimSyncRef, {
                        lastResult: { ...result, at: new Date().toISOString(), trigger: 'manual' },
                        lastError: null,
                        ...(result.noEvent ? {} : { auto: { key: dateKey, status: 'done', finishedAt: new Date().toISOString() } }),
                    }, { merge: true }).catch((err) => log.error('[소모임 동기화] 결과 기록 실패:', err));
                    setModal({ type: 'somoimSyncResult', data: result });
                } catch (e) {
                    const code = e.code || 'UNKNOWN';
                    log.error('[소모임 동기화] 수동 동기화 실패:', code, e);
                    setModal({ type: 'alert', data: { title: '동기화 실패', body: `소모임 동기화에 실패하였습니다 (오류코드: ${code}) 관리자에게 문의해주세요.\n\n${e.message || ''}` } });
                }
            },
        } });
    }, []);

    const handleGenerateRobots = useCallback(async (maleCount, femaleCount) => {
        setModal({ type: 'alert', data: { title: '생성 중', body: '테스트 로봇을 생성하고 있습니다...' } });
        try {
            const batch = writeBatch(db);
            const now = new Date().toISOString();
            const robotLevels = ['S조', 'A조', 'B조', 'C조', 'D조'];
            const make = (gender, i) => {
                const id = `Test_${gender === '남' ? 'M' : 'F'}_${Date.now()}_${i}`;
                batch.set(doc(playersRef, id), {
                    id, name: `로봇${gender === '남' ? '남' : '여'}${i + 1}`,
                    level: teamMode ? robotLevels[(i + (gender === '남' ? 0 : 2)) % robotLevels.length] : (gender === '남' ? 'C조' : 'D조'),
                    gender, isGuest: !teamMode, team: teamMode ? (i % 2 === 0 ? TEAM_BLUE : TEAM_WHITE) : null,
                    entryTime: now, isResting: false, status: 'active', todayRecentGames: [], todayWins: 0, todayLosses: 0,
                });
            };
            for (let i = 0; i < maleCount; i += 1) make('남', i);
            for (let i = 0; i < femaleCount; i += 1) make('여', i);
            await batch.commit();
            setModal({ type: 'alert', data: { title: '완료', body: `테스트 로봇 (남 ${maleCount}명, 여 ${femaleCount}명) 생성 완료!` } });
        } catch (error) {
            log.error('Robot generation failed: ', error);
            setModal({ type: 'alert', data: { title: '오류', body: '로봇 생성 중 문제가 발생했습니다.' } });
        }
    }, [teamMode]);

    // 설정 저장 — 코트 수·공지·자동매칭 민감도·관리자 목록을 한 번에 (저장 버튼 하나로 일관되게)
    const handleSettingsUpdate = useCallback(async (settings) => {
        try {
            const { scheduled, courts, announcement, autoMatchConfig, adminNames: nextAdmins } = settings;
            const { announcementType, photoFile } = autoMatchConfig;
            let finalPhotoUrl = seasonConfig.announcementPhotoUrl || '';

            if (announcementType === 'photo' && photoFile instanceof File) {
                setModal({ type: 'alert', data: { title: '업로드 중', body: '사진을 업로드하고 있습니다...' } });
                if (finalPhotoUrl) {
                    try { await deleteObject(ref(storage, 'announcements/season_image')); }
                    catch { log.debug('기존 공지 사진 없음 — 삭제 건너뜀'); }
                }
                const storageRef = ref(storage, 'announcements/season_image');
                await uploadBytes(storageRef, await resizeImageFile(photoFile)); // [성능] 1600px 로 줄여서 올린다
                finalPhotoUrl = await getDownloadURL(storageRef);
            }

            // 코트 수를 줄일 때: 잘려 나가는 코트에 경기가 진행 중이면 저장하지 않는다 (경기 기록이 통째로
            // 사라지는 사고 방지). 잘려 나가는 '경기 예정' 줄에 선수가 있으면 그 줄을 비워 대기 명단으로 돌려보낸다
            // (안 그러면 화면에 보이지 않는 줄에 갇혀 매칭에서도 빠진다).
            let blockedCourt = null;
            await runTx('설정 저장', async (transaction) => {
                const snap = await transaction.get(doc(db, 'gameState', 'live'));
                if (!snap.exists()) throw new Error('GameState document does not exist!');
                const g = snap.data();
                const next = { ...g, numScheduledMatches: scheduled, numInProgressCourts: courts };
                const cur = next.inProgressCourts || [];
                const busy = cur.findIndex((c, i) => i >= courts && c && Array.isArray(c.players) && c.players.some(Boolean));
                if (busy !== -1) { blockedCourt = busy + 1; return; }
                next.inProgressCourts = cur.length > courts ? cur.slice(0, courts) : [...cur, ...Array(courts - cur.length).fill(null)];
                const sched = { ...(next.scheduledMatches || {}) };
                Object.keys(sched).forEach((k) => { if (Number(k) >= scheduled) delete sched[k]; });
                next.scheduledMatches = sched;
                transaction.set(doc(db, 'gameState', 'live'), next);
            });
            if (blockedCourt !== null) {
                setModal({ type: 'alert', data: { title: '코트 수를 줄일 수 없어요', body: `${blockedCourt}번 코트에 경기가 진행 중이에요.
그 경기를 먼저 종료(FINISH)한 뒤 코트 수를 줄여주세요.` } });
                return;
            }

            const pure = { ...autoMatchConfig };
            delete pure.photoFile;
            pure.announcementType = announcementType || 'text';
            pure.announcementPhotoUrl = finalPhotoUrl;
            ['isMaleEnabled', 'isFemaleEnabled', 'isEnabled', 'minMaleScore', 'minFemaleScore', 'isManualConfig'].forEach((k) => delete pure[k]);
            pure.sensitivity = pure.sensitivity || 'normal';
            pure.perGenderSensitivity = !!pure.perGenderSensitivity;
            pure.maleSensitivity = pure.maleSensitivity || pure.sensitivity;
            pure.femaleSensitivity = pure.femaleSensitivity || pure.sensitivity;

            const configUpdate = { announcement, autoMatchConfig: pure, announcementType: announcementType || 'text', announcementPhotoUrl: finalPhotoUrl };
            if (Array.isArray(nextAdmins) && nextAdmins.length > 0) {
                configUpdate.adminNames = nextAdmins;
                if (adminNames.join('|') !== nextAdmins.join('|')) writeAuditLog('관리자목록변경', { by: currentUser?.name || null, from: adminNames, to: nextAdmins });
            }
            await setDoc(configRef, configUpdate, { merge: true });

            setIsSettingsOpen(false);
            setModal(CLOSED_MODAL);
            toastSuccess('✅ 설정이 저장됐어요');
        } catch (error) {
            log.error('Settings save failed:', error);
            setModal({ type: 'alert', data: { title: '저장 실패', body: '설정 저장 중 오류가 발생했습니다.' } });
        }
    }, [seasonConfig, adminNames, currentUser]);

    // ── 내 위치 찾기 (하단 FAB) ────────────────────────────────────────────────
    const handleLocateMe = useCallback(() => {
        if (!currentUser || currentUser.isGhostAdmin) return;
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

    // ── 렌더 ─────────────────────────────────────────────────────────────────
    if (isLoading) return <SkeletonScreen />;
    if (isInAppBrowser) return <InAppBrowserGuide onContinue={dismissInAppGuide} />;
    if (!currentUser) return <EntryPage onEnter={handleEnter} roster={roster} teamMode={teamMode} />;

    const todayKstKey = getKstParts().dateKey;
    const showSyncErrorBanner = somoimSync?.auto?.status === 'error' && somoimSync?.lastError?.dateKey === todayKstKey;
    const restRemaining = restRemainingMin(currentUser);
    const myTeam = teamMode && !currentUser.isGhostAdmin ? getTeamOf(currentUser) : null;

    const sectionProps = {
        waiting: { maleWaitingPlayers, femaleWaitingPlayers, selectedPlayerIds, isAdmin, handleCardClick, handleDeleteFromWaiting, setModal, currentUser, inProgressPlayerIds, onlineIds, teamMode, aceIds },
        auto: { autoMatches, players: activePlayers, allPlayers, courtIndexByPlayer, isAdmin, handleStartAutoMatch: court.handleStartAutoMatch, handleReturnToWaiting, handleClearAutoMatches: matching.handleClearAutoMatches, handleDeleteAutoMatch: matching.handleDeleteAutoMatch, currentUser, handleAutoMatchCardClick, selectedPlayerIds, inProgressPlayerIds, handleAutoMatchSlotClick, handleGenerateMatch: matching.handleGenerateMatch, generatingGender: matching.generatingGender, onlineIds, teamMode, setModal },
        scheduled: { numScheduledMatches: gameState.numScheduledMatches, scheduledMatches: gameState.scheduledMatches, players: activePlayers, selectedPlayerIds, isAdmin, handleCardClick, handleReturnToWaiting, setModal, handleSlotClick, handleStartMatch: court.handleStartMatch, currentUser, handleClearScheduledMatches, handleDeleteScheduledMatch, inProgressPlayerIds, onlineIds, teamMode, aceIds },
        courts: { numInProgressCourts: gameState.numInProgressCourts, inProgressCourts: gameState.inProgressCourts, players: activePlayers, allPlayers, isAdmin, handleEndMatch: court.handleEndMatch, currentUser, courtMove, setCourtMove, handleMoveOrSwapCourt: court.handleMoveOrSwapCourt, onlineIds, teamMode, aceIds },
    };

    return (
        <div className="cox-dark text-white min-h-screen font-sans flex flex-col" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
            {/* [청백전] 득점 실황 배너 + 화면 가장자리 팀 색 플래시 */}
            {edgeFlash && <div key={`edge-${edgeFlash.id}`} className={`tm-edge ${edgeFlash.key}`} aria-hidden="true" />}
            {liveBanner && (
                <div key={`live-${liveBanner.id}`} className={`tm-live ${liveBanner.key}`} role="status" onClick={clearLiveBanner}>
                    <span className="t">{liveBanner.title}</span>
                    <span className="b">{liveBanner.body}</span>
                </div>
            )}

            {/* [소모임 동기화] 자동 동기화 실패 배너 */}
            {showSyncErrorBanner && (
                <div className="bg-orange-600 text-white p-3 flex items-center justify-between shadow-lg sticky top-0 z-[54]" role="alert">
                    <p className="flex-1 pr-2 font-bold text-[11px] leading-tight">
                        ⚠️ 소모임 동기화에 실패하였습니다 (오류코드: {somoimSync?.lastError?.code || 'UNKNOWN'}) 관리자에게 문의해주세요.
                    </p>
                    {isAdmin && <button type="button" onClick={handleSomoimSync} className="bg-white text-orange-600 px-3 min-h-[36px] rounded text-xs font-bold shadow-sm active:scale-95 flex-shrink-0">다시 시도</button>}
                </div>
            )}

            {/* ── 모달 ── */}
            {modal?.type === 'season' && <SeasonModal {...modal.data} onClose={() => { setIsSeasonModalDismissed(true); closeModal(); }} />}
            {modal?.type === 'adminEditPlayer' && <AdminEditPlayerModal player={modal.data.player} allPlayers={allPlayers} onClose={closeModal} setModal={setModal} teamMode={teamMode} />}
            {modal?.type === 'teamMatchEnd' && gameState?.inProgressCourts?.[modal.data.courtIndex]?.players && (
                <TeamMatchEndModal
                    courtIndex={modal.data.courtIndex}
                    court={gameState.inProgressCourts[modal.data.courtIndex]}
                    allPlayers={allPlayers}
                    onPickWinner={(side) => court.handleTeamPickWinner(modal.data.courtIndex, side)}
                    onCancelMatch={() => court.handleTeamCancelMatch(modal.data.courtIndex)}
                    onClose={closeModal}
                />
            )}
            {modal?.type === 'teamScoreEdit' && <TeamScoreEditModal teamScores={teamScores} onSave={court.handleTeamScoreSave} onClose={closeModal} />}
            {modal?.type === 'teamLog' && <TeamLogModal log={gameState?.teamResultLog} teamScores={teamScores} allPlayers={allPlayers} onClose={closeModal} />}
            {modal?.type === 'confirm' && <ConfirmationModal {...modal.data} onCancel={closeModal} />}
            {modal?.type === 'hiddenKey' && <HiddenKeyModal onSubmit={handleHiddenKeySubmit} onCancel={closeModal} />}
            {modal?.type === 'courtSelection' && <CourtSelectionModal {...modal.data} onCancel={closeModal} />}
            {modal?.type === 'alert' && <AlertModal {...modal.data} onClose={closeModal} />}
            {modal?.type === 'somoimSyncResult' && <SomoimSyncResultModal result={modal.data} onClose={closeModal} />}
            {modal?.type === 'myHistory' && <MyHistoryModal player={currentUser} allPlayers={allPlayers} onClose={closeModal} teamMode={teamMode} rankInfo={myRankInfo} />}
            {modal?.type === 'restTimer' && <RestTimerModal onConfirm={handleStartRest} onCancel={closeModal} />}
            <Suspense fallback={null}>
                {modal?.type === 'matchOptions' && (
                    <MatchOptionsModal
                        key={`${modal.data.gender}-${modal.data.result.totalCombos}-${Object.keys(autoMatches).length}`}
                        genderLabel={modal.data.genderLabel}
                        result={modal.data.result}
                        queueCount={Object.keys(autoMatches).length}
                        onSelect={matching.handleSelectMatchOption}
                        onRegenerate={() => matching.handleRegenerateOptions(modal.data.gender, modal.data.genderLabel)}
                        onCancel={closeModal}
                    />
                )}
                {isRosterOpen && <RosterManageModal roster={roster} onClose={() => setIsRosterOpen(false)} setModal={setModal} />}
                {isSettingsOpen && (
                    <SettingsModal
                        isAdmin={isAdmin}
                        scheduledCount={gameState.numScheduledMatches}
                        courtCount={gameState.numInProgressCourts}
                        seasonConfig={seasonConfig}
                        adminNames={adminNames}
                        activePlayers={activePlayers}
                        allPlayers={allPlayers}
                        currentUser={currentUser}
                        roster={roster}
                        onSave={handleSettingsUpdate}
                        onCancel={() => setIsSettingsOpen(false)}
                        setModal={setModal}
                        onSystemReset={handleSystemReset}
                        onClearPlayerHistory={handleClearPlayerHistory}
                        onGenerateRobots={handleGenerateRobots}
                        onAdminAddPlayer={handleAdminAddPlayer}
                        onSomoimSync={handleSomoimSync}
                        onOpenRoster={() => setIsRosterOpen(true)}
                        somoimSync={somoimSync}
                        matchMode={teamMode ? MATCH_MODE_TEAM : MATCH_MODE_NORMAL}
                        onSwitchMatchMode={handleSwitchMatchMode}
                        teamScores={teamScores}
                    />
                )}
            </Suspense>

            {/* ── 앱바 ── */}
            <header className="cox-appbar">
                <span
                    onPointerDown={handleLogoSecretTap}
                    style={{ display: 'flex', alignItems: 'center', flexShrink: 0, padding: 12, margin: -12, touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none' }}
                    aria-hidden="true"
                >
                    <CoxMark size={36} className="cox-appbar-mark" />
                </span>
                <div className="cox-appbar-brand">
                    <div className="cox-hello">
                        <span className="cox-livedot" aria-hidden="true"></span>
                        <span>
                            {isAdmin ? '👑 관리자' : `${currentUser.name} 님`}
                            {myTeam && <b style={{ color: TEAM_META[myTeam].text }}> · {TEAM_META[myTeam].label}</b>}
                            {onlineCount > 0 && <b className="cox-online-count"> · {onlineCount}명 접속 중</b>}
                        </span>
                    </div>
                    <h1 className="cox-title">
                        {teamMode ? (<>청백<em>전</em></>) : activeTab === 'inProgress' ? (<>경기 <em>진행</em></>) : (<>오늘의 <em>경기</em></>)}
                    </h1>
                </div>

                {/* [휴식] 메뉴를 열지 않고 바로 — 프로필 버튼과 같은 크기, 쉬는 중이면 라임 채움 + 남은 분 */}
                {!currentUser.isGhostAdmin && (
                    <button
                        type="button"
                        className={`cox-rest-btn ${currentUser.isResting ? 'on' : ''}`}
                        onClick={handleToggleRest}
                        aria-label={currentUser.isResting ? `경기 복귀하기${restRemaining !== null ? ` (${restRemaining}분 남음)` : ''}` : '잠시 휴식하기'}
                        title={currentUser.isResting ? '경기 복귀하기' : '잠시 휴식하기'}
                        aria-pressed={currentUser.isResting}
                        data-tut="rest"
                    >
                        <Icon name={currentUser.isResting ? 'play' : 'mug-hot'} size={20} />
                        {currentUser.isResting && restRemaining !== null && <span className="cox-rest-btn-min" aria-hidden="true">{restRemaining}′</span>}
                    </button>
                )}
                <div className="relative flex-shrink-0">
                    <button
                        type="button"
                        className={`cox-avatar-btn ${isAdmin ? 'admin' : ''}`}
                        onClick={() => setIsProfileMenuOpen((o) => !o)}
                        aria-label="프로필 메뉴"
                        aria-haspopup="menu"
                        aria-expanded={isProfileMenuOpen}
                        data-tut="avatar"
                    >
                        {currentUser.isGhostAdmin ? '👻' : currentUser.name.slice(-2)}
                    </button>

                    {isProfileMenuOpen && (
                        <>
                            {/* 메뉴 밖을 탭하면 닫힌다 — 앱바의 블러는 ::before 에 있어 이 fixed 배경이 화면 전체를 덮는다 */}
                            <div className="cox-menu-backdrop" onClick={() => setIsProfileMenuOpen(false)} aria-hidden="true" />
                            <div className="cox-menu" data-tut="menu" role="menu">
                                <div className="cox-menu-head">
                                    <div className={`cox-avatar-btn ${isAdmin ? 'admin' : ''}`} style={{ width: 38, height: 38, borderRadius: 12, pointerEvents: 'none' }} aria-hidden="true">
                                        {currentUser.isGhostAdmin ? '👻' : currentUser.name.slice(-2)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="nm truncate">{currentUser.name}</div>
                                        <div className="rl">
                                            {currentUser.isGhostAdmin ? '유령 모드 · 선수 카드 없음'
                                                : isAdmin ? `관리자 계정${myTeam ? ` · ${TEAM_META[myTeam].label}` : ''}`
                                                    : teamMode ? `${currentUser.level} · ${myTeam ? TEAM_META[myTeam].label : '팀 미정'}`
                                                        : `${currentUser.level} · ${currentUser.isGuest ? '게스트' : '회원'}`}
                                        </div>
                                    </div>
                                </div>

                                {isAdmin && (
                                    <button type="button" role="menuitem" className="cox-menu-item" onClick={() => { setIsProfileMenuOpen(false); setIsSettingsOpen(true); }} data-tut="menu-settings">
                                        <Icon name="sliders" size={18} />관리자 설정
                                    </button>
                                )}
                                {isAdmin && (
                                    <button type="button" role="menuitem" className={`cox-menu-item ${onboarding.hasSeenAutoMatchGuide ? '' : 'accent'}`} onClick={() => { setIsProfileMenuOpen(false); onboarding.handleReplayAutoMatchGuide(); }}>
                                        <Icon name="robot" size={18} />자동매칭 새 기능 {onboarding.hasSeenAutoMatchGuide ? '' : '🔴'}
                                    </button>
                                )}
                                <button type="button" role="menuitem" className="cox-menu-item" onClick={() => { setIsProfileMenuOpen(false); onboarding.handleReplayTutorial(); }} data-tut="menu-tutorial">
                                    <Icon name="graduation-cap" size={18} />튜트리얼 다시 보기
                                </button>
                                {/* [테마] 다크 → 라이트 → 기기 설정 순으로 바뀐다 */}
                                <button type="button" role="menuitem" className="cox-menu-item" onClick={() => setThemePref(cycleTheme())} aria-label={`테마: ${THEME_LABEL[themePref]}. 누르면 바뀝니다`}>
                                    <Icon name={themePref === 'light' ? 'sun' : 'moon'} size={18} />테마 · {THEME_LABEL[themePref]}
                                </button>
                                <button type="button" role="menuitem" className={`cox-menu-item ${soundOn ? 'accent' : ''}`} onClick={() => { const next = !soundOn; setSoundEnabled(next); setSoundOn(next); }}>
                                    <Icon name={soundOn ? 'volume-high' : 'volume-xmark'} size={18} />효과음 {soundOn ? '켜짐' : '꺼짐'}
                                </button>
                                <button type="button" role="menuitem" className="cox-menu-item danger" onClick={() => { setIsProfileMenuOpen(false); handleLogout(); }}>
                                    <Icon name="right-from-bracket" size={18} />나가기
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </header>

            {(pullDistance > 0 || isRefreshing) && (
                <div className="ptr-indicator" style={{ transform: `translateX(-50%) translateY(${Math.min(pullDistance, 64)}px)`, opacity: isRefreshing ? 1 : Math.min(1, pullDistance / 45) }} aria-hidden="true">
                    <div className={`ptr-circle ${isRefreshing ? 'refreshing' : ''}`}>
                        <svg viewBox="0 0 24 24" style={!isRefreshing ? { transform: `rotate(${pullDistance * 3}deg)` } : undefined}>
                            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
                        </svg>
                    </div>
                </div>
            )}

            <main ref={mainScrollRef} className="flex-grow flex flex-col gap-3 p-1.5 overflow-y-auto" style={{ paddingBottom: isMobile ? 'calc(104px + env(safe-area-inset-bottom, 0px))' : '16px' }}>
                {teamMode && (
                    <TeamScoreBoard
                        teamScores={teamScores} blueCount={teamCounts.blue} whiteCount={teamCounts.white} isAdmin={isAdmin}
                        onLongPress={() => setModal({ type: 'teamScoreEdit', data: {} })}
                        onTap={() => setModal((m) => (m?.type ? m : { type: 'teamLog', data: {} }))}
                    />
                )}
                {teamMode && rankings && <TeamRankingSection rankings={rankings} currentUserId={currentUser.isGhostAdmin ? null : currentUser.id} aceIds={aceIds} />}
                {isMobile ? (
                    <div className="flex flex-col gap-3">
                        {activeTab === 'matching' && (
                            <div key="tab-matching" className="flex flex-col gap-3 tab-fade-in">
                                <WaitingListSection {...sectionProps.waiting} />
                                {!teamMode && <AutoMatchesSection {...sectionProps.auto} />}
                                <ScheduledMatchesSection {...sectionProps.scheduled} />
                            </div>
                        )}
                        {activeTab === 'inProgress' && (
                            <div key="tab-inprogress" className="tab-fade-in">
                                <InProgressCourtsSection {...sectionProps.courts} />
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <WaitingListSection {...sectionProps.waiting} />
                        {!teamMode && <AutoMatchesSection {...sectionProps.auto} />}
                        <ScheduledMatchesSection {...sectionProps.scheduled} />
                        <InProgressCourtsSection {...sectionProps.courts} />
                    </div>
                )}
            </main>

            {/* ── 하단 글래스 내비 (모바일) + 가운데 라임 FAB ── */}
            {isMobile && (
                <nav className="cox-bottomnav" data-tut="nav" aria-label="화면 이동">
                    <button type="button" className={`cox-nav-btn ${activeTab === 'matching' ? 'active' : ''}`} onClick={() => setActiveTab('matching')} aria-current={activeTab === 'matching' ? 'page' : undefined}>
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2.5v3M16 2.5v3" /></svg>
                        <span>경기 예정</span>
                    </button>
                    <button type="button" className="cox-fab" onClick={handleLocateMe} title="내 위치 찾기" aria-label="내 위치 찾기" data-tut="fab">
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="8" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /></svg>
                    </button>
                    <button type="button" className={`cox-nav-btn ${activeTab === 'inProgress' ? 'active' : ''}`} onClick={() => setActiveTab('inProgress')} aria-current={activeTab === 'inProgress' ? 'page' : undefined}>
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h3l2.5-7 5 16 2.5-9H21" /></svg>
                        <span>경기 진행</span>
                    </button>
                </nav>
            )}

            {/* ── 온보딩 (가장 위) ── */}
            <Suspense fallback={null}>
                {onboarding.autoMatchGuideOpen && (
                    <AutoMatchGuide userName={currentUser.isGhostAdmin ? null : currentUser.name} onComplete={onboarding.handleAutoMatchGuideComplete} onDismiss={onboarding.handleAutoMatchGuideDismiss} />
                )}
                {onboarding.tutorial?.phase === 'intro' && (
                    <TutorialIntroModal mode={onboarding.tutorial.mode} userName={currentUser.name} onStart={onboarding.startTutorialRun} onSkip={() => onboarding.finishTutorial(onboarding.tutorial.mode)} />
                )}
                {onboarding.tutorial?.phase === 'run' && onboarding.tutorialSteps.length > 0 && (
                    <TutorialOverlay
                        mode={onboarding.tutorial.mode}
                        steps={onboarding.tutorialSteps}
                        stepIndex={Math.min(onboarding.tutorial.step, onboarding.tutorialSteps.length - 1)}
                        prepare={onboarding.prepareTutorialStep}
                        activeTab={activeTab}
                        onPrev={onboarding.handleTutorialPrev}
                        onNext={onboarding.handleTutorialNext}
                        onSkip={() => onboarding.finishTutorial(onboarding.tutorial.mode)}
                    />
                )}
            </Suspense>
        </div>
    );
}
