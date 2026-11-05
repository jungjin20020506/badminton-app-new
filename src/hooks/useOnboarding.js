import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readLocalTutorialSeen, markTutorialSeen, AUTOMATCH_GUIDE_KEY } from '../tutorial/tutorialStorage';
import { TUTORIAL_ADMIN_STEPS, TUTORIAL_USER_STEPS } from '../tutorial/tutorialSteps';

// ===================================================================================
// [온보딩] 튜트리얼(스포트라이트) + 자동매칭 필독 안내의 순서와 상태
// -----------------------------------------------------------------------------------
// 우선순위: 공지창 → 자동매칭 필독 안내(관리자, 끝까지 봐야 기록) → 튜트리얼(첫 1회)
// 두 창이 겹쳐 뜨지 않도록 "공지가 뜰 차례면 기다린다", "안내가 떠 있으면 튜트리얼은
// 기다린다"는 규칙을 여기서 관리한다. 자동 실행은 접속당 한 번만 시도한다.
// ===================================================================================
export function useOnboarding({
    isLoading, currentUser, isAdmin, isInAppBrowser, isMobile, teamMode, seasonConfig,
    modal, setModal, isSettingsOpen, setIsSettingsOpen, isRosterOpen, setIsRosterOpen,
    setIsProfileMenuOpen, setActiveTab, isSeasonModalDismissed,
}) {
    const [tutorial, setTutorial] = useState(null); // { mode:'admin'|'user', phase:'intro'|'run', step }
    const tutorialAutoTriedRef = useRef(false);
    const [autoMatchGuideOpen, setAutoMatchGuideOpen] = useState(false);
    const autoMatchGuideTriedRef = useRef(false);

    // 공지창이 뜰 차례라면 온보딩은 기다린다
    const seasonModalPending = useMemo(() => {
        if (isLoading || !seasonConfig) return true;
        if (seasonConfig.announcementType === 'none') return false;
        if (isSeasonModalDismissed) return false;
        return localStorage.getItem(`seen-${seasonConfig.seasonId}`) !== new Date().toDateString();
    }, [isLoading, seasonConfig, isSeasonModalDismissed]);

    const hasSeenAutoMatchGuide = useMemo(() => {
        if (!currentUser) return true;
        const seen = { ...readLocalTutorialSeen(currentUser.id), ...(currentUser.tutorialSeen || {}) };
        return !!seen[AUTOMATCH_GUIDE_KEY];
    }, [currentUser]);

    // [자동매칭 v2] 관리자 필독 안내 — 관리자가 접속하면 딱 한 번 자동으로 뜬다
    useEffect(() => {
        if (isLoading || !currentUser || !isAdmin || isInAppBrowser) return undefined;
        if (autoMatchGuideOpen || autoMatchGuideTriedRef.current) return undefined;
        if (seasonModalPending || modal?.type || isSettingsOpen || isRosterOpen) return undefined;
        if (hasSeenAutoMatchGuide) return undefined;
        const timer = setTimeout(() => { autoMatchGuideTriedRef.current = true; setAutoMatchGuideOpen(true); }, 600);
        return () => clearTimeout(timer);
    }, [isLoading, currentUser, isAdmin, isInAppBrowser, autoMatchGuideOpen, hasSeenAutoMatchGuide,
        seasonModalPending, modal, isSettingsOpen, isRosterOpen]);

    /** 끝까지 봤을 때만 기록을 남긴다 */
    const handleAutoMatchGuideComplete = useCallback(() => {
        setAutoMatchGuideOpen(false);
        if (currentUser) markTutorialSeen(currentUser.id, AUTOMATCH_GUIDE_KEY, { remote: !currentUser.isGhostAdmin });
    }, [currentUser]);
    /** 중간에 닫으면 기록을 남기지 않는다 → 다음 접속 때 다시 뜬다 */
    const handleAutoMatchGuideDismiss = useCallback(() => setAutoMatchGuideOpen(false), []);
    const handleReplayAutoMatchGuide = useCallback(() => {
        autoMatchGuideTriedRef.current = true;
        setModal({ type: null, data: null });
        setIsSettingsOpen(false);
        setIsRosterOpen(false);
        setAutoMatchGuideOpen(true);
    }, [setModal, setIsSettingsOpen, setIsRosterOpen]);

    // 관리자 권한을 받은 뒤 첫 1회 / 일반 선수 첫 입장 1회 자동 실행
    useEffect(() => {
        if (isLoading || !currentUser || isInAppBrowser) return undefined;
        if (tutorial || tutorialAutoTriedRef.current) return undefined;
        if (seasonModalPending || modal?.type || isSettingsOpen || isRosterOpen) return undefined;
        if (autoMatchGuideOpen || (isAdmin && !hasSeenAutoMatchGuide)) return undefined;
        const seen = { ...readLocalTutorialSeen(currentUser.id), ...(currentUser.tutorialSeen || {}) };
        const mode = isAdmin ? (seen.admin ? null : 'admin') : (seen.user ? null : 'user');
        if (!mode) return undefined;
        const timer = setTimeout(() => { tutorialAutoTriedRef.current = true; setTutorial({ mode, phase: 'intro', step: 0 }); }, 700);
        return () => clearTimeout(timer);
    }, [isLoading, currentUser, isAdmin, isInAppBrowser, tutorial, seasonModalPending, modal,
        isSettingsOpen, isRosterOpen, autoMatchGuideOpen, hasSeenAutoMatchGuide]);

    // 환경에 없는 단계(모바일 전용 등)·경기 방식에 맞지 않는 단계는 걸러낸다
    const tutorialSteps = useMemo(() => {
        if (!tutorial) return [];
        const raw = tutorial.mode === 'admin' ? TUTORIAL_ADMIN_STEPS : TUTORIAL_USER_STEPS;
        return raw
            .filter((s) => !s.only || (s.only === 'mobile' ? isMobile : !isMobile))
            .filter((s) => !s.mode || (s.mode === 'team') === teamMode);
    }, [tutorial, isMobile, teamMode]);

    // 각 단계가 요구하는 화면(설정창·명단창·프로필 메뉴·모바일 탭)을 열어준다
    const prepareTutorialStep = useCallback((step) => {
        const surface = step?.surface || 'main';
        setIsProfileMenuOpen(surface === 'menu');
        setIsSettingsOpen(surface === 'settings' || surface === 'roster');
        setIsRosterOpen(surface === 'roster');
        if (step?.tab && isMobile) setActiveTab(step.tab);
    }, [isMobile, setIsProfileMenuOpen, setIsSettingsOpen, setIsRosterOpen, setActiveTab]);

    const finishTutorial = useCallback((mode) => {
        setTutorial(null);
        setIsProfileMenuOpen(false);
        setIsSettingsOpen(false);
        setIsRosterOpen(false);
        setActiveTab('matching');
        if (currentUser) markTutorialSeen(currentUser.id, mode, { remote: !currentUser.isGhostAdmin });
    }, [currentUser, setIsProfileMenuOpen, setIsSettingsOpen, setIsRosterOpen, setActiveTab]);

    const handleTutorialNext = useCallback(() => {
        if (!tutorial) return;
        if (tutorial.step >= tutorialSteps.length - 1) { finishTutorial(tutorial.mode); return; }
        setTutorial({ ...tutorial, step: tutorial.step + 1 });
    }, [tutorial, tutorialSteps.length, finishTutorial]);
    const handleTutorialPrev = useCallback(() => setTutorial((t) => (t ? { ...t, step: Math.max(0, t.step - 1) } : t)), []);
    const handleReplayTutorial = useCallback(() => {
        tutorialAutoTriedRef.current = true;
        setModal({ type: null, data: null });
        setIsSettingsOpen(false);
        setIsRosterOpen(false);
        setTutorial({ mode: isAdmin ? 'admin' : 'user', phase: 'intro', step: 0 });
    }, [isAdmin, setModal, setIsSettingsOpen, setIsRosterOpen]);
    const startTutorialRun = useCallback(() => setTutorial((t) => (t ? { ...t, phase: 'run', step: 0 } : t)), []);

    return {
        tutorial, tutorialSteps, prepareTutorialStep, finishTutorial, handleTutorialNext, handleTutorialPrev,
        handleReplayTutorial, startTutorialRun,
        autoMatchGuideOpen, hasSeenAutoMatchGuide, handleAutoMatchGuideComplete, handleAutoMatchGuideDismiss, handleReplayAutoMatchGuide,
    };
}
