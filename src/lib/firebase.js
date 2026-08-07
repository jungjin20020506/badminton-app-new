import { initializeApp } from 'firebase/app';
import {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    disableNetwork, enableNetwork,
    collection, doc, onSnapshot, query, where, getDocs, getDoc, writeBatch, runTransaction, setDoc,
    addDoc, serverTimestamp, deleteField,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAdminNames, setAdminNamesCache, generateId, filterTodayGames } from './helpers';

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
  appId: "1:384562806148:web:d8bfb83b28928c13e671d1"
};

const app = initializeApp(firebaseConfig);
// ============ [실시간 안정화] Firestore 초기화 ============
// · experimentalAutoDetectLongPolling: WebChannel 스트림이 막히는 통신사/사내망/인앱
//   환경에서 long-polling으로 자동 전환해 실시간 수신이 끊기지 않게 한다.
// · persistentLocalCache + MultipleTabManager: 예전 enableIndexedDbPersistence는
//   두 번째 탭에서 실패(failed-precondition)했지만, 이제 여러 탭이 캐시를 공유한다.
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalAutoDetectLongPolling: true,
});
const storage = getStorage(app); // Storage 초기화

// ============ [실시간 안정화] 연결 감시자 (Reconnect Watchdog) ============
// 폰 화면을 껐다 켜거나, Wi-Fi↔LTE가 바뀌면 Firestore 스트림이 조용히 죽어서
// "서버엔 반영됐는데 내 화면은 새로고침해야 바뀌는" 증상이 생긴다.
// 화면 복귀/네트워크 복구 순간에 연결을 강제로 새로 맺어 즉시 최신 상태를 받아온다.
let lastHiddenAt = 0;
let reconnectInFlight = false;
const forceReconnect = async (reason) => {
    if (reconnectInFlight) return;
    reconnectInFlight = true;
    try {
        await disableNetwork(db);
        await enableNetwork(db);
        console.log('[실시간] 연결 재수립:', reason);
    } catch (e) {
        console.error('[실시간] 재연결 실패:', e);
    } finally {
        reconnectInFlight = false;
    }
};
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { lastHiddenAt = Date.now(); return; }
    // 잠깐 앱 전환(15초 미만)은 그대로 두고, 오래 나갔다 왔을 때만 새로 연결
    if (lastHiddenAt && Date.now() - lastHiddenAt > 15 * 1000) forceReconnect('화면 복귀');
});
window.addEventListener('online', () => forceReconnect('네트워크 복구'));
window.addEventListener('pageshow', (e) => { if (e.persisted) forceReconnect('뒤로가기 복귀'); });
// ==========================================================

const playersRef = collection(db, "players");
const gameStateRef = doc(db, "gameState", "live");
const configRef = doc(db, "config", "season");
const monthlyRankingsRef = collection(db, "monthlyRankings");
const notificationsRef = collection(db, "notifications");
// [선수 명단] 모임 회원 명단(이름/급수/성별/소모임ID) — 관리자 설정 > 선수 정보 관리에서 편집
const rosterRef = collection(db, "roster");
// [소모임 동기화] 자동/수동 동기화 상태 기록 (실패 시 배너 표시용)
const somoimSyncRef = doc(db, "config", "somoimSync");
// [실시간 생명감] 접속 표시(하트비트 맵: {playerId: epoch ms}) — 단일 문서로 관리
const presenceRef = doc(db, "config", "presence");
// [감사 로그] 전체 내보내기·새벽 초기화 등 위험한 작업의 실행 기록
const logsRef = collection(db, "logs");
// [시계 오류 방어] 서버 시간 확인용 문서
const clockCheckRef = doc(db, "config", "clockCheck");

// ===================================================================================
// [감사 로그] 누가 · 언제 · 무엇을 했는지 Firestore logs 컬렉션에 남긴다.
// Firebase 콘솔 > Firestore Database > logs 에서 최근 기록을 확인할 수 있다.
// ===================================================================================
const writeAuditLog = async (action, detail = {}) => {
    try {
        await addDoc(logsRef, {
            action,                                                        // 무엇을 (예: '전체내보내기')
            detail,                                                        // 부가 정보 (누가, 몇 명 등)
            byPlayerId: localStorage.getItem('badminton-currentUser-id') || null, // 이 기기로 입장한 선수 ID
            userAgent: navigator.userAgent,                                // 기기/브라우저 정보
            at: serverTimestamp(),                                         // 서버 기준 시각 (조작 불가)
            atLocal: new Date().toISOString(),                             // 그 기기의 시계 (틀린 시계 탐지용)
        });
    } catch (e) {
        console.error('[감사 로그] 기록 실패:', e);
    }
};

// ===================================================================================
// [시계 오류 방어] 기기 시계를 믿지 않고 Firebase 서버 시간을 얻는다.
// serverTimestamp()를 한 번 기록했다가 읽어서 "서버시간 - 내시계" 오차를 계산해 두고,
// 이후로는 오차를 보정한 시간을 쓴다. (오프라인이면 실패 → 초기화가 실행되지 않아 안전)
// ===================================================================================
let serverClockOffsetMs = null;
const getServerNow = async () => {
    if (serverClockOffsetMs === null) {
        await setDoc(clockCheckRef, { at: serverTimestamp() });
        const snap = await getDoc(clockCheckRef);
        const at = snap.data()?.at;
        if (!at || typeof at.toDate !== 'function') throw new Error('서버 시간을 확인하지 못했습니다.');
        serverClockOffsetMs = at.toDate().getTime() - Date.now();
        const offsetMin = Math.round(serverClockOffsetMs / 60000);
        if (Math.abs(offsetMin) >= 10) console.warn(`[시계 오류 방어] 이 기기의 시계가 서버와 약 ${offsetMin}분 차이납니다.`);
    }
    return new Date(Date.now() + serverClockOffsetMs);
};


// --- 2. Service 로직 ---
let allPlayersData = {};
let gameStateData = null;
let seasonConfigData = null;
let rosterData = {};
let somoimSyncData = null;
let presenceData = {};
const subscribers = new Set();

let resolveAllPlayers, resolveGameState, resolveSeasonConfig, resolveRoster;
const allPlayersPromise = new Promise(resolve => { resolveAllPlayers = resolve; });
const gameStatePromise = new Promise(resolve => { resolveGameState = resolve; });
const seasonConfigPromise = new Promise(resolve => { resolveSeasonConfig = resolve; });
const rosterPromise = new Promise(resolve => { resolveRoster = resolve; });
const readyPromise = Promise.all([allPlayersPromise, gameStatePromise, seasonConfigPromise, rosterPromise]);

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
        autoMatches: {}, // 자동 매칭 데이터 추가
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
            pointSystemInfo: "- 참석: +20 RP (3경기 완료시)\n- 승리: +30 RP\n- 패배: +10 RP\n- 3연승 보너스: +20 RP",
            // [자동매칭] 기본 설정값 (민감도 프리셋 — ON/OFF 없이 '매칭 만들기' 버튼으로 생성)
            autoMatchConfig: {
                sensitivity: 'normal',
                perGenderSensitivity: false,
                maleSensitivity: 'normal',
                femaleSensitivity: 'normal'
            }
        };
    }
    // [자동매칭] 기존 설정에 autoMatchConfig가 없으면 기본값 병합
if (seasonConfigData && !seasonConfigData.autoMatchConfig) {
    seasonConfigData.autoMatchConfig = {
        sensitivity: 'normal',
        perGenderSensitivity: false,
        maleSensitivity: 'normal',
        femaleSensitivity: 'normal'
    };
}

    // [관리자 권한] 관리자 목록 캐시 갱신 (PlayerCard의 👑 표시 등에서 사용)
    setAdminNamesCache(getAdminNames(seasonConfigData));

    if(resolveSeasonConfig) { resolveSeasonConfig(); resolveSeasonConfig = null; }
    notifySubscribers();
});

// [선수 명단] 명단 리스너 — 읽기 실패(보안 규칙 등)해도 앱 로딩이 멈추지 않도록
// 오류 시에도 resolve 한다. (명단이 비면 일반 선수 입장이 막히고 안내가 뜬다)
onSnapshot(rosterRef, (snapshot) => {
    const roster = {};
    snapshot.forEach(d => roster[d.id] = d.data());
    rosterData = roster;
    if (resolveRoster) { resolveRoster(); resolveRoster = null; }
    notifySubscribers();
}, (error) => {
    console.error("[선수 명단] 로딩 실패:", error);
    if (resolveRoster) { resolveRoster(); resolveRoster = null; }
});

// [소모임 동기화] 동기화 상태 리스너 (실패 배너/결과 표시용, 로딩은 막지 않음)
onSnapshot(somoimSyncRef, (d) => {
    somoimSyncData = d.exists() ? d.data() : null;
    notifySubscribers();
}, (error) => {
    console.error("[소모임 동기화] 상태 로딩 실패:", error);
});

// [실시간 생명감] 접속 표시 리스너 (로딩을 막지 않음)
onSnapshot(presenceRef, (d) => {
    presenceData = d.exists() ? d.data() : {};
    notifySubscribers();
}, (error) => {
    console.error("[접속 표시] 로딩 실패:", error);
});

function notifySubscribers() {
  subscribers.forEach(callback => callback());
}

// --- 4. Service 객체 ---
const firebaseService = {
  getAllPlayers: () => allPlayersData,
  getGameState: () => gameStateData,
  getSeasonConfig: () => seasonConfigData,
  getRoster: () => rosterData,
  getSomoimSync: () => somoimSyncData,
  getPresence: () => presenceData,
  subscribe: (callback) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  },
};

// ===================================================================================
// [실시간 생명감] 접속 하트비트 / 라이브 리액션
// -----------------------------------------------------------------------------------
// · 하트비트: 접속 중인 선수가 70초마다 자기 필드에 현재 시각을 기록한다.
//   화면이 백그라운드면 쉬고, 복귀하면 즉시 1회 기록. 나가면 자기 필드를 지운다.
//   "접속 중" 판정은 마지막 기록이 3분 이내인지로 한다(수신 측 계산).
// · 리액션: 마지막 리액션 1건을 덮어쓰는 브로드캐스트. nonce로 중복 재생을 막는다.
// ===================================================================================
const PRESENCE_INTERVAL_MS = 70 * 1000;
const PRESENCE_FRESH_MS = 3 * 60 * 1000;

const isPresenceFresh = (at) => typeof at === 'number' && (Date.now() - at) < PRESENCE_FRESH_MS;

function startPresenceHeartbeat(playerId) {
    if (!playerId) return () => {};
    let stopped = false;
    const beat = () => {
        if (stopped || document.visibilityState === 'hidden') return;
        setDoc(presenceRef, { [playerId]: Date.now() }, { merge: true })
            .catch((e) => console.error('[접속 표시] 하트비트 실패:', e));
    };
    beat();
    const timer = setInterval(beat, PRESENCE_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
        stopped = true;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
        // 나갈 때 내 필드 제거 (실패해도 3분 뒤 자연 만료)
        setDoc(presenceRef, { [playerId]: deleteField() }, { merge: true }).catch(() => {});
    };
}

// ===================================================================================
// [새벽 2시 자동 초기화] 클라이언트 측 구현
// -----------------------------------------------------------------------------------
// 기존에는 Firebase Cloud Function(dailyRoomCleanup)으로만 처리했으나, 배포를 Vercel
// (프론트엔드)에서만 하는 환경에서는 Functions가 배포되지 않아 새벽 2시 초기화가
// 동작하지 않았다. 그래서 앱이 열려 있는 동안 클라이언트가 직접 초기화를 수행한다.
//   - 모든 선수(접속/미접속 포함) 현황판에서 내보내기(status:'inactive')
//   - 모든 선수의 일일 경기기록/게임 수 삭제(승/패/연승/누구와 경기했는지 전부)
//   - 경기진행/경기예정/자동매칭(경기방) 비우기
// Firestore 트랜잭션으로 '운영일 키'를 선점하여, 여러 기기가 동시에 접속해 있어도
// 단 하나의 클라이언트만 초기화를 실행한다.
// ===================================================================================

// 새벽 2시(KST)를 하루의 경계로 보는 '운영일 키'(YYYY-MM-DD)를 만든다.
// UTC 시각에 +7시간(KST +9시간에서 초기화 기준 2시를 빼면 +7시간) 한 뒤 날짜를 취하면,
// 새벽 2시 이전이면 전날, 이후면 당일 날짜가 자연스럽게 나온다.
const getDailyResetKey = (now = new Date()) => {
    const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

let dailyResetInFlight = false;

// 운영일이 바뀌었는데 아직 초기화 기록이 없으면 초기화를 수행한다.
const runDailyResetIfDue = async () => {
    if (dailyResetInFlight) return;

    // 빠른 사전 확인(기기 시계 기준): 이미 오늘 초기화가 끝났으면 아무것도 하지 않는다.
    if (gameStateData && gameStateData.lastDailyResetKey === getDailyResetKey()) return;

    dailyResetInFlight = true;
    try {
        // [시계 오류 방어] 기기 시계가 틀린 폰(날짜가 하루 빠르거나 느린 폰)이 접속만 해도
        // 한낮에 전체 초기화가 터지던 버그 수정 — 날짜 판정은 반드시 '서버 시간'으로 한다.
        const serverNow = await getServerNow();
        const todayKey = getDailyResetKey(serverNow);
        if (gameStateData && gameStateData.lastDailyResetKey === todayKey) return;

        // 1) 트랜잭션으로 '운영일 키'를 선점 + 경기방(경기진행/예정/자동매칭) 비우기.
        //    이미 다른 기기가 처리했다면 won=false로 빠져나간다.
        const won = await runTransaction(db, async (tx) => {
            const gsSnap = await tx.get(gameStateRef);
            const gs = gsSnap.exists() ? gsSnap.data() : {};
            // 저장된 키보다 '뒤 날짜'로 넘어갈 때만 초기화한다. 같거나 과거 날짜면 무시 —
            // 잘못된 키가 저장돼 있어도 기기들끼리 초기화를 주고받는 핑퐁이 생기지 않는다.
            if (gs.lastDailyResetKey && gs.lastDailyResetKey >= todayKey) return false;
            const numCourts = gs.numInProgressCourts || 4;
            tx.set(gameStateRef, {
                lastDailyResetKey: todayKey,
                inProgressCourts: Array(numCourts).fill(null),
                scheduledMatches: {},
                autoMatches: {},
            }, { merge: true });
            return true;
        });
        if (!won) return;

        // 2) 모든 선수(접속/미접속 포함) 일일 기록 삭제 + 현황판에서 내보내기.
        //    getDocs로 전체를 가져오므로 나가 있는(inactive) 선수의 히스토리도 함께 삭제된다.
        const snapshot = await getDocs(playersRef);
        let batch = writeBatch(db);
        let count = 0;
        for (const playerDoc of snapshot.docs) {
            batch.update(playerDoc.ref, {
                status: 'inactive',     // 현황판에서 완전히 내보내기
                isResting: false,       // 휴식 상태 해제
                todayWins: 0,
                todayLosses: 0,
                todayWinStreakCount: 0,
                todayRecentGames: [],   // 누구와 몇 게임 했는지 기록 전부 삭제
            });
            count++;
            // Firestore batch 제한(500개)을 피하기 위해 400개 단위로 분할 처리
            if (count % 400 === 0) {
                await batch.commit();
                batch = writeBatch(db);
            }
        }
        if (count % 400 !== 0) await batch.commit();

        console.log(`[새벽 2시 초기화] ${todayKey} 기준 ${count}명 선수 기록 삭제 및 내보내기 완료`);
        writeAuditLog('새벽초기화', { key: todayKey, count });
    } catch (e) {
        console.error("[새벽 2시 초기화] 실패:", e);
    } finally {
        dailyResetInFlight = false;
    }
};

// ===================================================================================
// [선수 명단] 모임 회원 기본 명단 (사진 명단 기준)
// -----------------------------------------------------------------------------------
// 급수는 명단 사진 그대로. 성별은 소모임 데이터에 없어 이름으로 추정한 값이므로
// 관리자 설정 > 선수 정보 관리에서 반드시 확인/수정해야 한다.
// '방승환'은 사진에 '빙승환'으로 적혀 있으나 소모임 실명 기준으로 등록.
// ===================================================================================
const ROSTER_SEED = [
    { name: '정형진', level: 'A조', gender: '남' }, { name: '나채빈', level: 'A조', gender: '여' },
    { name: '오미리', level: 'A조', gender: '여' }, { name: '윤지혜', level: 'B조', gender: '여' },
    { name: '이정문', level: 'A조', gender: '남' }, { name: '고지선', level: 'C조', gender: '여' },
    { name: '공태호', level: 'C조', gender: '남' }, { name: '권지수', level: 'C조', gender: '여' },
    { name: '김다은', level: 'C조', gender: '여' }, { name: '김도현', level: 'B조', gender: '남' },
    { name: '김동균', level: 'B조', gender: '남' }, { name: '김민경', level: 'A조', gender: '여' },
    { name: '김민수', level: 'A조', gender: '남' }, { name: '김시내', level: 'B조', gender: '여' },
    { name: '김이령', level: 'B조', gender: '여' }, { name: '김재환', level: 'A조', gender: '남' },
    { name: '김호진', level: 'C조', gender: '남' }, { name: '김환교', level: 'B조', gender: '남' },
    { name: '도현석', level: 'A조', gender: '남' }, { name: '박민재', level: 'B조', gender: '남' },
    { name: '박소현', level: 'B조', gender: '여' }, { name: '박영인', level: 'B조', gender: '남' },
    { name: '박은진', level: 'B조', gender: '여' }, { name: '박지훈', level: 'C조', gender: '남' },
    { name: '박현규', level: 'A조', gender: '남' }, { name: '방승환', level: 'B조', gender: '남' },
    { name: '서소망', level: 'A조', gender: '여' }, { name: '서한일', level: 'A조', gender: '남' },
    { name: '손선의', level: 'A조', gender: '여' }, { name: '신환종', level: 'A조', gender: '남' },
    { name: '심예린', level: 'A조', gender: '여' }, { name: '윤다혜', level: 'A조', gender: '여' },
    { name: '윤주혁', level: 'B조', gender: '남' }, { name: '이동준', level: 'C조', gender: '남' },
    { name: '이미연', level: 'B조', gender: '여' }, { name: '이슬', level: 'B조', gender: '여' },
    { name: '이윤성', level: 'C조', gender: '남' }, { name: '인치원', level: 'A조', gender: '남' },
    { name: '임다혜', level: 'A조', gender: '여' }, { name: '장호성', level: 'B조', gender: '남' },
    { name: '정상운', level: 'B조', gender: '남' }, { name: '정훈성', level: 'A조', gender: '남' },
    { name: '조현빈', level: 'C조', gender: '남' }, { name: '조현철', level: 'B조', gender: '남' },
    { name: '주재운', level: 'A조', gender: '남' }, { name: '진서원', level: 'B조', gender: '여' },
    { name: '최나라', level: 'C조', gender: '여' }, { name: '한승찬', level: 'B조', gender: '남' },
    { name: '한영록', level: 'A조', gender: '남' },
];

// ===================================================================================
// [소모임 동기화] 정모 참석자 → 선수카드 자동 생성
// -----------------------------------------------------------------------------------
// 브라우저는 CORS 때문에 소모임을 직접 읽을 수 없으므로 /api/somoim (Vercel
// serverless function)을 경유한다. 응답의 정모 목록에서 "오늘(KST)" 날짜의 정모를
// 찾아, 참석(ijo=Y)한 멤버를 명단(roster)과 매칭해 선수카드를 생성/활성화한다.
//   - 매칭 우선순위: 소모임 고유ID(somoimMid) → 실명. 이름으로 처음 매칭되면
//     somoimMid를 명단에 자동 저장해 이후 동명이인/개명에 대비한다.
//   - 명단에 없는 참석자는 카드를 만들지 않고 관리자에게 목록으로 보여준다.
//     (급수/성별을 알 수 없는 카드가 임의로 생기는 것 방지)
//   - 실패 시 절대 조용히 넘어가지 않고 오류코드를 남긴다. (동기화 실패 배너)
// ===================================================================================

// KST 기준 현재 시각 정보 (정모 날짜 비교는 '실제 날짜' 기준 — 새벽 2시 경계와 무관)
const getKstParts = (now = new Date()) => {
    const s = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return {
        dateNumber: s.getUTCFullYear() * 10000 + (s.getUTCMonth() + 1) * 100 + s.getUTCDate(), // YYYYMMDD
        dateKey: `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}-${String(s.getUTCDate()).padStart(2, '0')}`,
        hour: s.getUTCHours(),
    };
};

class SomoimSyncError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code;
    }
}

// 소모임 API 호출 (실패 시 SomoimSyncError)
const fetchSomoimData = async () => {
    let resp, json;
    try {
        resp = await fetch('/api/somoim', { cache: 'no-store' });
    } catch (e) {
        throw new SomoimSyncError('NETWORK', '동기화 서버에 접속하지 못했습니다.');
    }
    try {
        json = await resp.json();
    } catch (e) {
        throw new SomoimSyncError('BAD_RESPONSE', '동기화 서버 응답을 해석하지 못했습니다.');
    }
    if (!resp.ok || !json.ok) {
        throw new SomoimSyncError(json.code || `HTTP_${resp.status}`, json.message || '소모임 데이터를 가져오지 못했습니다.');
    }
    if (!Array.isArray(json.members) || json.members.length === 0) {
        throw new SomoimSyncError('EMPTY_MEMBERS', '소모임 멤버 목록이 비어 있습니다.');
    }
    return json;
};

/**
 * [소모임 동기화] 핵심 실행 함수. 오늘 정모 참석자를 선수카드로 생성/활성화한다.
 * @returns {Promise<object>} 결과 요약 { noEvent, events, created, activated, already, unmatched }
 * @throws {SomoimSyncError}
 */
const syncSomoimAttendees = async () => {
    const data = await fetchSomoimData();
    const { dateNumber } = getKstParts();

    // 1) 오늘 날짜의 정모 찾기 (정모는 매주 새로 생기고 이름/차수가 바뀌므로 날짜로만 판단)
    const todayEvents = (data.events || []).filter(e => e && e.date === dateNumber);
    if (todayEvents.length === 0) {
        return { noEvent: true, events: [], created: [], activated: [], already: [], unmatched: [] };
    }

    // 2) 오늘 정모(복수 가능)에 하나라도 참석(Y)한 멤버 수집 (강퇴/차단 멤버 제외)
    const attendees = data.members.filter(m =>
        !m.banned && todayEvents.some(ev => m.attend && m.attend[ev.slot - 1])
    );

    // 3) 명단(roster) 매칭 — somoimMid 우선, 없으면 실명
    const roster = firebaseService.getRoster() || {};
    const rosterList = Object.values(roster);
    if (rosterList.length === 0) {
        throw new SomoimSyncError('ROSTER_EMPTY', '선수 명단이 비어 있습니다. 관리자 설정 > 선수 정보 관리에서 명단을 먼저 등록해주세요.');
    }
    const byMid = {};
    const byName = {};
    rosterList.forEach(r => {
        if (r.somoimMid) byMid[r.somoimMid] = r;
        if (r.name) byName[r.name] = r;
    });

    const created = [], activated = [], already = [], unmatched = [];
    const batch = writeBatch(db);
    const currentPlayers = firebaseService.getAllPlayers() || {};

    for (const att of attendees) {
        const rosterEntry = byMid[att.mid] || byName[att.name];
        if (!rosterEntry || !rosterEntry.level || !rosterEntry.gender) {
            unmatched.push(att.name);
            continue;
        }
        // (수동으로 콘솔에서 만든 문서 등) id 필드가 없어도 동작하도록 보정
        const rosterId = rosterEntry.id || generateId(rosterEntry.name);
        // 이름으로 처음 매칭된 경우 소모임 고유ID를 명단에 기록 (다음부터는 ID로 매칭)
        if (!rosterEntry.somoimMid) {
            batch.set(doc(rosterRef, rosterId), { id: rosterId, somoimMid: att.mid }, { merge: true });
        }

        const playerId = rosterId; // roster id == generateId(name) == players id
        const existing = currentPlayers[playerId];
        if (existing && existing.status === 'active') {
            already.push(rosterEntry.name);
            continue; // 이미 입장해 있는 선수는 건드리지 않는다 (경기중/기록 보호)
        }
        const playerData = {
            id: playerId,
            name: rosterEntry.name,
            level: rosterEntry.level,
            gender: rosterEntry.gender,
            isGuest: false,
            status: 'active',
            isResting: false,
            entryTime: new Date().toISOString(),
            todayRecentGames: filterTodayGames(existing?.todayRecentGames),
        };
        batch.set(doc(playersRef, playerId), playerData, { merge: true });
        (existing ? activated : created).push(rosterEntry.name);
    }

    await batch.commit();
    return {
        noEvent: false,
        events: todayEvents.map(e => ({ name: e.name, time: e.time, place: e.place })),
        created, activated, already, unmatched,
    };
};

// [소모임 동기화] 18시 자동 동기화 — 여러 기기가 켜져 있어도 트랜잭션으로 딱 한 대만
// 실행한다. 실패 시 10분 간격으로 최대 3회 재시도하고, 그래도 실패하면 오류 배너를 띄운다.
let autoSyncInFlight = false;
const AUTO_SYNC_HOUR = 18; // KST 18시(오후 6시)부터
const AUTO_SYNC_MAX_ATTEMPTS = 3;

const runAutoSomoimSyncIfDue = async () => {
    if (autoSyncInFlight) return;
    const { dateKey, hour } = getKstParts();
    if (hour < AUTO_SYNC_HOUR) return;

    // 빠른 사전 확인 (리스너 캐시 기준) — 끝난 날이면 트랜잭션 시도조차 하지 않음
    const cached = firebaseService.getSomoimSync();
    const cachedAuto = cached?.auto;
    if (cachedAuto?.key === dateKey && (
        cachedAuto.status === 'done' || cachedAuto.status === 'no-event' ||
        (cachedAuto.status === 'error' && (cachedAuto.attempts || 0) >= AUTO_SYNC_MAX_ATTEMPTS)
    )) return;

    autoSyncInFlight = true;
    try {
        const nowIso = new Date().toISOString();
        // 1) 실행권 선점 트랜잭션
        const won = await runTransaction(db, async (tx) => {
            const snap = await tx.get(somoimSyncRef);
            const a = (snap.exists() ? snap.data().auto : null) || {};
            if (a.key === dateKey) {
                if (a.status === 'done' || a.status === 'no-event') return false;
                if (a.status === 'error' && (a.attempts || 0) >= AUTO_SYNC_MAX_ATTEMPTS) return false;
                // 다른 기기가 5분 내에 실행 중이면 양보
                if (a.status === 'running' && a.startedAt && (Date.now() - new Date(a.startedAt).getTime()) < 5 * 60 * 1000) return false;
                // 직전 실패 후 10분은 기다렸다가 재시도
                if (a.status === 'error' && a.lastAttemptAt && (Date.now() - new Date(a.lastAttemptAt).getTime()) < 10 * 60 * 1000) return false;
            }
            const attempts = a.key === dateKey ? (a.attempts || 0) + 1 : 1;
            tx.set(somoimSyncRef, {
                auto: { key: dateKey, status: 'running', attempts, startedAt: nowIso, lastAttemptAt: nowIso }
            }, { merge: true });
            return true;
        });
        if (!won) return;

        // 2) 실제 동기화 수행 → 결과/오류 기록
        try {
            const result = await syncSomoimAttendees();
            await setDoc(somoimSyncRef, {
                auto: {
                    key: dateKey,
                    status: result.noEvent ? 'no-event' : 'done',
                    finishedAt: new Date().toISOString(),
                },
                lastResult: { ...result, at: new Date().toISOString(), trigger: 'auto' },
                lastError: null,
            }, { merge: true });
            console.log('[소모임 동기화] 자동 동기화 완료:', result);
        } catch (e) {
            const code = e.code || 'UNKNOWN';
            console.error('[소모임 동기화] 자동 동기화 실패:', code, e);
            await setDoc(somoimSyncRef, {
                auto: { key: dateKey, status: 'error', lastAttemptAt: new Date().toISOString() },
                lastError: { at: new Date().toISOString(), code, message: e.message || '', trigger: 'auto', dateKey },
            }, { merge: true }).catch(err => console.error('[소모임 동기화] 오류 기록 실패:', err));
        }
    } catch (e) {
        console.error('[소모임 동기화] 자동 동기화 준비 실패:', e);
    } finally {
        autoSyncInFlight = false;
    }
};


export {
    db, storage,
    playersRef, gameStateRef, configRef, monthlyRankingsRef, notificationsRef, rosterRef, somoimSyncRef,
    firebaseService, readyPromise,
    runDailyResetIfDue, runAutoSomoimSyncIfDue, syncSomoimAttendees, getKstParts, ROSTER_SEED,
    forceReconnect,
    startPresenceHeartbeat, isPresenceFresh,
    writeAuditLog,
};