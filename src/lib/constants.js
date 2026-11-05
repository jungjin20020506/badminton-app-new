// ===================================================================================
// [상수] 앱 전체에서 쓰는 급수·성별·저장소 키·시간 상수 한곳 모음
// -----------------------------------------------------------------------------------
// 흩어져 있던 문자열 리터럴("badminton-currentUser-id" 등)이 두 곳에서 서로 다르게
// 적히는 사고를 막기 위해 여기서만 정의한다. (팀 상수는 helpers.js — 로직과 함께)
// ===================================================================================

/** 일반 모드 급수 (명단·게스트 입장에서 고를 수 있는 것) */
export const LEVELS = ['A조', 'B조', 'C조', 'D조'];
/** 청백전 급수 (S조는 청백전 입장 화면에서만) */
export const TEAM_LEVELS = ['S조', 'A조', 'B조', 'C조', 'D조'];

export const GENDER_MALE = '남';
export const GENDER_FEMALE = '여';
export const MIXED = '혼복';

/** 유령 관리자 — 이 이름으로 입장하면 선수 카드 없이 관리자 기능만 쓴다 */
export const GHOST_ADMIN_NAME = '관리자';

/** 브라우저 저장소 키 (localStorage / sessionStorage) */
export const STORAGE_KEYS = {
    currentUserId: 'badminton-currentUser-id',   // localStorage · 로그인 세션(선수 id)
    ghostAdmin: 'badminton-ghost-admin',         // localStorage · '1'이면 유령 관리자
    soundEnabled: 'cox-sound-enabled',           // localStorage · 'on' / 'off'
    theme: 'cox-theme',                          // localStorage · 'dark' / 'light' / 'auto'
    inAppSkip: 'coxstar-inapp-skip',             // sessionStorage · '1'이면 인앱 안내 통과
    updateAttempt: 'cox-update-attempt',         // localStorage · 자동 새로고침 시도 기록
    seenSeasonPrefix: 'seen-',                   // localStorage · `seen-${seasonId}` 공지 오늘 그만 보기
    teamRankOpen: 'cox-team-rank-open',          // localStorage · 순위 패널 접힘/펼침
};

/** 시간 상수 (ms) */
export const TIMING = {
    presenceIntervalMs: 70 * 1000,     // 접속 하트비트 주기
    presenceFreshMs: 3 * 60 * 1000,    // 이 안에 하트비트가 있으면 '접속 중'
    cardLongPressMs: 1000,             // 선수 카드 길게 누르기
    rowLongPressMs: 800,               // 경기 번호·코트·점수판 길게 누르기
    dailyCheckMs: 60 * 1000,           // 새벽 초기화·소모임 동기화 확인 주기
    reconnectAfterHiddenMs: 15 * 1000, // 이만큼 나갔다 오면 Firestore 재연결
    restDefaultMin: 10,                // [휴식 타이머] 기본 휴식 시간(분)
    restStepMin: 5,                    // [휴식 타이머] +/- 단위(분)
    restMaxMin: 60,                    // [휴식 타이머] 최대(분)
};

/** 운영 시각 (KST) */
export const KST = {
    dailyResetHour: 2,   // 새벽 2시 — 하루 초기화 기준
    autoSyncHour: 18,    // 오후 6시 — 소모임 자동 동기화
};
