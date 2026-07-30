import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    doc, getDoc, setDoc, onSnapshot,
    collection, deleteDoc, updateDoc, writeBatch, runTransaction,
    query, getDocs, where,
    disableNetwork, enableNetwork
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"; // Storage 임포트 추가
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

// ===================================================================================
// [관리자 권한] 관리자 이름 목록
// -----------------------------------------------------------------------------------
// 예전에는 코드에 이름을 박아두어 관리자를 바꾸려면 배포를 다시 해야 했다.
// 이제는 config/season 문서의 adminNames 배열이 기준이며,
// 설정 ▸ 👑 관리자 권한 에서 관리자가 직접 부여/해임할 수 있다.
// (adminNames가 아직 없는 기존 모임은 아래 기본 관리자가 그대로 적용된다)
// ===================================================================================
const DEFAULT_ADMIN_NAMES = ["나채빈", "정형진", "윤지혜", "이상민", "이정문", "오미리"];

/**
 * [관리자 권한] 현재 관리자 이름 목록을 구한다.
 * 실수로 빈 배열이 저장돼 아무도 관리자가 아니게 되는 사고를 막기 위해 빈 배열은 무시한다.
 * @param {object} seasonConfig - config/season 문서 데이터
 * @returns {Array<string>} 관리자 이름 배열
 */
function getAdminNames(seasonConfig) {
    const list = seasonConfig?.adminNames;
    if (Array.isArray(list) && list.length > 0) return list;
    return DEFAULT_ADMIN_NAMES;
}

// [관리자 권한] seasonConfig를 props로 받지 않는 곳(PlayerCard의 👑 아이콘 등)에서 쓰는 캐시.
// config 스냅샷이 올 때마다 갱신된다.
let adminNamesCache = DEFAULT_ADMIN_NAMES;
const isAdminName = (name) => adminNamesCache.includes(name);

// --- 2. Service 로직 ---
let allPlayersData = {};
let gameStateData = null;
let seasonConfigData = null;
let rosterData = {};
let somoimSyncData = null;
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
    adminNamesCache = getAdminNames(seasonConfigData);

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
  subscribe: (callback) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  },
};

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
    const todayKey = getDailyResetKey();

    // 빠른 사전 확인: 이미 오늘 초기화가 끝났으면 트랜잭션조차 시도하지 않는다.
    if (gameStateData && gameStateData.lastDailyResetKey === todayKey) return;

    dailyResetInFlight = true;
    try {
        // 1) 트랜잭션으로 '운영일 키'를 선점 + 경기방(경기진행/예정/자동매칭) 비우기.
        //    이미 다른 기기가 처리했다면 won=false로 빠져나간다.
        const won = await runTransaction(db, async (tx) => {
            const gsSnap = await tx.get(gameStateRef);
            const gs = gsSnap.exists() ? gsSnap.data() : {};
            if (gs.lastDailyResetKey === todayKey) return false;
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

// ===================================================================================
// 자동 매칭 핵심 로직 (Helper Functions)
// ===================================================================================

/**
 * [자동매칭] k-combination (조합) 생성기
 * @param {Array} arr - 선수 배열
 * @param {number} k - 뽑을 인원 (4)
 * @returns {Array<Array>} 모든 4인 조합
 */
function getAllCombinations(arr, k) {
    const result = [];
    if (k > arr.length || k <= 0) return result;
    if (k === arr.length) return [arr];
    if (k === 1) return arr.map(item => [item]);

    function backtrack(startIndex, currentCombo) {
        if (currentCombo.length === k) {
            result.push([...currentCombo]);
            return;
        }
        for (let i = startIndex; i < arr.length; i++) {
            currentCombo.push(arr[i]);
            backtrack(i + 1, currentCombo);
            currentCombo.pop();
        }
    }
    backtrack(0, []);
    return result;
}

/**
 * [자동매칭] 두 선수 간의 최근 경기 기록 확인
 * @param {object} p1 - 선수 1
 * @param {object} p2 - 선수 2
 * @param {Array} p1History - 선수 1의 최근 경기 기록 (p1.todayRecentGames)
 * @returns {{wasPartner: boolean, wasOpponent: boolean, wasRecent: boolean}}
 */
function checkHistory(p1, p2, p1History) {
    let wasPartner = false;
    let wasOpponent = false;
    let wasRecent = true;

    // 최근 5경기만 체크
    const recent5Games = p1History.slice(0, 5);
    if (recent5Games.length === 0) return { wasPartner, wasOpponent, wasRecent: false };

    let foundInRecent5 = false;
    for (const game of recent5Games) {
        if (game.partners.includes(p2.id)) {
            wasPartner = true;
            foundInRecent5 = true;
        }
        if (game.opponents.includes(p2.id)) {
            wasOpponent = true;
            foundInRecent5 = true;
        }
    }
    wasRecent = foundInRecent5;

    // "최근 파트너"와 "최근 상대"는 최근 2경기만 기준으로 함
    const recent2Games = p1History.slice(0, 2);
    wasPartner = recent2Games.some(game => game.partners.includes(p2.id));
    wasOpponent = recent2Games.some(game => game.opponents.includes(p2.id));

    return { wasPartner, wasOpponent, wasRecent };
}

/**
 * [자동매칭] "고인 물" 매치 (4명이 방금 같이 뛴 경기)인지 확인
 * @param {Array<object>} combo - 4인 조합
 * @param {object} allPlayers - 전체 선수 데이터
 * @returns {boolean}
 */
function wasStalePool(combo, allPlayers) {
    if (combo.length !== 4) return false;

    const histories = combo.map(p => allPlayers[p.id]?.todayRecentGames || []);
    const firstGameHistory = histories[0];
    if (!firstGameHistory || firstGameHistory.length === 0) return false;

    const lastGame = firstGameHistory[0];
    const lastGameTimestamp = lastGame.timestamp;
    const lastGamePartners = [combo[0].id, ...lastGame.partners];
    const lastGameOpponents = lastGame.opponents;
    const lastGameAllPlayers = [...lastGamePartners, ...lastGameOpponents];

    // 1. 4명의 선수가 모두 마지막 경기에 포함되어 있는지 확인
    const comboIds = combo.map(p => p.id);
    const allPlayersInLastGame = comboIds.every(id => lastGameAllPlayers.includes(id));
    if (!allPlayersInLastGame) return false;

    // 2. 다른 선수들의 마지막 경기도 동일한 경기인지 (타임스탬프로) 확인
    for (let i = 1; i < 4; i++) {
        const otherHistory = histories[i];
        if (!otherHistory || otherHistory.length === 0 || otherHistory[0].timestamp !== lastGameTimestamp) {
            return false;
        }
    }
    return true;
}

/**
 * [급수 밸런스] 급수를 숫자로 환산 (A조=1 ... D조=4)
 */
const LEVEL_BALANCE_MAP = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 3 };
function getLevelValue(player, allPlayers) {
    const lvl = allPlayers[player.id]?.level || player.level;
    return LEVEL_BALANCE_MAP[lvl] || 3;
}

/**
 * [급수 밸런스] 4인 조합을 2:2 팀으로 나눌 때, 팀 간 급수합 차이가
 * 가장 작아지는 분할(=가장 균형잡힌 팀)을 찾아 반환한다.
 * @returns {{ diff: number, spread: number, order: Array<object> }}
 *  - diff: 두 팀의 급수합 차이 (작을수록 밸런스 좋음)
 *  - spread: 조합 내 최고/최저 급수 차이
 *  - order: 균형잡힌 팀 순서로 재배열된 4인 (slot 0,1 = 팀A / 2,3 = 팀B)
 */
function getBestLevelSplit(combo, allPlayers) {
    if (combo.length !== 4) {
        return { diff: 0, spread: 0, order: combo };
    }
    const v = combo.map(p => getLevelValue(p, allPlayers));
    const splits = [
        [[0, 1], [2, 3]],
        [[0, 2], [1, 3]],
        [[0, 3], [1, 2]],
    ];
    let best = null;
    for (const [t1, t2] of splits) {
        const diff = Math.abs((v[t1[0]] + v[t1[1]]) - (v[t2[0]] + v[t2[1]]));
        if (!best || diff < best.diff) {
            best = { diff, order: [combo[t1[0]], combo[t1[1]], combo[t2[0]], combo[t2[1]]] };
        }
    }
    const spread = Math.max(...v) - Math.min(...v);
    return { diff: best.diff, spread, order: best.order };
}

/**
 * [자동매칭] 4인 조합의 "매치 점수" 계산
 * @param {Array<object>} combo - 4인 조합
 * @param {object} allPlayers - 전체 선수 데이터
 * @param {number} poolAvgGames - 이 풀의 평균 경기 수
 * @param {{now:number, maxGames:number}} [fairnessCtx] - 공평 강화용 컨텍스트(현재시각/최다 경기수)
 * @returns {number} 최종 매치 점수
 */
function calculateMatchScore(combo, allPlayers, poolAvgGames, fairnessCtx) {
    let score = 100;

    // 1. 공평 점수 (경기 수) — 실제 추적되는 todayRecentGames 길이를 사용
    //    (기존 todayWins/Losses는 앱에서 갱신되지 않아 항상 0이었음 → 버그 수정)
    const gamesOf = (p) => (allPlayers[p.id]?.todayRecentGames?.length ?? p.todayRecentGames?.length ?? 0);
    const matchTotalGames = combo.reduce((acc, p) => acc + gamesOf(p), 0);
    const matchAvgGames = matchTotalGames / 4;
    const fairnessScore = (poolAvgGames - matchAvgGames) * 50;
    score += fairnessScore;

    // 2. 조합 점수 (새로운 조합)
    if (wasStalePool(combo, allPlayers)) {
        return -1000; // "고인 물" 매치 킬러
    }

    let noveltyScore = 0;
    const pairs = getAllCombinations(combo, 2); // 6개의 모든 쌍 (1-2, 1-3, ...)

    for (const [p1, p2] of pairs) {
        const p1History = allPlayers[p1.id]?.todayRecentGames || [];
        const { wasPartner, wasOpponent, wasRecent } = checkHistory(p1, p2, p1History);

        if (wasPartner) {
            noveltyScore -= 40; // 최근 파트너 감점
        } else if (wasOpponent) {
            noveltyScore -= 20; // 최근 상대 감점
        } else if (!wasRecent) {
            noveltyScore += 10; // "완전 신선" 가점
        }
    }
    score += noveltyScore;

    // 3. 급수 밸런스 점수 (가중치 낮음 - 우선순위: 경기수 > 안친사람 > 급수)
    // 팀을 2:2로 나눴을 때 급수 차이가 크거나(A,A vs A,C 같은), 조합 내 급수 편차가
    // 큰 경우 약하게 감점한다. 다른 조건이 비슷할 때만 영향을 주도록 가중치를 낮게 둔다.
    const { diff: levelDiff, spread: levelSpread } = getBestLevelSplit(combo, allPlayers);
    score -= levelDiff * 10;   // 팀 간 급수 불균형 페널티 (A,A vs A,C → diff 2 → -20)
    score -= levelSpread * 2;  // 조합 전체 급수 편차 페널티

    // 4. 공평 강화 (대기 시간 + 절대 경기차)
    // 오래 기다렸거나(대기시간) 남들보다 적게 친(경기차) 선수를 끌어올려, "운 없이 계속
    // 밀리는" 사람을 방지한다. 가중치는 약하게 두어 다양성(안친사람)을 크게 해치지 않게 함.
    if (fairnessCtx) {
        let fairnessBoost = 0;
        for (const p of combo) {
            const pdata = allPlayers[p.id] || p;
            const games = pdata.todayRecentGames?.length ?? 0;
            const lastTs = pdata.todayRecentGames?.[0]?.timestamp || pdata.entryTime;
            const waitMin = lastTs ? Math.max(0, (fairnessCtx.now - new Date(lastTs).getTime()) / 60000) : 0;
            fairnessBoost += (fairnessCtx.maxGames - games) * 8 + waitMin * 0.8;
        }
        score += fairnessBoost;
    }

    return Math.round(score);
}

/**
 * [자동매칭] 풀에서 "한 경기"만 만든다. (수동 '매칭 만들기' 버튼 전용)
 *
 * 버튼을 누를 때마다 1경기씩 생성하므로, 왜 못 만들었는지를 UI에서 안내할 수 있도록
 * 실패 사유(status)와 최고 점수를 함께 돌려준다.
 *
 * @param {Array<object>} pool - 선수 풀 (해당 성별의 대기 선수)
 * @param {object} allPlayers - 전체 선수 데이터
 * @param {number} minScore - 최소 매칭 점수 (커트라인)
 * @param {{now:number, maxGames:number}} [fairnessCtx] - 공평 강화 컨텍스트
 * @returns {{status:'ok', match:Array<object>, score:number}
 *          |{status:'notEnough', poolSize:number}
 *          |{status:'belowMinScore', bestScore:number, minScore:number}}
 */
function findSingleBestMatch(pool, allPlayers, minScore, fairnessCtx) {
    const poolSize = pool ? pool.length : 0;
    if (poolSize < 4) return { status: 'notEnough', poolSize };

    const poolAvgGames = pool.reduce(
        (acc, p) => acc + (allPlayers[p.id]?.todayRecentGames?.length ?? p.todayRecentGames?.length ?? 0), 0
    ) / poolSize;

    const allCombos = getAllCombinations(pool, 4);
    if (allCombos.length === 0) return { status: 'notEnough', poolSize };

    // 점수가 가장 높은 조합 1개만 고른다 (점수 기준은 calculateMatchScore 그대로)
    let best = null;
    for (const combo of allCombos) {
        const score = calculateMatchScore(combo, allPlayers, poolAvgGames, fairnessCtx);
        if (!best || score > best.score) best = { combo, score };
    }

    // 최고 조합조차 커트라인에 못 미치면 → "매칭 난이도를 낮추세요" 안내용 결과 반환
    if (best.score < minScore) {
        return { status: 'belowMinScore', bestScore: best.score, minScore };
    }
    return { status: 'ok', match: best.combo, score: best.score };
}

/**
 * [자동매칭] 전체 접속 인원(해당 성별: 경기대기 + 경기예정 + 경기진행, 휴식 제외)에 따른
 * "최소 매칭 점수" 커트라인.
 *
 * 실제 매칭 로직(calculateMatchScore)을 그대로 포팅하여 인원수별로
 * 수천 회 세션을 시뮬레이션해서 도출한 값이다.
 *  - 인원이 많을수록 가능한 조합이 많아 "최대한 안 친 사람"끼리 짤 수 있으므로 커트라인을
 *    높여서(엄격) 좋은 조합이 모일 때까지 기다린다. (경기 성사율은 유지)
 *  - 인원이 적으면 나올 수 있는 경우의 수가 적으므로 커트라인을 낮춰(느슨) 바로 매칭한다.
 * 우선순위: 경기수(코트 가동/공평) > 안친사람(다양성) > 급수(밸런스)
 *
 * @param {number} totalPlayers - 해당 성별의 전체 접속 인원(휴식 제외)
 * @returns {number} 최소 매칭 점수 커트라인
 */
function getAutoMatchMinScore(totalPlayers) {
    const n = Math.max(0, Math.floor(totalPlayers || 0));
    if (n < 8) return -100; // 인원이 매우 적으면 거의 무조건 매칭(고인물 -1000만 회피)
    // 인원별 상세 커트라인 (시뮬레이션 기반, 8~25명은 1명 단위로 세분화)
    const TABLE = {
        8: -40, 9: 0, 10: 20, 11: 35, 12: 50, 13: 62, 14: 72, 15: 82,
        16: 92, 17: 98, 18: 104, 19: 108, 20: 112, 21: 116, 22: 120,
        23: 123, 24: 126, 25: 128,
    };
    if (TABLE[n] !== undefined) return TABLE[n];
    return 130; // 26명 이상은 130 고정(상한)
}

/**
 * [자동매칭] 민감도 프리셋. 인원별 기준점수(getAutoMatchMinScore)에 offset을 더해
 * "얼마나 깐깐하게 좋은 조합을 기다릴지"를 직관적으로 조절한다. (수천 회 시뮬레이션으로 확정)
 *  - 낮음: 회전율 우선(바로바로 경기), 대기시간 최소 · 반복 多
 *  - 보통: 균형 (추천 기본값)
 *  - 높음: 다양성 우선(최대한 안 친 사람)
 *  - 최고: 다양성 최대(살짝 더 깐깐)
 */
const AUTO_MATCH_SENSITIVITIES = [
    { key: 'low',    label: '낮음', offset: -60, short: '회전율 우선',  desc: '기다리지 않고 바로 경기를 만듭니다. 사람이 적거나 빨리 많이 치고 싶을 때.' },
    { key: 'normal', label: '보통', offset: -25, short: '균형 (추천)',   desc: '공평함과 다양성을 적절히 맞춥니다. 잘 모르겠으면 이걸 쓰세요.' },
    { key: 'high',   label: '높음', offset: 0,   short: '다양성 우선',   desc: '최대한 안 친 사람과 만나도록 더 신경 써서 매칭합니다.' },
    { key: 'max',    label: '최고', offset: 12,  short: '다양성 최대',   desc: '더 좋은 조합을 위해 살짝 더 깐깐하게 고릅니다. 사람이 많을 때 추천.' },
];
function getSensitivity(key) {
    return AUTO_MATCH_SENSITIVITIES.find(s => s.key === key) || AUTO_MATCH_SENSITIVITIES[1];
}


// ===================================================================================
// 상수 및 Helper 함수
// ===================================================================================
const PLAYERS_PER_MATCH = 4;
const LEVEL_ORDER = { 'A조': 1, 'B조': 2, 'C조': 3, 'D조': 4, 'N조': 5 };

const generateId = (name) => name.replace(/\s+/g, '_');

const filterTodayGames = (games) => {
    if (!games || games.length === 0) return [];
    const today = new Date().toDateString();
    return new Date(games[0].timestamp).toDateString() === today ? games : [];
};

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

    // [자동매칭] 자동 매칭 목록에 있는 선수도 'waiting'이 아님
    if (gameState.autoMatches) {
        Object.keys(gameState.autoMatches).forEach(matchKey => {
            const match = gameState.autoMatches[matchKey];
            if (match) {
                match.forEach((playerId, slotIndex) => {
                    if (playerId) locations[playerId] = { location: 'auto', matchIndex: parseInt(matchKey, 10), slotIndex: slotIndex };
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
// 자식 컴포넌트들
// ===================================================================================
const PlayerCard = React.memo(({ player, context, isAdmin, onCardClick, onAction, onLongPress, isCurrentUser, isMovable = true, isSelectedForWin = false, isPlaying = false }) => {
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

    const adminIcon = (player.role === 'admin' || isAdminName(player.name)) ? '👑' : '';
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
        opacity: isPlaying ? 0.6 : 1,
    };

    if (context.selected || isSelectedForWin) {
        cardStyle.borderColor = '#CDFB47';
        cardStyle.transform = 'scale(1.08)';
        cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 16px 3px rgba(205, 251, 71, 0.6)`;
    }

    if (isCurrentUser) {
        cardStyle.borderColor = '#FF6A52';
        cardStyle.boxShadow = `${cardStyle.boxShadow}, 0 0 13px 3px rgba(255, 106, 82, 0.55)`;
    }

    const isLongPressDisabled = context.location === 'court';
    // [수정] actionLabel이 'auto' 위치도 인식하도록 수정
    const actionLabel = (isWaiting || context.location === 'auto') ? '선수 내보내기' : '대기자로 이동';

    return (
        <div
            ref={cardRef}
            id={isCurrentUser ? 'my-player-card' : undefined}
            // [수정] 휴식 중일 때 filter grayscale 클래스 적용 (기존 코드 복원)
            className={`player-card p-1 rounded-md relative flex flex-col justify-center text-center h-14 w-full ${player.isResting ? 'filter grayscale' : ''}`}
            style={cardStyle}
            onClick={isMovable && onCardClick ? () => onCardClick() : null}
            onMouseDown={isAdmin && isMovable && !isLongPressDisabled ? handlePressStart : null}
            onMouseUp={isAdmin && isMovable && !isLongPressDisabled ? handlePressEnd : null}
            onMouseLeave={isAdmin && isMovable && !isLongPressDisabled ? handlePressEnd : null}
            onContextMenu={handleContextMenu}
        >
            <div>
                <div className={playerNameClass}>{adminIcon}{player.name}</div>
                <div className={playerInfoClass}>
                    <span style={levelStyle}>{player.level.replace('조','')}</span>
                    <span className="ml-1 text-gray-300 font-bold">{player.todayRecentGames ? player.todayRecentGames.length : 0}G</span>
                </div>
            </div>
            {isAdmin && onAction && (
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

// [나간 선수] 경기 진행 중 프로그램에서 나간(퇴장/휴식 처리된) 선수를 표시하는 카드.
// 카드가 사라지지 않고 '나간 선수'로 표시되므로 관리자가 정상적으로 경기를 종료할 수 있다.
const LeftPlayerCard = ({ name }) => (
    <div className="player-card p-1 rounded-md relative flex flex-col justify-center text-center h-14 w-full border border-dashed border-red-500/60 bg-red-900/20 opacity-80 filter grayscale">
        <div className="player-name text-red-300 text-[11px] font-bold whitespace-nowrap leading-tight truncate px-0.5">{name}</div>
        <div className="text-red-400/90 text-[9px] leading-tight mt-px">🚪 나간 선수</div>
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

const WaitingListSection = React.memo(({ maleWaitingPlayers, femaleWaitingPlayers, selectedPlayerIds, isAdmin, handleCardClick, handleDeleteFromWaiting, setModal, currentUser, inProgressPlayerIds, onClearAllWaitingPlayers }) => {
    const renderPlayerGrid = (players) => (
        <div className="grid grid-cols-5 gap-1">
            {players.map(player => (
                <PlayerCard
                    key={player.id}
                    player={player}
                    context={{ location: null, selected: selectedPlayerIds.includes(player.id) }}
                    isAdmin={isAdmin}
                    onCardClick={() => handleCardClick(player.id)}
                    onAction={handleDeleteFromWaiting}
                    onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})}
                    isCurrentUser={currentUser && player.id === currentUser.id}
                    isPlaying={inProgressPlayerIds.has(player.id)}
                />
            ))}
        </div>
    );

    const totalWaiting = maleWaitingPlayers.length + femaleWaitingPlayers.length;

    return (
        <section className="bg-gray-800/50 rounded-lg p-2.5" data-tut="waiting">
            <div className="cox-secline mb-2.5">
                <div className="lbl">
                    <span className="tick"></span>
                    <span>대기 명단</span>
                    <span className="count">{totalWaiting}</span>
                </div>
                {/* [신규 기능] 대기자 전체 내보내기 버튼 */}
                {isAdmin && totalWaiting > 0 && (
                    <button onClick={onClearAllWaitingPlayers} className="cox-pill-danger" data-tut="waiting-clear">
                        전체 내보내기
                    </button>
                )}
            </div>
            <div className="flex flex-col gap-2">
                {renderPlayerGrid(maleWaitingPlayers)}
                {maleWaitingPlayers.length > 0 && femaleWaitingPlayers.length > 0 && (
                    <hr className="border-dashed border-gray-600 my-1" />
                )}
                {renderPlayerGrid(femaleWaitingPlayers)}
            </div>
        </section>
    );
});


const ScheduledMatchesSection = React.memo(({ numScheduledMatches, scheduledMatches, players, selectedPlayerIds, isAdmin, handleCardClick, handleReturnToWaiting, setModal, handleSlotClick, handleStartMatch, currentUser, handleClearScheduledMatches, handleDeleteScheduledMatch, inProgressPlayerIds }) => {
    const pressTimerRef = useRef(null);

    const handlePressStart = (matchIndex) => {
        if (!isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(() => {
            handleDeleteScheduledMatch(matchIndex);
        }, 800);
    };

    const handlePressEnd = () => {
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };

    const hasMatches = Object.values(scheduledMatches).some(m => m && m.some(p => p !== null));

    return (
        <section data-tut="scheduled">
            <div className="cox-secline mb-2.5 px-1">
                <div className="lbl cyan">
                    <span className="tick"></span>
                    <span>경기 예정</span>
                </div>
                {isAdmin && hasMatches && (
                    <button onClick={handleClearScheduledMatches} className="cox-pill-danger">전체삭제</button>
                )}
            </div>
            <div id="scheduled-matches" className="flex flex-col gap-2">
                {Array.from({ length: numScheduledMatches }).map((_, matchIndex) => {
                    const match = scheduledMatches[String(matchIndex)] || Array(PLAYERS_PER_MATCH).fill(null);
                    const playerCount = match.filter(p => p).length;
                    return (
                        // [UI 수정] 내부 요소 정렬 및 간격 유지
                        <div key={`schedule-${matchIndex}`} className="flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1">
                            <div
                                className="flex-shrink-0 w-8 text-center cursor-pointer flex items-center justify-center" // [UI 수정] 너비 살짝 늘리고 중앙 정렬
                                onMouseDown={() => handlePressStart(matchIndex)}
                                onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
                                onTouchStart={() => handlePressStart(matchIndex)}
                                onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
                            >
                                <p className="font-bold text-lg text-white arcade-font">{matchIndex + 1}</p>
                            </div>
                            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                {Array(PLAYERS_PER_MATCH).fill(null).map((_, slotIndex) => {
                                    const playerId = match[slotIndex];
                                    const player = players[playerId];
                                    const context = {location: 'schedule', matchIndex, slotIndex, selected: selectedPlayerIds.includes(playerId)};
                                    return player ? ( <PlayerCard key={playerId} player={player} context={context} isAdmin={isAdmin} onCardClick={() => handleCardClick(playerId)} onAction={handleReturnToWaiting} onLongPress={(p) => setModal({type: 'adminEditPlayer', data: { player: p, mode: 'simple' }})} isCurrentUser={currentUser && player.id === currentUser.id} isPlaying={inProgressPlayerIds.has(playerId)} /> ) : ( <EmptySlot key={`schedule-empty-${matchIndex}-${slotIndex}`} onSlotClick={() => handleSlotClick({ location: 'schedule', matchIndex, slotIndex })} /> )
                                })}
                            </div>
                            <div className="flex-shrink-0 w-14 text-center">
                                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === PLAYERS_PER_MATCH && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== PLAYERS_PER_MATCH || !isAdmin} onClick={() => handleStartMatch(matchIndex, 'schedule')}>START</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});

// [자동매칭] 자동 매칭 섹션 컴포넌트 (UI 변경)
// [수정] 자동 ON/OFF(일정 주기 생성) → '남자/여자 매칭 만들기' 버튼으로 1경기씩 생성
const AutoMatchesSection = React.memo(({ autoMatches, players, isAdmin, handleStartAutoMatch, handleReturnToWaiting, handleClearAutoMatches, handleDeleteAutoMatch, currentUser, handleAutoMatchCardClick, selectedAutoMatchSlot, inProgressPlayerIds, handleAutoMatchSlotClick, handleGenerateMatch, generatingGender }) => {
    const pressTimerRef = useRef(null);

    const handlePressStart = (matchIndex) => {
        if (!isAdmin) return;
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        pressTimerRef.current = setTimeout(() => {
            handleDeleteAutoMatch(matchIndex);
        }, 800);
    };

    const handlePressEnd = () => {
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };

    const matchList = Object.entries(autoMatches);

    // [매칭 연출] 새로 만들어진 매칭에만 카드가 슬롯머신처럼 착착 꽂히는 애니메이션을 준다.
    // 선수 구성(시그니처) 기준이라 START로 경기 번호가 당겨지거나 화면이 갱신돼도
    // 이미 본 매칭은 다시 재생되지 않는다. (모든 접속자 화면에서 동일하게 재생)
    const dealSeenRef = useRef(new Set());
    const isFirstDealRef = useRef(true);
    const matchSig = (match) => (match || []).filter(Boolean).join('|');
    if (isFirstDealRef.current) {
        // 접속 직후 첫 렌더에서는 기존 매칭들이 우르르 재생되지 않도록 본 것으로 처리
        matchList.forEach(([, m]) => { const s = matchSig(m); if (s) dealSeenRef.current.add(s); });
        isFirstDealRef.current = false;
    }
    useEffect(() => {
        matchList.forEach(([, m]) => { const s = matchSig(m); if (s) dealSeenRef.current.add(s); });
    });

    return (
        <section data-tut="auto">
            <div className="cox-secline mb-2.5 px-1">
                 <div className="auto-head-left">
                     <div className="lbl green">
                        <span className="tick"></span>
                        <span>🤖 자동 매칭</span>
                     </div>
                 </div>
                 {isAdmin && matchList.length > 0 && (
                    <button onClick={handleClearAutoMatches} className="cox-pill-danger">전체삭제</button>
                 )}
            </div>
            {/* [신규] 누를 때마다 1경기씩 생성하는 '매칭 만들기' 버튼 (관리자 전용) */}
            {isAdmin && (
                <div className="auto-make-row mb-2.5" data-tut="auto-make">
                    <button
                        type="button"
                        className="auto-make-btn male"
                        onClick={() => handleGenerateMatch('남')}
                        disabled={!!generatingGender}
                    >
                        {generatingGender === '남' ? '만드는 중...' : '👨 남자 매칭 만들기'}
                    </button>
                    <button
                        type="button"
                        className="auto-make-btn female"
                        onClick={() => handleGenerateMatch('여')}
                        disabled={!!generatingGender}
                    >
                        {generatingGender === '여' ? '만드는 중...' : '👩 여자 매칭 만들기'}
                    </button>
                </div>
            )}
            {matchList.length === 0 && (
                <div className="text-center text-gray-500 p-4 bg-gray-800/60 rounded-lg">
                    <p>만들어진 자동 매칭이 없습니다.</p>
                    <p className="text-xs mt-1">
                        {isAdmin
                            ? <>위의 '매칭 만들기'를 누를 때마다<br/>한 경기씩 만들어집니다.</>
                            : <>관리자가 매칭을 만들면 여기에 표시됩니다.</>}
                    </p>
                </div>
            )}
            <div id="auto-matches" className="flex flex-col gap-2">
                {matchList.map(([matchIndex, match]) => {
                    const playerCount = match.filter(p => p).length;
                    // [매칭 연출] 처음 등장하는 구성이면 카드 딜 애니메이션 클래스 부여
                    const isNewDeal = !!matchSig(match) && !dealSeenRef.current.has(matchSig(match));
                    return (
                        // [UI 수정] 내부 요소 정렬 및 간격 유지
                        <div key={`auto-match-${matchIndex}`} className={`flex items-center w-full bg-gray-800/60 rounded-lg p-1 gap-1 ${isNewDeal ? 'auto-deal' : ''}`}>
                            <div
                                className="flex-shrink-0 w-8 text-center cursor-pointer flex items-center justify-center" // [UI 수정] 너비 살짝 늘리고 중앙 정렬
                                onMouseDown={() => handlePressStart(matchIndex)}
                                onMouseUp={handlePressEnd} onMouseLeave={handlePressEnd}
                                onTouchStart={() => handlePressStart(matchIndex)}
                                onTouchEnd={handlePressEnd} onTouchCancel={handlePressEnd}
                            >
                                <p className="font-bold text-lg text-white arcade-font">{parseInt(matchIndex, 10) + 1}</p>
                            </div>
                            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                                {match.map((playerId, slotIndex) => {
                                    const player = players[playerId];
                                    const cardKey = playerId ? `${playerId}-${matchIndex}-${slotIndex}` : `auto-empty-${matchIndex}-${slotIndex}`;
                                    const isSelected = selectedAutoMatchSlot && selectedAutoMatchSlot.matchIndex === matchIndex && selectedAutoMatchSlot.slotIndex === slotIndex;
                                    return player ?
                                        (<PlayerCard key={cardKey} player={player} context={{location: 'auto', selected: isSelected}} isAdmin={isAdmin} onCardClick={() => handleAutoMatchCardClick(matchIndex, slotIndex)} onAction={handleReturnToWaiting} isCurrentUser={currentUser && player.id === currentUser.id} isPlaying={inProgressPlayerIds.has(playerId)} />) :
                                        (<EmptySlot key={cardKey} onSlotClick={() => handleAutoMatchSlotClick(matchIndex, slotIndex)} />)
                                })}
                            </div>
                            <div className="flex-shrink-0 w-14 text-center">
                                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${playerCount === 4 && isAdmin ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={playerCount !== 4 || !isAdmin} onClick={() => handleStartAutoMatch(matchIndex, 'auto')}>START</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});

const InProgressCourt = React.memo(({ courtIndex, court, players, allPlayers, isAdmin, handleEndMatch, currentUser, courtMove, setCourtMove, handleMoveOrSwapCourt }) => {
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
            {/* [UI 수정] 내부 요소 정렬 및 간격 유지 */}
            <div className="flex-shrink-0 w-8 flex flex-col items-center justify-center">
                <p className="font-bold text-lg text-white arcade-font">{courtIndex + 1}</p>
                <p className="font-semibold text-[8px] text-gray-400 arcade-font">코트</p>
            </div>
            <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
                {(court?.players || Array(PLAYERS_PER_MATCH).fill(null)).map((playerId, slotIndex) => {
                    if (!playerId) return <EmptySlot key={`court-empty-${courtIndex}-${slotIndex}`} />;
                    const player = players[playerId];
                    // [나간 선수] 경기 중 선수가 프로그램에서 나가면(비활성/휴식 처리)
                    // 카드를 '나간 선수'로 표시하여 관리자가 경기를 종료할 수 있게 한다.
                    const isLeft = !player || player.isResting;
                    if (isLeft) {
                        const displayName = player?.name || allPlayers?.[playerId]?.name || '나간 선수';
                        return <LeftPlayerCard key={`court-left-${courtIndex}-${slotIndex}`} name={displayName} />;
                    }
                    return <PlayerCard key={playerId} player={player} context={{ location: 'court', matchIndex: courtIndex }} isAdmin={isAdmin} isCurrentUser={currentUser && player.id === currentUser.id} isMovable={false} />;
                })}
            </div>
            <div className="flex-shrink-0 w-14 text-center">
                <button className={`arcade-button w-full py-1.5 px-1 rounded-md font-bold transition duration-300 text-[10px] ${court && isAdmin ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`} disabled={!court || !isAdmin} onClick={(e) => { e.stopPropagation(); handleEndMatch(courtIndex); }}>FINISH</button>
                <CourtTimer court={court} />
            </div>
        </div>
    );
});


const InProgressCourtsSection = React.memo(({ numInProgressCourts, inProgressCourts, players, allPlayers, isAdmin, handleEndMatch, currentUser, courtMove, setCourtMove, handleMoveOrSwapCourt }) => {
    return (
        <section data-tut="courts">
            <div className="cox-secline mb-2.5 px-1">
                <div className="lbl coral">
                    <span className="tick"></span>
                    <span>경기 진행</span>
                </div>
            </div>
            <div id="in-progress-courts" className="flex flex-col gap-2">
                {Array.from({ length: numInProgressCourts }).map((_, courtIndex) => (
                    <InProgressCourt
                        key={`court-${courtIndex}`}
                        courtIndex={courtIndex}
                        court={inProgressCourts[courtIndex]}
                        players={players}
                        allPlayers={allPlayers}
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
    }, [isAdmin, selectedPlayerIds, findPlayerLocation, updateGameState, courtMove]);

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

    // [자동 매칭] '매칭 만들기' — 버튼을 누를 때마다 해당 성별로 "한 경기"만 생성한다.
    //  (기존: ON/OFF + 3초 주기 자동 생성 → 변경: 관리자가 누를 때마다 1경기)
    //  매칭 기준(점수·민감도·급수 밸런스·휴식 제외)은 기존 자동매칭과 완전히 동일하다.
    const handleGenerateMatch = useCallback(async (gender) => {
        const genderLabel = gender === '남' ? '남자' : '여자';

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
                p.gender === gender &&
                !autoMatchedPlayerIds.has(p.id) &&
                !p.isResting // <-- 휴식 선수 제외
            );

            // 커트라인은 "대기석"이 아니라 현재 접속 중인 전체 인원 기준으로 계산한다.
            //  (경기대기 + 경기예정 + 경기진행에 있는 해당 성별 선수 모두 포함, 휴식/비활성 제외, 게스트 포함)
            const genderActive = Object.values(allPlayers)
                .filter(p => p.status === 'active' && !p.isResting && p.gender === gender);

            // [자동매칭] 민감도 프리셋 → 커트라인 오프셋 (성별별 따로 설정 가능)
            const masterSens = config.sensitivity || 'normal';
            const perGender = !!config.perGenderSensitivity;
            const sensKey = perGender
                ? ((gender === '남' ? config.maleSensitivity : config.femaleSensitivity) || masterSens)
                : masterSens;
            const sens = getSensitivity(sensKey);
            const appliedMinScore = getAutoMatchMinScore(genderActive.length) + sens.offset;

            // [공평 강화] 대기시간/경기차 보정용 컨텍스트 (해당 성별 최다 경기수 기준)
            const fairnessCtx = {
                now: Date.now(),
                maxGames: genderActive.reduce((m, p) => Math.max(m, p.todayRecentGames?.length ?? 0), 0),
            };

            const result = findSingleBestMatch(pool, allPlayers, appliedMinScore, fairnessCtx);

            // (1) 매칭 가능한 대기 인원이 4명 미만
            if (result.status === 'notEnough') {
                setModal({ type: 'alert', data: {
                    title: `${genderLabel} 매칭 불가`,
                    body: `매칭할 수 있는 ${genderLabel} 대기 선수가 4명 이상이어야 합니다.\n(현재 ${result.poolSize}명 · 휴식/이미 매칭된 선수 제외)`
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
                const balancedOrder = getBestLevelSplit(result.match, allPlayers).order;
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
        if (!isAdmin) return;

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

    }, [isAdmin, gameState, selectedPlayerIds, handleCardClick, handleSlotClick]);

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
        return <div className="cox-dark text-white min-h-screen flex items-center justify-center font-sans p-4"><div className="text-yellow-400 arcade-font flicker-text" style={{ fontSize: '34px', letterSpacing: '.12em' }}>LOADING...</div></div>;
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
            {isRosterOpen && <RosterManageModal roster={roster} onClose={() => setIsRosterOpen(false)} setModal={setModal} />}

          {isSettingsOpen && <SettingsModal
            isAdmin={isAdmin}
            scheduledCount={gameState.numScheduledMatches}
            courtCount={gameState.numInProgressCourts}
            seasonConfig={seasonConfig}
            activePlayers={activePlayers} /* [수정] '대기'가 아닌 '전체 활성' 선수 전달 */
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
                    onPrev={handleTutorialPrev}
                    onNext={handleTutorialNext}
                    onSkip={() => finishTutorial(tutorial.mode)}
                />
            )}
        </div>
    );
}

// ===================================================================================
// 신규 및 복구된 페이지/모달 컴포넌트들
// ===================================================================================
// [선수 명단] 입장 화면 개편 — 회원은 이름만 입력하면 명단에서 급수/성별을 자동으로
// 가져온다. 급수/성별 선택은 게스트(명단에 없는 손님)에게만 표시된다.
function EntryPage({ onEnter, roster }) {
    const [formData, setFormData] = useState({ name: '', level: 'A조', gender: '남', isGuest: false });
    const [entryError, setEntryError] = useState(null);

    useEffect(() => {
        const savedUserId = localStorage.getItem('badminton-currentUser-id');
        if (savedUserId) {
             getDoc(doc(playersRef, savedUserId)).then(docSnap => {
                if (docSnap.exists()) {
                    const d = docSnap.data();
                    setFormData(prev => ({
                        ...prev,
                        name: d.name || prev.name,
                        isGuest: !!d.isGuest,
                        level: d.level || prev.level,
                        gender: d.gender || prev.gender,
                    }));
                }
            }).catch(e => console.error("이전 입장 정보 불러오기 실패:", e));
        }
    }, []);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setEntryError(null);
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const name = (formData.name || '').trim();
        if (!name) { setEntryError('이름을 입력해주세요.'); return; }

        if (formData.isGuest) {
            onEnter({ name, level: formData.level, gender: formData.gender, isGuest: true });
            return;
        }
        // 회원: 명단에서 급수/성별 자동 조회
        const rosterEntry = Object.values(roster || {}).find(r => r.name === name);
        if (!rosterEntry || !rosterEntry.level || !rosterEntry.gender) {
            setEntryError('등록된 선수 정보가 없습니다.\n관리자에게 문의해주세요.\n\n(모임 회원이 아닌 손님은 아래 "게스트"를 체크하고 입장해주세요.)');
            return;
        }
        onEnter({ name, level: rosterEntry.level, gender: rosterEntry.gender, isGuest: false });
    };

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
              <div className="cox-dark text-white min-h-screen flex items-center justify-center font-sans p-4 relative">
            <div className="modal-content bg-gray-800 p-8 w-full max-w-sm" style={{ borderRadius: '26px' }}>
                <p className="cox-label text-center mb-2" style={{ color: 'var(--volt)' }}>Premium Match System</p>
                <h1 className="text-3xl font-bold text-yellow-400 mb-1 text-center arcade-font flicker-text" style={{ letterSpacing: '.06em' }}>⚡ COCKSLIGHTING</h1>
                <p className="text-center text-gray-500 text-xs mb-6 tracking-wide">실시간 배드민턴 경기 관리</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="text" name="name" placeholder="이름" value={formData.name} onChange={handleChange} className="w-full bg-gray-700 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400" required />

                    {!formData.isGuest && (
                        <p className="text-center text-gray-400 text-xs bg-gray-700/50 rounded-lg py-2 px-3">
                            회원은 이름만 입력하면 등록된 급수로 입장됩니다.
                        </p>
                    )}

                    {/* 게스트만 급수/성별을 직접 선택한다 (회원은 명단에서 자동) */}
                    {formData.isGuest && (
                        <>
                            <div className="grid grid-cols-4 gap-2">
                                {levelButtons}
                            </div>
                            <div className="flex justify-around items-center text-lg">
                                <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="남" checked={formData.gender === '남'} onChange={handleChange} className="mr-2 h-4 w-4 text-yellow-500 bg-gray-700 border-gray-600 focus:ring-yellow-500" /> 남자</label>
                                <label className="flex items-center cursor-pointer"><input type="radio" name="gender" value="여" checked={formData.gender === '여'} onChange={handleChange} className="mr-2 h-4 w-4 text-pink-500 bg-gray-700 border-gray-600 focus:ring-pink-500" /> 여자</label>
                            </div>
                        </>
                    )}

                    <div className="text-center">
                        <label className="flex items-center justify-center text-lg cursor-pointer">
                            <input type="checkbox" name="isGuest" checked={formData.isGuest} onChange={handleChange} className="mr-2 h-4 w-4 rounded text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" />
                            게스트
                        </label>
                    </div>

                    {entryError && (
                        <div className="bg-red-900/40 border border-red-500/50 text-red-200 text-sm rounded-lg p-3 text-center whitespace-pre-line">
                            {entryError}
                        </div>
                    )}

                    <button type="submit" className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 rounded-lg transition duration-300">입장하기</button>
                </form>
            </div>
        </div>
    );
}



function SeasonModal({ announcement, seasonId, onClose, announcementType, announcementPhotoUrl }) {
    const handleClose = (isHideToday = false) => {
        if (isHideToday) {
            localStorage.setItem(`seen-${seasonId}`, new Date().toDateString());
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-[#111] rounded-2xl overflow-hidden w-full max-w-sm text-center shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col border border-white/5">
               <div className="p-3 flex-grow overflow-y-auto max-h-[85vh]">
    {/* 상단 공지 헤더 최적화 */}
    <div className="mb-3">
        <h3 className="text-xs font-medium text-white/40 tracking-[0.2em] uppercase">Season Announcement</h3>
    </div>
    
    {announcementType === 'simple' ? (
        <div className="bg-[#151515] p-5 rounded-xl border border-yellow-500/20 shadow-[0_0_15px_rgba(255,224,0,0.1)] min-h-[250px] flex items-center justify-center text-center">
            <p className="text-white text-base font-sans whitespace-pre-wrap leading-relaxed break-keep">
                {announcement || "등록된 공지사항이 없습니다."}
            </p>
        </div>
    ) : (announcementType === 'text' || !announcementType) ? (
        <div className="poster-wrapper">
            <style>{`
                .poster-wrapper {
                  --brand-yellow: #CDFB47;
                  --bg-solid: #0A0A0A;
                  display: flex;
                  justify-content: center;
                  background: transparent;
                  padding: 0;
                  font-family: 'Inter', 'Pretendard', sans-serif;
                }
                .poster-wrapper .poster {
                  width: 100%;
                  background: var(--bg-solid);
                  position: relative;
                  overflow: hidden;
                  border-radius: 12px;
                  display: flex;
                  flex-direction: column;
                  padding-bottom: 20px;
                  box-shadow: inset 0 0 100px rgba(255,224,0,0.05);
                }
                .poster-wrapper .top-line { height: 4px; background: var(--brand-yellow); width: 100%; }
                .poster-wrapper .top-bar { padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
                .poster-wrapper .top-bar-label { font-size: 9px; letter-spacing: 2px; color: #555; font-weight: 600; }
                .poster-wrapper .hero { padding: 24px 20px 10px; text-align: left; }
                .poster-wrapper .club-name { font-family: 'Black Han Sans', sans-serif; font-size: 48px; line-height: 1; color: var(--brand-yellow); letter-spacing: -1px; margin-bottom: 4px; }
                .poster-wrapper .club-sub { font-size: 14px; font-weight: 300; letter-spacing: 4px; color: rgba(255,255,255,0.4); text-transform: uppercase; }
                .poster-wrapper .section { padding: 0 20px; margin-top: 20px; text-align: left; }
                @keyframes pulse-border {
                  0% { border-color: rgba(255, 224, 0, 0.1); box-shadow: 0 0 0px rgba(255, 224, 0, 0); }
                  50% { border-color: rgba(255, 224, 0, 0.5); box-shadow: 0 0 10px rgba(255, 224, 0, 0.1); }
                  100% { border-color: rgba(255, 224, 0, 0.1); box-shadow: 0 0 0px rgba(255, 224, 0, 0); }
                }
                @keyframes status-blink {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.3; }
                }
                .poster-wrapper .section-label { 
                  font-size: 9px; 
                  letter-spacing: 2px; 
                  color: var(--brand-yellow); 
                  margin-bottom: 10px; 
                  font-weight: 700; 
                  display: flex;
                  align-items: center;
                  gap: 6px;
                }
                .poster-wrapper .status-dot {
                  width: 5px;
                  height: 5px;
                  background-color: #ff4d4d;
                  border-radius: 50%;
                  box-shadow: 0 0 5px #ff4d4d;
                  animation: status-blink 1s infinite;
                }
                .poster-wrapper .time-banner { 
                  background: #151515; 
                  border-radius: 8px; 
                  padding: 14px 18px; 
                  display: flex; 
                  align-items: center; 
                  justify-content: space-between; 
                  border: 1px solid rgba(255,224,0,0.2);
                  animation: pulse-border 3s infinite ease-in-out;
                }
                .poster-wrapper .time-banner-value { 
                  font-family: 'Pretendard', sans-serif; 
                  font-size: 14px; 
                  color: #ffffff; 
                  line-height: 1.6;
                  word-break: keep-all;
                  white-space: pre-wrap;
                  text-shadow: 0 0 1px rgba(255,255,255,0.2);
                }
                
                .poster-wrapper .shuttle-list { display: flex; flex-direction: column; gap: 8px; }
                .poster-wrapper .shuttle-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
                .poster-wrapper .shuttle-text { font-size: 12px; font-weight: 400; color: #aaa; }
                .poster-wrapper .ban-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 5px; }
                .poster-wrapper .ban-item { background: rgba(255,0,0,0.03); border-radius: 4px; padding: 8px 4px; text-align: center; }
                .poster-wrapper .ban-text { font-size: 10px; font-weight: 500; color: #666; }
                .poster-wrapper .ban-item.red-ban { background: rgba(255,0,0,0.05); }
                .poster-wrapper .ban-item.red-ban .ban-text { color: #844; }
                @keyframes revealUp { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
                .poster-wrapper .animate-item { animation: revealUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
                .poster-wrapper .delay-1 { animation-delay: 0.1s; }
                .poster-wrapper .delay-2 { animation-delay: 0.2s; }
                .poster-wrapper .delay-3 { animation-delay: 0.3s; }
                .poster-wrapper .delay-4 { animation-delay: 0.4s; }
            `}</style>
            <div className="poster">
                <div className="top-line"></div>
                <div className="top-bar animate-item">
                    <span className="top-bar-label">COCKSLIGHTING OFFICIAL</span>
                    <span className="top-bar-label">EST. 2023</span>
                </div>
                <div className="hero animate-item delay-1">
                    <div className="club-name">콕스라이팅</div>
                    <div className="club-sub">COCKSLIGHTING</div>
                </div>
                <div className="section animate-item delay-2">
                    <div className="section-label">
                        <span className="status-dot"></span>
                        NOTIFICATION
                    </div>
                    <div className="time-banner">
                        <span className="time-banner-value">{announcement || "금일 등록된 공지사항이 없습니다."}</span>
                    </div>
                </div>
                <div className="section animate-item delay-3">
                    <div className="section-label">EQUIPMENT</div>
                    <div className="shuttle-list">
                        <div className="shuttle-item"><div className="shuttle-text">KBB79 · BOBON365 · 삼화블랙 이상</div></div>
                        <div className="shuttle-item"><div className="shuttle-text text-white/60">개인콕 사용</div></div>
                    </div>
                </div>

                <div className="section animate-item delay-4" style={{marginTop: '15px'}}>
                    <div className="section-label">MANNER RULES</div>
                    <div className="ban-grid">
                        <div className="ban-item red-ban"><div className="ban-text">비매너</div></div>
                        <div className="ban-item red-ban"><div className="ban-text">영업행위</div></div>
                        <div className="ban-item red-ban"><div className="ban-text">남미새/여미새</div></div>
                        <div className="ban-item"><div className="ban-text">철새</div></div>
                        <div className="ban-item"><div className="ban-text">텃세</div></div>
                        <div className="ban-item"><div className="ban-text">승부욕</div></div>
                    </div>
                </div>
            </div>
        </div>
    ) : announcementType === 'photo' ? (
        <img 
            src={announcementPhotoUrl} 
            alt="공지사항" 
            className="w-full h-auto rounded-xl shadow-2xl mb-2"
            fetchpriority="high"
            loading="eager"
        />
    ) : null}
</div>
                <div className="bg-[#111] p-4 flex flex-col gap-2 border-t border-white/5">
                    <button onClick={() => handleClose(false)} className="w-full py-3.5 bg-white text-black font-bold rounded-xl hover:bg-yellow-400 transition-all active:scale-95 text-sm">확인했습니다</button>
                    <button onClick={() => handleClose(true)} className="text-white/20 text-[10px] py-1 hover:text-white/40 tracking-tight">오늘 하루 보지 않기</button>
                </div>
            </div>
        </div>
    );
}



function AdminEditPlayerModal({ player, allPlayers, onClose, setModal }) {
    const currentPlayer = allPlayers[player.id] || player;

    const handleToggleRest = async () => {
        await updateDoc(doc(playersRef, player.id), { isResting: !currentPlayer.isResting });
        onClose();
    };

    const handleAdjustGameCount = async (delta) => {
        const currentGames = currentPlayer.todayRecentGames || [];
        let newGames = [...currentGames];
        
        if (delta > 0) {
            newGames.unshift({ timestamp: new Date().toISOString(), partners: [], opponents: [], isManual: true });
        } else if (delta < 0 && newGames.length > 0) {
            newGames.shift();
        }
        
        try {
            await updateDoc(doc(playersRef, player.id), { todayRecentGames: newGames });
        } catch (error) {
            console.error("Game count adjustment failed:", error);
        }
    };

    const handleDeletePermanently = () => {
        setModal({ type: 'confirm', data: { title: '선수 완전 삭제', body: `[경고] ${player.name} 선수를 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`,
            onConfirm: async () => {
                await deleteDoc(doc(playersRef, player.id));
                onClose();
                setModal({ type: null, data: null });
            }
        }});
    };

    const RecentGamesList = ({ games }) => {
        if (!games || games.length === 0) {
            return <p className="text-sm text-gray-500 text-center">오늘 매칭 기록이 없습니다.</p>;
        }

        const getPlayerName = (id) => allPlayers[id]?.name || '알수없음';

        return (
            <ul className="text-sm space-y-1 max-h-32 overflow-y-auto pr-2">
                {games.map((game, i) => {
                            if (game.isManual) {
                                return (
                                    <li key={i} className="flex flex-col p-2 rounded bg-gray-700/50">
                                        <div className="flex flex-wrap gap-1 items-center">
                                            <span className="text-yellow-400 font-bold" style={{ textShadow: '0 0 8px rgba(250, 204, 21, 0.8)' }}>
                                                {getPlayerName(player.id)}
                                            </span>
                                            <span className="text-gray-400 text-xs ml-2">(수동 조작됨)</span>
                                        </div>
                                    </li>
                                );
                            }

                            const allPlayersInGame = [player.id, ...game.partners, ...game.opponents];
                            
                            return (
                                <li key={i} className="flex flex-col p-2 rounded bg-gray-700/50">
                                    <div className="flex flex-wrap gap-1">
                                        {allPlayersInGame.map((id, idx) => {
                                            const name = getPlayerName(id);
                                            const isTargetPlayer = id === player.id;
                                            return (
                                                <span key={idx} className={isTargetPlayer ? "text-yellow-400 font-bold" : "text-gray-300"} style={isTargetPlayer ? { textShadow: '0 0 8px rgba(250, 204, 21, 0.8)' } : {}}>
                                                    {name}{idx < allPlayersInGame.length - 1 ? ', ' : ''}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </li>
                            )
                        })}
            </ul>
        );
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md text-white shadow-lg">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-yellow-400 arcade-font">{player.name} 정보 관리</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white">&times;</button>
                </div>
                
                <div className="space-y-4">
                            <button onClick={handleToggleRest} className={`w-full arcade-button font-bold py-2 rounded-lg ${currentPlayer.isResting ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gray-600 text-white hover:bg-gray-500'}`}>
                                {currentPlayer.isResting ? '휴식 해제 (복귀)' : '휴식 상태로 전환'}
                            </button>

                            <div className="flex items-center justify-between bg-gray-700/50 p-2 rounded-lg">
                                <span className="font-bold text-gray-300">현재 게임 수 조작</span>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => handleAdjustGameCount(-1)} className="w-8 h-8 bg-gray-600 hover:bg-gray-500 rounded text-xl font-bold flex items-center justify-center">-</button>
                                    <span className="text-xl font-bold text-yellow-400 w-8 text-center">{(currentPlayer.todayRecentGames || []).length}</span>
                                    <button onClick={() => handleAdjustGameCount(1)} className="w-8 h-8 bg-gray-600 hover:bg-gray-500 rounded text-xl font-bold flex items-center justify-center">+</button>
                                </div>
                            </div>
                            
                            <hr className="border-gray-600"/>
                            <h4 className="font-bold text-yellow-400 text-center">오늘의 매칭 히스토리</h4>
                            <RecentGamesList games={currentPlayer.todayRecentGames} />
                        </div>
                
                <div className="mt-6 flex flex-col gap-2">
                    <button onClick={handleDeletePermanently} className="w-full text-xs arcade-button bg-red-900/50 hover:bg-red-800 text-red-300 font-bold py-2 rounded-lg">선수 완전 삭제</button>
                </div>
            </div>
        </div>
    );
}

// [자동매칭] 설정 모달 대규모 업데이트 (수정됨)
function SettingsModal({ isAdmin, scheduledCount, courtCount, seasonConfig, activePlayers, currentUser, roster, onSave, onCancel, setModal, onSystemReset, onClearPlayerHistory, onGenerateRobots, onAdminAddPlayer, onSomoimSync, onOpenRoster, somoimSync }) {
    const [scheduled, setScheduled] = useState(scheduledCount);
    const [courts, setCourts] = useState(courtCount);
    const [announcement, setAnnouncement] = useState(seasonConfig.announcement);
    const [robotMaleCount, setRobotMaleCount] = useState(0);
    const [robotFemaleCount, setRobotFemaleCount] = useState(0);

    // 수동 선수 추가 폼 상태
    const [showAddPlayerForm, setShowAddPlayerForm] = useState(false);
    const [newPlayerForm, setNewPlayerForm] = useState({ name: '', level: 'A조', gender: '남', isGuest: false });

    // [자동매칭] 사용설명서 모달 표시 상태
    const [showAutoGuide, setShowAutoGuide] = useState(false);

    // 자동매칭 설정 상태 (수정됨)
    // [자동매칭] 민감도 프리셋 초기화 (구버전 설정 호환)
    //  ON/OFF는 더 이상 쓰지 않는다 — 메인 화면의 '매칭 만들기' 버튼으로 1경기씩 생성
  const [autoMatchConfig, setAutoMatchConfig] = useState(() => {
        const cfg = seasonConfig.autoMatchConfig || {};
        const sensitivity = cfg.sensitivity || 'normal';
        return {
            ...cfg,
            sensitivity,
            perGenderSensitivity: cfg.perGenderSensitivity ?? false,
            maleSensitivity: cfg.maleSensitivity || sensitivity,
            femaleSensitivity: cfg.femaleSensitivity || sensitivity,
            // [수정] 루트 레벨에 저장된 공지 타입과 사진 URL을 초기값으로 명시
            announcementType: seasonConfig.announcementType || 'text',
            announcementPhotoUrl: seasonConfig.announcementPhotoUrl || ''
        };
    });

    // [관리자 권한] 현재 관리자 목록 (config/season.adminNames 기준, 없으면 기본 관리자)
    const adminNames = useMemo(() => getAdminNames(seasonConfig), [seasonConfig]);
    const [adminInput, setAdminInput] = useState('');
    const [isAdminBusy, setIsAdminBusy] = useState(false);
    // 명단(roster)에 있는 이름인지 확인용 — 오타로 엉뚱한 이름이 등록되는 것을 눈으로 잡기 위함
    const rosterNames = useMemo(
        () => Object.values(roster || {}).map(r => r.name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
        [roster]
    );

    if (!isAdmin) return null;
    
    const handleSave = () => {
        onSave({ scheduled, courts, announcement, autoMatchConfig });
    };

    // ── [관리자 권한] 부여/해임 — 아래 저장 버튼과 무관하게 즉시 반영된다 ──
    const saveAdminNames = async (nextList) => {
        setIsAdminBusy(true);
        try {
            await setDoc(configRef, { adminNames: nextList }, { merge: true });
        } catch (e) {
            console.error('관리자 목록 저장 실패:', e);
            setModal({ type: 'alert', data: { title: '오류', body: '관리자 목록 저장에 실패했습니다.' } });
        } finally {
            setIsAdminBusy(false);
        }
    };

    const handleAddAdmin = async () => {
        const name = (adminInput || '').trim();
        if (!name) {
            setModal({ type: 'alert', data: { title: '안내', body: '관리자 권한을 줄 사람의 이름을 입력해주세요.' } });
            return;
        }
        if (adminNames.includes(name)) {
            setModal({ type: 'alert', data: { title: '안내', body: `${name} 님은 이미 관리자입니다.` } });
            return;
        }
        await saveAdminNames([...adminNames, name]);
        setAdminInput('');
    };

    const handleRemoveAdmin = (name) => {
        // 마지막 한 명까지 해임하면 아무도 설정을 열 수 없게 되므로 막는다.
        if (adminNames.length <= 1) {
            setModal({ type: 'alert', data: {
                title: '해임할 수 없습니다',
                body: '관리자는 최소 1명이 있어야 합니다.\n먼저 다른 사람에게 관리자 권한을 준 뒤에 해임해주세요.'
            }});
            return;
        }
        const isSelf = currentUser?.name === name;
        setModal({ type: 'confirm', data: {
            title: '관리자 해임',
            body: isSelf
                ? `${name} 님(나 자신)의 관리자 권한을 해임할까요?\n해임하면 설정 창을 포함한 관리자 기능을 더 이상 쓸 수 없습니다.`
                : `${name} 님의 관리자 권한을 해임할까요?`,
            onConfirm: async () => {
                setModal({ type: null, data: null });
                await saveAdminNames(adminNames.filter(n => n !== name));
            }
        }});
    };

// [자동매칭] 현재 활성 인원수 (대기+진행+예정 모두 포함, 휴식 제외, 게스트 포함)
    const { malePlayerCount, femalePlayerCount } = useMemo(() => {
        const activePlayersList = Object.values(activePlayers).filter(p => !p.isResting);
        return {
            malePlayerCount: activePlayersList.filter(p => p.gender === '남').length,
            femalePlayerCount: activePlayersList.filter(p => p.gender === '여').length,
        };
    }, [activePlayers]);

    // [자동매칭] 민감도 세그먼트 선택 컴포넌트
    const SensitivitySelect = ({ value, onChange }) => (
        <div className="grid grid-cols-4 gap-1">
            {AUTO_MATCH_SENSITIVITIES.map(s => (
                <button
                    key={s.key}
                    type="button"
                    onClick={() => onChange(s.key)}
                    className={`py-1.5 rounded-md text-xs font-bold arcade-button transition-colors ${value === s.key ? 'bg-green-500 text-black' : 'bg-gray-600 text-gray-200 hover:bg-gray-500'}`}
                >
                    {s.label}
                </button>
            ))}
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg text-white shadow-lg flex flex-col" style={{maxHeight: '90vh'}}>
                <h3 className="text-xl font-bold text-white mb-6 arcade-font text-center flex-shrink-0">설정</h3>
                <div className="flex-grow overflow-y-auto pr-2 space-y-4">

                    {/* --- 자동 매칭 설정 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg" data-tut="set-auto">
                        <div className="flex justify-between items-center mb-3">
                            <label className="font-semibold text-lg text-green-400 arcade-font">
                                🤖 콕스타 자동 매칭
                            </label>
                            <button
                                type="button"
                                onClick={() => setShowAutoGuide(true)}
                                className="flex items-center gap-1 text-xs font-bold bg-green-500/15 text-green-300 border border-green-500/40 rounded-full px-3 py-1.5 hover:bg-green-500/25 transition-colors"
                            >
                                📖 사용설명서
                            </button>
                        </div>
                        {/* [자동매칭] 매칭 생성 방식 안내 (ON/OFF 폐지 → 버튼으로 1경기씩) */}
                        <div className="bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300 leading-relaxed">
                            메인 화면 <b className="text-green-300">🤖 자동 매칭</b>의
                            <b className="text-blue-300"> 👨 남자 매칭 만들기</b> /
                            <b className="text-pink-300"> 👩 여자 매칭 만들기</b> 버튼을 누를 때마다
                            <b className="text-white"> 한 경기씩</b> 만들어집니다.
                        </div>

                        {(
                            <div className="mt-4 pt-4 border-t border-gray-600 space-y-4">

                              {/* 현재 활성 인원 표시 */}
                               <div className="bg-gray-800 p-2 rounded text-center">
                                    <p className="text-sm text-gray-400">
                                        현재 활성 인원: <span className="text-blue-300 font-bold">남 {malePlayerCount}</span> / <span className="text-pink-300 font-bold">여 {femalePlayerCount}</span> 명
                                    </p>
                                </div>

                                {/* [자동매칭] 민감도 프리셋 (낮음/보통/높음/최고) */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <p className="font-semibold">매칭 민감도</p>
                                        <label className="flex items-center text-xs cursor-pointer text-gray-300">
                                            <input
                                                type="checkbox"
                                                checked={autoMatchConfig.perGenderSensitivity || false}
                                                onChange={(e) => setAutoMatchConfig(prev => ({ ...prev, perGenderSensitivity: e.target.checked }))}
                                                className="w-4 h-4 mr-1.5 text-green-400 bg-gray-700 border-gray-600 rounded focus:ring-green-500"
                                            />
                                            남/여 따로
                                        </label>
                                    </div>

                                    {!autoMatchConfig.perGenderSensitivity ? (
                                        <>
                                            <SensitivitySelect
                                                value={autoMatchConfig.sensitivity || 'normal'}
                                                onChange={(key) => setAutoMatchConfig(prev => ({ ...prev, sensitivity: key, maleSensitivity: key, femaleSensitivity: key }))}
                                            />
                                            <p className="text-xs text-green-300/90 mt-2 text-center min-h-[2.5em]">
                                                <span className="font-bold">{getSensitivity(autoMatchConfig.sensitivity || 'normal').label}</span>
                                                {' · '}{getSensitivity(autoMatchConfig.sensitivity || 'normal').desc}
                                            </p>
                                        </>
                                    ) : (
                                        <div className="space-y-3">
                                            <div>
                                                <p className="text-sm text-blue-300 font-semibold mb-1">👨 남자</p>
                                                <SensitivitySelect
                                                    value={autoMatchConfig.maleSensitivity || 'normal'}
                                                    onChange={(key) => setAutoMatchConfig(prev => ({ ...prev, maleSensitivity: key }))}
                                                />
                                            </div>
                                            <div>
                                                <p className="text-sm text-pink-300 font-semibold mb-1">👩 여자</p>
                                                <SensitivitySelect
                                                    value={autoMatchConfig.femaleSensitivity || 'normal'}
                                                    onChange={(key) => setAutoMatchConfig(prev => ({ ...prev, femaleSensitivity: key }))}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <p className="text-xs text-gray-500 text-center">
                                    민감도가 <b>높을수록</b> 최대한 '안 친 사람'끼리 매칭합니다(조합이 까다로워짐).<br/>
                                    <b>낮을수록</b> 웬만한 조합도 바로 경기로 만듭니다. 잘 모르겠으면 <b>보통</b>.<br/>
                                    <span className="text-yellow-500/80">'매칭 만들기'에서 만들 조합이 없다고 나오면 민감도를 한 단계 낮춰보세요.</span>
                                </p>
                            </div>
                        )}
                    </div>

                    {/* --- [관리자 권한] 관리자 부여 / 해임 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg" data-tut="set-admin">
                        <label className="font-semibold text-lg text-yellow-400 arcade-font block mb-1">
                            👑 관리자 권한 부여
                        </label>
                        <p className="text-xs text-gray-400 mb-3">
                            이름을 입력하고 <b className="text-yellow-300">부여</b>를 누르면 그 사람이 관리자가 되고,
                            목록의 <b className="text-red-300">✕</b>를 누르면 권한이 해임됩니다. (저장 버튼과 상관없이 바로 적용)
                        </p>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                list="admin-name-suggestions"
                                value={adminInput}
                                onChange={(e) => setAdminInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAdmin(); } }}
                                placeholder="이름 입력 (예: 홍길동)"
                                disabled={isAdminBusy}
                                className="flex-1 min-w-0 bg-gray-800 text-white p-2 rounded-lg border border-gray-600 focus:border-yellow-500 focus:outline-none"
                            />
                            <datalist id="admin-name-suggestions">
                                {rosterNames.map(n => <option key={n} value={n} />)}
                            </datalist>
                            <button
                                type="button"
                                onClick={handleAddAdmin}
                                disabled={isAdminBusy}
                                className="flex-shrink-0 arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold px-4 rounded-lg disabled:bg-gray-500 disabled:cursor-not-allowed"
                            >
                                부여
                            </button>
                        </div>

                        <div className="mt-3 space-y-1.5">
                            {adminNames.map(name => {
                                const notInRoster = rosterNames.length > 0 && !rosterNames.includes(name);
                                const isSelf = currentUser?.name === name;
                                return (
                                    <div key={name} className="flex items-center justify-between bg-gray-800 px-3 py-2 rounded-lg">
                                        <span className="flex items-center gap-2 min-w-0">
                                            <span className="font-semibold truncate">👑 {name}</span>
                                            {isSelf && <span className="flex-shrink-0 text-[10px] font-bold text-green-300 bg-green-500/15 border border-green-500/40 rounded-full px-2 py-0.5">나</span>}
                                            {notInRoster && <span className="flex-shrink-0 text-[10px] font-bold text-orange-300 bg-orange-500/15 border border-orange-500/40 rounded-full px-2 py-0.5">명단에 없음</span>}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveAdmin(name)}
                                            disabled={isAdminBusy}
                                            title={`${name} 관리자 해임`}
                                            className="flex-shrink-0 ml-2 w-7 h-7 flex items-center justify-center rounded-full bg-red-900/50 hover:bg-red-700 text-red-200 font-bold disabled:opacity-50"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <p className="text-xs text-gray-500 mt-2">
                            · 이름은 <b>입장할 때 쓰는 이름</b>과 정확히 같아야 합니다(띄어쓰기 주의).<br/>
                            · 관리자는 최소 1명이 필요해서 마지막 한 명은 해임할 수 없습니다.
                        </p>
                    </div>

                    {/* --- 일반 설정 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg" data-tut="set-general">
                        <span className="font-semibold mb-2 block text-center">일반 설정</span>
                        <div className="flex items-center justify-around">
                            <div className="text-center">
                                <p>경기 예정 코트 수</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => setScheduled(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                                    <span className="text-xl font-bold w-8 text-center">{scheduled}</span>
                                    <button onClick={() => setScheduled(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                                </div>
                            </div>
                            <div className="text-center">
                                <p>경기 진행 코트 수</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <button onClick={() => setCourts(c => Math.max(1, c - 1))} className="w-8 h-8 bg-gray-600 rounded-full text-lg">-</button>
                                    <span className="text-xl font-bold w-8 text-center">{courts}</span>
                                    <button onClick={() => setCourts(c => c + 1)} className="w-8 h-8 bg-gray-600 rounded-full text-lg">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                   <div className="bg-gray-700 p-3 rounded-lg space-y-3" data-tut="set-notice">
                        <label className="font-semibold block text-center border-b border-gray-600 pb-2">시즌 공지 설정</label>
                   <div className="flex flex-wrap justify-center gap-3 mb-2 text-sm">
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="none" checked={autoMatchConfig.announcementType === 'none'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>없음</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="simple" checked={autoMatchConfig.announcementType === 'simple'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>일반 텍스트</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="text" checked={(autoMatchConfig.announcementType || 'text') === 'text'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>포스터</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="radio" name="announcementType" value="photo" checked={autoMatchConfig.announcementType === 'photo'} 
            onChange={(e) => setAutoMatchConfig(prev => ({...prev, announcementType: e.target.value}))} />
        <span>사진 업로드</span>
    </label>
</div>

{autoMatchConfig.announcementType === 'none' ? (
    <div className="text-center text-sm text-gray-400 py-3 bg-gray-800 rounded">
        접속 시 공지사항 창을 띄우지 않고 바로 방으로 입장합니다.
    </div>
) : autoMatchConfig.announcementType === 'photo' ? (
    <div className="space-y-2">
        <input type="file" accept="image/*" onChange={(e) => setAutoMatchConfig(prev => ({...prev, photoFile: e.target.files[0]}))}
            className="w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-yellow-500 file:text-black hover:file:bg-yellow-600" />
        {seasonConfig.announcementPhotoUrl && <p className="text-[10px] text-gray-500 text-center">기존 사진이 등록되어 있습니다. 변경 시 덮어씌워집니다.</p>}
    </div>
) : (
    <div className="space-y-2">
        <textarea value={announcement} onChange={(e) => setAnnouncement(e.target.value)} rows="3" placeholder="공지 내용을 입력하세요"
            className="w-full bg-gray-600 text-white p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-400"></textarea>
        <p className="text-[10px] text-center text-gray-500">
            {autoMatchConfig.announcementType === 'simple' ? '입력한 내용이 모달 창에 깔끔한 일반 텍스트 형태로 표시됩니다.' : '입력한 내용이 \'사용자 지정 포스터\' 디자인에 자동으로 삽입됩니다.'}
        </p>
    </div>
)}
                    </div>

                 {/* --- [소모임 연동] 선수 정보 관리 + 정모 동기화 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-3" data-tut="set-somoim">
                        <label className="font-semibold block text-center border-b border-gray-600 pb-2">🏸 소모임 연동</label>

                        <button
                            onClick={onOpenRoster}
                            className="w-full arcade-button bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg"
                        >
                            👥 선수 정보 관리 (명단)
                        </button>

                        <button
                            onClick={onSomoimSync}
                            className="w-full arcade-button bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 rounded-lg"
                        >
                            🔄 소모임 정모 동기화 (참석자 → 선수카드)
                        </button>

                        {/* 마지막 동기화 결과 요약 */}
                        {somoimSync?.lastResult && (
                            <div className="bg-gray-800 rounded-lg p-2.5 text-xs text-gray-300 space-y-1">
                                <p className="text-gray-400">
                                    마지막 동기화: {new Date(somoimSync.lastResult.at).toLocaleString('ko-KR')}
                                    {somoimSync.lastResult.trigger === 'auto' ? ' (자동)' : ' (수동)'}
                                </p>
                                {somoimSync.lastResult.noEvent ? (
                                    <p>당일 정모 없음</p>
                                ) : (
                                    <>
                                        <p>생성 {somoimSync.lastResult.created?.length || 0}명 · 재입장 {somoimSync.lastResult.activated?.length || 0}명 · 이미 입장 {somoimSync.lastResult.already?.length || 0}명</p>
                                        {somoimSync.lastResult.unmatched?.length > 0 && (
                                            <p className="text-yellow-400">⚠ 명단 미등록: {somoimSync.lastResult.unmatched.join(', ')}</p>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                        {somoimSync?.lastError && (
                            <div className="bg-red-900/40 border border-red-500/40 rounded-lg p-2.5 text-xs text-red-200">
                                ⚠ 마지막 자동 동기화 실패 (오류코드: {somoimSync.lastError.code}) — {new Date(somoimSync.lastError.at).toLocaleString('ko-KR')}
                            </div>
                        )}
                        <p className="text-[10px] text-gray-500 text-center leading-relaxed">
                            정모가 있는 날 <b>오후 6시</b>에 참석 인원의 선수카드가 자동 생성됩니다.<br/>
                            버튼을 누르면 지금 즉시 동기화합니다. (여러 번 눌러도 안전)
                        </p>
                    </div>

                 {/* --- 선수 수동 추가 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-2" data-tut="set-addplayer">
                        <div
                            className="flex justify-between items-center cursor-pointer"
                            onClick={() => setShowAddPlayerForm(!showAddPlayerForm)}
                        >
                            <label className="font-semibold cursor-pointer">👤 관리자 선수 임의 추가</label>
                            <span className="text-gray-400">{showAddPlayerForm ? '▲' : '▼'}</span>
                        </div>
                        
                        {showAddPlayerForm && (
                            <div className="bg-gray-800 p-3 rounded border border-gray-600 mt-2 space-y-3">
                                <input 
                                    type="text" 
                                    placeholder="이름" 
                                    value={newPlayerForm.name} 
                                    onChange={(e) => setNewPlayerForm(prev => ({...prev, name: e.target.value}))} 
                                    className="w-full bg-gray-600 text-white p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm" 
                                />
                                <div className="grid grid-cols-4 gap-1">
                                    {['A조', 'B조', 'C조', 'D조'].map(level => (
                                        <button
                                            key={level}
                                            type="button"
                                            onClick={() => setNewPlayerForm(prev => ({ ...prev, level }))}
                                            className={`py-1 rounded text-xs font-bold transition-colors arcade-button ${newPlayerForm.level === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}
                                        >
                                            {level}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex justify-around items-center text-sm bg-gray-600 p-2 rounded-md">
                                    <label className="flex items-center cursor-pointer">
                                        <input type="radio" name="newPlayerGender" value="남" checked={newPlayerForm.gender === '남'} onChange={() => setNewPlayerForm(prev => ({...prev, gender: '남'}))} className="mr-1 h-3 w-3 text-yellow-500 bg-gray-700 border-gray-600 focus:ring-yellow-500" /> 남자
                                    </label>
                                    <label className="flex items-center cursor-pointer">
                                        <input type="radio" name="newPlayerGender" value="여" checked={newPlayerForm.gender === '여'} onChange={() => setNewPlayerForm(prev => ({...prev, gender: '여'}))} className="mr-1 h-3 w-3 text-pink-500 bg-gray-700 border-gray-600 focus:ring-pink-500" /> 여자
                                    </label>
                                    <div className="w-px h-4 bg-gray-500"></div>
                                    <label className="flex items-center cursor-pointer">
                                        <input type="checkbox" checked={newPlayerForm.isGuest} onChange={(e) => setNewPlayerForm(prev => ({...prev, isGuest: e.target.checked}))} className="mr-1 h-3 w-3 rounded text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500" /> 게스트
                                    </label>
                                </div>
                                <button
                                    onClick={() => {
                                        onAdminAddPlayer(newPlayerForm);
                                        setNewPlayerForm({ name: '', level: 'A조', gender: '남', isGuest: false });
                                        setShowAddPlayerForm(false);
                                    }}
                                    className="w-full arcade-button bg-green-600 hover:bg-green-700 text-white font-bold py-1.5 rounded text-sm"
                                >
                                    추가하기
                                </button>
                            </div>
                        )}
                    </div>

                  {/* --- 고급 기능 --- */}
                    <div className="bg-gray-700 p-3 rounded-lg space-y-2" data-tut="set-advanced">
                        <label className="font-semibold mb-2 block text-center">고급 기능</label>
                        
                        {/* 테스트 로봇 생성 섹션 */}
                        <div className="bg-gray-800 p-2 rounded border border-gray-600 mb-4">
                            <p className="text-sm font-semibold text-center mb-2 text-cyan-400">🤖 테스트 로봇 생성 (개발용)</p>
                            <div className="flex justify-around gap-2 mb-2">
                                <div className="flex-1 text-center">
                                    <label className="block text-xs mb-1 text-gray-400">👨 남자 수</label>
                                    <input 
                                        type="number" min="0" 
                                        value={robotMaleCount} 
                                        onChange={(e) => setRobotMaleCount(Number(e.target.value))} 
                                        className="w-full bg-gray-600 p-1.5 rounded text-center text-white text-sm" 
                                    />
                                </div>
                                <div className="flex-1 text-center">
                                    <label className="block text-xs mb-1 text-gray-400">👩 여자 수</label>
                                    <input 
                                        type="number" min="0" 
                                        value={robotFemaleCount} 
                                        onChange={(e) => setRobotFemaleCount(Number(e.target.value))} 
                                        className="w-full bg-gray-600 p-1.5 rounded text-center text-white text-sm" 
                                    />
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    onGenerateRobots(robotMaleCount, robotFemaleCount);
                                    setRobotMaleCount(0);
                                    setRobotFemaleCount(0);
                                }}
                                className="w-full arcade-button bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={robotMaleCount === 0 && robotFemaleCount === 0}
                            >
                                로봇 생성하기
                            </button>
                        </div>

                         <button
                            onClick={onSystemReset}
                            className="w-full arcade-button bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 rounded-lg disabled:opacity-50 mb-2"
                        >
                            모두 대기로 이동
                        </button>
                        <button
                            onClick={onClearPlayerHistory}
                            className="w-full arcade-button bg-red-800 hover:bg-red-900 text-white font-bold py-2 rounded-lg disabled:opacity-50"
                        >
                            선수 히스토리 삭제
                        </button>
                    </div>
                </div>
                <div className="mt-6 flex gap-4 flex-shrink-0" data-tut="set-save">
                     <button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 font-bold py-2 rounded-lg">취소</button>
                    <button onClick={handleSave} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg">저장</button>
                </div>
            </div>

            {/* [자동매칭] 사용설명서 모달 */}
            {showAutoGuide && <AutoMatchGuideModal onClose={() => setShowAutoGuide(false)} />}
        </div>
    );
}

// [자동매칭] 초보 관리자용 사용설명서 — 짧고 핵심만
function AutoMatchGuideModal({ onClose }) {
    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-2xl w-full max-w-md text-white shadow-[0_0_24px_rgba(34,197,94,0.25)] border border-green-500/30 flex flex-col"
                style={{ maxHeight: '88vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-5 pb-3 flex-shrink-0 border-b border-gray-700">
                    <h3 className="text-lg font-bold text-green-400 arcade-font">🤖 자동 매칭 사용설명서</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white leading-none">&times;</button>
                </div>

                <div className="p-5 pt-4 space-y-4 text-sm overflow-y-auto">
                    <div>
                        <p className="font-bold text-green-300 mb-1">① 자동 매칭이 뭔가요?</p>
                        <p className="text-gray-300 leading-relaxed">대기 중인 선수를 시스템이 알아서 <b>4명</b> 골라 <b>'🤖 자동 매칭'</b> 칸에 올려줍니다. 관리자는 <b>START</b>만 누르면 경기가 시작돼요.</p>
                    </div>
                    <div>
                        <p className="font-bold text-green-300 mb-1">② 어떤 기준으로 짜나요?</p>
                        <p className="text-gray-300 leading-relaxed">
                            <b>1순위</b> 적게 치거나 오래 기다린 사람 먼저<br/>
                            <b>2순위</b> 그 안에서 최대한 <b>안 친 사람</b>끼리<br/>
                            <b>3순위</b> 양 팀 <b>급수</b>도 최대한 맞춰서
                        </p>
                    </div>
                    <div>
                        <p className="font-bold text-green-300 mb-1">③ 만드는 법</p>
                        <p className="text-gray-300 leading-relaxed">
                            메인 화면 '🤖 자동 매칭'의 <b className="text-blue-300">👨 남자 매칭 만들기</b> / <b className="text-pink-300">👩 여자 매칭 만들기</b>를 누르면
                            <b> 누를 때마다 한 경기</b>가 만들어집니다. 두 경기가 필요하면 두 번 누르면 돼요.
                        </p>
                    </div>
                    <div>
                        <p className="font-bold text-green-300 mb-1">④ "매칭 난이도를 낮춰주세요"가 뜨면?</p>
                        <p className="text-gray-300 leading-relaxed">
                            지금 만들 수 있는 조합이 전부 <b>기준 점수</b>에 못 미친다는 뜻입니다(예: 방금 같이 친 사람끼리만 남음).
                            아래 <b>매칭 민감도</b>를 한 단계 낮추거나(예: 높음 → 보통), 경기가 끝나 대기 선수가 늘어난 뒤 다시 눌러주세요.
                        </p>
                    </div>
                    <div>
                        <p className="font-bold text-green-300 mb-1">⑤ 민감도 고르기</p>
                        <ul className="text-gray-300 leading-relaxed space-y-1">
                            {AUTO_MATCH_SENSITIVITIES.map(s => (
                                <li key={s.key}><b className="text-white">{s.label}</b> — {s.short}: <span className="text-gray-400">{s.desc}</span></li>
                            ))}
                        </ul>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/25 rounded-lg p-3">
                        <p className="font-bold text-green-300 mb-1">💡 한 줄 팁</p>
                        <p className="text-gray-300 leading-relaxed">사람이 <b>적으면 낮음~보통</b>, <b>많으면 높음~최고</b>. 고민되면 그냥 <b>보통</b>으로 두세요. 인원에 맞춰 깐깐함은 자동으로 조절됩니다.</p>
                    </div>
                </div>

                <div className="p-4 flex-shrink-0 border-t border-gray-700">
                    <button onClick={onClose} className="w-full arcade-button bg-green-500 hover:bg-green-600 text-black font-bold py-2.5 rounded-lg">확인했어요</button>
                </div>
            </div>
        </div>
    );
}

function ConfirmationModal({ title, body, onConfirm, onCancel }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[80] p-4"><div className="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-white mb-4">{title}</h3><p className="text-gray-300 mb-6">{body}</p><div className="flex gap-4"><button onClick={onCancel} className="w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors">취소</button><button onClick={onConfirm} className="w-full arcade-button bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg transition-colors">확인</button></div></div></div>); }

function CourtSelectionModal({ courts, onSelect, onCancel }) {
    const [isProcessing, setIsProcessing] = useState(false);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg">
                <h3 className="text-xl font-bold text-yellow-400 mb-4 arcade-font">코트 선택</h3>
                <p className="text-gray-300 mb-6">경기를 시작할 코트를 선택해주세요.</p>
                <div className="flex flex-col gap-3">
                    {courts.map(courtIdx => (
                        <button
                            key={courtIdx}
                            onClick={() => {
                                setIsProcessing(true);
                                onSelect(courtIdx);
                            }}
                            className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
                            disabled={isProcessing}
                        >
                            {isProcessing ? '처리 중...' : `${courtIdx + 1}번 코트`}
                        </button>
                    ))}
                </div>
                <button
                    onClick={onCancel}
                    className="mt-6 w-full arcade-button bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded-lg transition-colors"
                    disabled={isProcessing}
                >
                    취소
                </button>
            </div>
        </div>
    );
}

// [수정] body에 줄바꿈(\n)이 있으면 그대로 보이도록 whitespace-pre-line 적용
function AlertModal({ title, body, onClose }) { return ( <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[80] p-4"><div className="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center shadow-lg"><h3 className="text-xl font-bold text-yellow-400 mb-4">{title}</h3><p className="text-gray-300 mb-6 whitespace-pre-line text-sm leading-relaxed">{body}</p><button onClick={onClose} className="w-full arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 rounded-lg transition-colors">확인</button></div></div> ); }

// ===================================================================================
// [선수 명단] 선수 정보 관리 모달 — 관리자 설정 > 선수 정보 관리
// 명단(이름/급수/성별) 조회·검색·추가·수정·삭제. 소모임 연동(mid) 상태도 표시.
// ===================================================================================
function RosterManageModal({ roster, onClose, setModal }) {
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ level: 'A조', gender: '남' });
    const [showAddForm, setShowAddForm] = useState(false);
    const [addForm, setAddForm] = useState({ name: '', level: 'A조', gender: '남' });
    const [isBusy, setIsBusy] = useState(false);

    const rosterList = useMemo(() =>
        // 문서에 id 필드가 없어도 문서 키를 id로 보정해 수정/삭제가 항상 동작하게 한다
        Object.entries(roster || {}).map(([docId, r]) => ({ ...r, id: r.id || docId }))
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')),
    [roster]);

    const filtered = useMemo(() =>
        search.trim() ? rosterList.filter(r => (r.name || '').includes(search.trim())) : rosterList,
    [rosterList, search]);

    const showError = (body) => setModal({ type: 'alert', data: { title: '오류', body } });

    // 기본 명단(사진 명단) 등록 — 이미 있는 이름은 건드리지 않는 비파괴 병합
    const handleSeed = async () => {
        setIsBusy(true);
        try {
            const existingNames = new Set(rosterList.map(r => r.name));
            const toAdd = ROSTER_SEED.filter(s => !existingNames.has(s.name));
            if (toAdd.length === 0) {
                setModal({ type: 'alert', data: { title: '안내', body: '기본 명단의 선수들이 이미 모두 등록되어 있습니다.' } });
                return;
            }
            const batch = writeBatch(db);
            toAdd.forEach(s => {
                const id = generateId(s.name);
                batch.set(doc(rosterRef, id), {
                    id, name: s.name, level: s.level, gender: s.gender,
                    somoimMid: null, createdAt: new Date().toISOString(),
                }, { merge: true });
            });
            await batch.commit();
            setModal({ type: 'alert', data: {
                title: '등록 완료',
                body: `기본 명단 ${toAdd.length}명이 등록되었습니다.\n\n⚠ 성별은 이름으로 추정한 값입니다. 목록을 확인하고 잘못된 선수는 수정해주세요.`,
            }});
        } catch (e) {
            console.error('명단 기본 등록 실패:', e);
            showError('기본 명단 등록에 실패했습니다.');
        } finally {
            setIsBusy(false);
        }
    };

    const handleAdd = async () => {
        const name = (addForm.name || '').trim();
        if (!name) { showError('이름을 입력해주세요.'); return; }
        if (rosterList.some(r => r.name === name)) { showError('이미 명단에 있는 이름입니다.'); return; }
        setIsBusy(true);
        try {
            const id = generateId(name);
            await setDoc(doc(rosterRef, id), {
                id, name, level: addForm.level, gender: addForm.gender,
                somoimMid: null, createdAt: new Date().toISOString(),
            }, { merge: true });
            setAddForm({ name: '', level: 'A조', gender: '남' });
            setShowAddForm(false);
        } catch (e) {
            console.error('명단 추가 실패:', e);
            showError('선수 추가에 실패했습니다.');
        } finally {
            setIsBusy(false);
        }
    };

    const handleEditSave = async (entry) => {
        setIsBusy(true);
        try {
            await setDoc(doc(rosterRef, entry.id), {
                level: editForm.level, gender: editForm.gender,
                updatedAt: new Date().toISOString(),
            }, { merge: true });
            setEditingId(null);
        } catch (e) {
            console.error('명단 수정 실패:', e);
            showError('선수 정보 수정에 실패했습니다.');
        } finally {
            setIsBusy(false);
        }
    };

    const handleDelete = (entry) => {
        setModal({ type: 'confirm', data: {
            title: '명단에서 삭제',
            body: `${entry.name} 선수를 명단에서 삭제할까요?\n(삭제하면 일반 입장 및 소모임 동기화가 되지 않습니다)`,
            onConfirm: async () => {
                try {
                    await deleteDoc(doc(rosterRef, entry.id));
                } catch (e) {
                    console.error('명단 삭제 실패:', e);
                    showError('삭제에 실패했습니다.');
                }
                setModal({ type: null, data: null });
            }
        }});
    };

    const LevelPicker = ({ value, onChange }) => (
        <div className="grid grid-cols-4 gap-1">
            {['A조', 'B조', 'C조', 'D조'].map(level => (
                <button key={level} type="button" onClick={() => onChange(level)}
                    className={`py-1 rounded text-xs font-bold arcade-button ${value === level ? 'bg-yellow-500 text-black' : 'bg-gray-600 text-white'}`}>
                    {level}
                </button>
            ))}
        </div>
    );
    const GenderPicker = ({ value, onChange }) => (
        <div className="flex gap-2">
            {['남', '여'].map(g => (
                <button key={g} type="button" onClick={() => onChange(g)}
                    className={`flex-1 py-1 rounded text-xs font-bold arcade-button ${value === g ? (g === '남' ? 'bg-blue-500 text-white' : 'bg-pink-500 text-white') : 'bg-gray-600 text-white'}`}>
                    {g === '남' ? '👨 남자' : '👩 여자'}
                </button>
            ))}
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[70] p-4">
            <div className="bg-gray-800 rounded-lg p-5 w-full max-w-md text-white shadow-lg flex flex-col" style={{ maxHeight: '90vh' }} data-tut="roster">
                <div className="flex justify-between items-center mb-3 flex-shrink-0">
                    <h3 className="text-lg font-bold text-yellow-400 arcade-font">👥 선수 정보 관리</h3>
                    <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white leading-none">&times;</button>
                </div>

                <div className="flex gap-2 mb-3 flex-shrink-0">
                    <input
                        type="text" placeholder="이름 검색" value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="flex-1 bg-gray-700 text-white p-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                    <button onClick={() => setShowAddForm(v => !v)}
                        className="arcade-button bg-green-600 hover:bg-green-700 text-white font-bold px-3 rounded-lg text-sm flex-shrink-0">
                        {showAddForm ? '닫기' : '+ 추가'}
                    </button>
                </div>

                {showAddForm && (
                    <div className="bg-gray-700 rounded-lg p-3 mb-3 space-y-2 flex-shrink-0">
                        <input type="text" placeholder="이름" value={addForm.name}
                            onChange={(e) => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full bg-gray-600 text-white p-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                        <LevelPicker value={addForm.level} onChange={(level) => setAddForm(prev => ({ ...prev, level }))} />
                        <GenderPicker value={addForm.gender} onChange={(gender) => setAddForm(prev => ({ ...prev, gender }))} />
                        <button onClick={handleAdd} disabled={isBusy}
                            className="w-full arcade-button bg-green-600 hover:bg-green-700 text-white font-bold py-1.5 rounded text-sm disabled:opacity-50">
                            명단에 추가
                        </button>
                    </div>
                )}

                <p className="text-[10px] text-gray-500 mb-2 flex-shrink-0 text-center">
                    총 {rosterList.length}명 · 🔗 = 소모임 계정 연동됨 · 이름을 누르면 수정할 수 있습니다
                </p>

                <div className="flex-grow overflow-y-auto space-y-1 pr-1">
                    {rosterList.length === 0 && (
                        <div className="text-center py-6 space-y-3">
                            <p className="text-gray-400 text-sm">등록된 선수 명단이 없습니다.</p>
                            <button onClick={handleSeed} disabled={isBusy}
                                className="arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 px-4 rounded-lg text-sm disabled:opacity-50">
                                📋 기본 명단 {ROSTER_SEED.length}명 등록하기
                            </button>
                            <p className="text-[10px] text-gray-500">모임 명단 사진 기준 (성별은 추정값이므로 등록 후 확인 필요)</p>
                        </div>
                    )}
                    {filtered.map(entry => (
                        <div key={entry.id} className="bg-gray-700/60 rounded-lg">
                            <div
                                className="flex items-center justify-between px-3 py-2 cursor-pointer"
                                onClick={() => {
                                    if (editingId === entry.id) { setEditingId(null); return; }
                                    setEditingId(entry.id);
                                    setEditForm({ level: entry.level || 'A조', gender: entry.gender || '남' });
                                }}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-bold text-sm truncate">{entry.name}</span>
                                    {entry.somoimMid && <span title="소모임 계정 연동됨" className="text-xs">🔗</span>}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-xs font-bold" style={{ color: getLevelColor(entry.level, false) }}>{entry.level}</span>
                                    <span className={`text-xs font-bold ${entry.gender === '남' ? 'text-blue-400' : 'text-pink-400'}`}>{entry.gender}</span>
                                    <span className="text-gray-500 text-xs">{editingId === entry.id ? '▲' : '▼'}</span>
                                </div>
                            </div>
                            {editingId === entry.id && (
                                <div className="px-3 pb-3 space-y-2 border-t border-gray-600 pt-2">
                                    <LevelPicker value={editForm.level} onChange={(level) => setEditForm(prev => ({ ...prev, level }))} />
                                    <GenderPicker value={editForm.gender} onChange={(gender) => setEditForm(prev => ({ ...prev, gender }))} />
                                    <div className="flex gap-2">
                                        <button onClick={() => handleDelete(entry)}
                                            className="arcade-button bg-red-900/60 hover:bg-red-800 text-red-300 font-bold py-1.5 px-3 rounded text-xs">
                                            삭제
                                        </button>
                                        <button onClick={() => handleEditSave(entry)} disabled={isBusy}
                                            className="flex-1 arcade-button bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-1.5 rounded text-xs disabled:opacity-50">
                                            저장
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {rosterList.length > 0 && filtered.length === 0 && (
                        <p className="text-center text-gray-500 text-sm py-4">검색 결과가 없습니다.</p>
                    )}
                </div>

                <button onClick={onClose} className="mt-4 w-full arcade-button bg-gray-600 hover:bg-gray-700 font-bold py-2 rounded-lg flex-shrink-0">닫기</button>
            </div>
        </div>
    );
}

// ===================================================================================
// [소모임 동기화] 수동 동기화 결과 모달
// ===================================================================================
function SomoimSyncResultModal({ result, onClose }) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[80] p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-white shadow-lg flex flex-col" style={{ maxHeight: '85vh' }}>
                <h3 className="text-xl font-bold text-teal-400 mb-4 arcade-font text-center flex-shrink-0">🔄 동기화 완료</h3>
                <div className="flex-grow overflow-y-auto space-y-3 text-sm">
                    {result.noEvent ? (
                        <p className="text-center text-gray-300 py-4">
                            오늘 날짜의 소모임 정모가 없습니다.<br/>
                            <span className="text-xs text-gray-500">(정모가 등록된 날에만 선수카드가 생성됩니다)</span>
                        </p>
                    ) : (
                        <>
                            {result.events?.length > 0 && (
                                <div className="bg-gray-700/60 rounded-lg p-2.5">
                                    <p className="text-xs text-gray-400 mb-1">오늘 정모</p>
                                    {result.events.map((ev, i) => (
                                        <p key={i} className="font-bold text-yellow-300 text-xs">{ev.name}</p>
                                    ))}
                                </div>
                            )}
                            <div className="bg-gray-700/60 rounded-lg p-2.5 space-y-1.5">
                                <p>✅ 새로 입장: <b className="text-green-400">{result.created.length}명</b>
                                    {result.created.length > 0 && <span className="text-xs text-gray-400 block">{result.created.join(', ')}</span>}
                                </p>
                                <p>♻️ 재입장 처리: <b className="text-teal-300">{result.activated.length}명</b>
                                    {result.activated.length > 0 && <span className="text-xs text-gray-400 block">{result.activated.join(', ')}</span>}
                                </p>
                                <p>👍 이미 입장 중: <b className="text-gray-300">{result.already.length}명</b>
                                    {result.already.length > 0 && <span className="text-xs text-gray-400 block">{result.already.join(', ')}</span>}
                                </p>
                            </div>
                            {result.unmatched.length > 0 && (
                                <div className="bg-yellow-900/30 border border-yellow-500/40 rounded-lg p-2.5">
                                    <p className="text-yellow-300 font-bold text-xs mb-1">⚠ 명단에 없어 카드가 생성되지 않은 참석자 ({result.unmatched.length}명)</p>
                                    <p className="text-xs text-yellow-200">{result.unmatched.join(', ')}</p>
                                    <p className="text-[10px] text-gray-400 mt-1.5">
                                        관리자 설정 → 선수 정보 관리에서 이 선수들을 추가한 뒤 다시 동기화해주세요.
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>
                <button onClick={onClose} className="mt-4 w-full arcade-button bg-teal-500 hover:bg-teal-600 text-black font-bold py-2 rounded-lg flex-shrink-0">확인</button>
            </div>
        </div>
    );
}

// ===================================================================================
// [튜트리얼] 첫 접속 온보딩 — 관리자용 / 사용자용
// -----------------------------------------------------------------------------------
// 다른 앱들처럼 실제 화면의 해당 부분에 스포트라이트를 비추고 말풍선으로 설명한다.
//   · 관리자용: 관리자 권한을 받고 처음 1회 자동으로 뜬다. 관리자 기능 전체를 훑는다.
//   · 사용자용: 일반 선수가 처음 입장할 때 뜨고, "듣기 / 괜찮아요" 를 고를 수 있다.
// 시청 여부는 선수 문서(players/<id>.tutorialSeen)에 남기므로 기기를 바꿔도 다시 뜨지
// 않는다. localStorage 는 오프라인/쓰기 실패 대비 보조 기록이다.
// 언제든 프로필 메뉴 ▸ '튜트리얼 다시 보기' 로 재생할 수 있다.
//
// 단계(step) 스펙
//   target  : 스포트라이트를 비출 요소의 선택자(data-tut). 없거나 못 찾으면 화면 중앙 카드
//   surface : 그 단계에서 열어 둘 화면 ('main' | 'menu' | 'settings' | 'roster')
//   tab     : 모바일에서 전환할 탭 ('matching' | 'inProgress')
//   only    : 'mobile' | 'desktop' — 해당 환경에서만 보여줄 단계
// ===================================================================================

const TUT_LS_KEY = (playerId) => `cox-tutorial-seen-${playerId}`;

const readLocalTutorialSeen = (playerId) => {
    try {
        return JSON.parse(localStorage.getItem(TUT_LS_KEY(playerId))) || {};
    } catch (e) {
        return {};
    }
};

// 시청 기록 저장 — 실패해도 튜트리얼 진행을 막지 않는다(로컬 기록은 남는다).
const markTutorialSeen = async (playerId, mode) => {
    if (!playerId || !mode) return;
    const now = new Date().toISOString();
    try {
        localStorage.setItem(TUT_LS_KEY(playerId), JSON.stringify({ ...readLocalTutorialSeen(playerId), [mode]: now }));
    } catch (e) { /* 시크릿 모드 등 */ }
    try {
        await setDoc(doc(playersRef, playerId), { tutorialSeen: { [mode]: now } }, { merge: true });
    } catch (e) {
        console.error('[튜트리얼] 시청 기록 저장 실패:', e);
    }
};

// ── 관리자용 튜트리얼 (현재 코드에 있는 관리자 기능 전부) ──
const TUTORIAL_ADMIN_STEPS = [
    {
        title: '먼저 큰 흐름만 잡고 갈게요',
        body: (<>
            선수는 <b>왼쪽에서 오른쪽으로</b> 딱 한 방향으로만 움직입니다.
            <ul>
                <li><em>대기 명단</em> — 지금 체육관에 온 사람</li>
                <li><em>자동 매칭 / 경기 예정</em> — 다음에 칠 4명</li>
                <li><em>경기 진행</em> — 코트에서 치는 중</li>
            </ul>
            이 셋만 기억하시면 끝이에요. 하나씩 볼게요!
        </>),
    },
    {
        target: '[data-tut="waiting"]', tab: 'matching',
        title: '① 대기 명단 — 지금 온 사람들',
        body: (<>
            입장한 선수가 <b>남자 줄 · 여자 줄</b>로 나뉘어 쌓입니다.
            카드에 <b>급수</b>와 <b>오늘 몇 경기 했는지(3G)</b>가 같이 보여요.
            <ul>
                <li><b>회색</b> 카드 = 휴식 중 (매칭에서 빠짐)</li>
                <li><b>흐린</b> 카드 = 이미 코트에서 경기 중</li>
            </ul>
        </>),
    },
    {
        target: '[data-tut="waiting"]', tab: 'matching',
        title: '선수 카드 다루는 법 3가지',
        body: (<>
            <ul>
                <li><span className="tut-key">한 번 탭</span> 선택 (여러 명 연속 선택 가능)</li>
                <li><span className="tut-key">✕</span> 그 선수 내보내기 (기록은 남아요)</li>
                <li><span className="tut-key">1초 꾹 누르기</span> 선수 정보 관리 창</li>
            </ul>
            꾹 누르면 <b>휴식 전환 · 게임 수 ± 손보기 · 오늘 누구와 쳤는지 · 완전 삭제</b>까지 할 수 있어요.
        </>),
    },
    {
        target: '[data-tut="waiting-clear"]', tab: 'matching',
        title: '운동 끝났을 때는 전체 내보내기',
        body: (<>
            대기 중인 사람을 <b>한 번에 전부</b> 퇴장시킵니다. 기록은 지워지지 않아요.
            <br/>(버튼이 안 보이면 대기 인원이 없는 겁니다)
        </>),
    },
    {
        target: '[data-tut="auto-make"]', tab: 'matching',
        title: '② 자동 매칭 — 가장 많이 쓰실 기능',
        body: (<>
            <em>👨 남자 매칭 만들기</em> / <em>👩 여자 매칭 만들기</em>를 누르면
            <b> 누를 때마다 한 경기</b>가 만들어집니다.
            <br/>두 경기가 필요하면 두 번 누르시면 돼요. 그게 전부입니다!
        </>),
    },
    {
        title: '자동 매칭은 이 순서로 고릅니다',
        body: (<>
            <ul>
                <li><em>1순위</em> 적게 친 사람 · 오래 기다린 사람 먼저</li>
                <li><em>2순위</em> 그 안에서 최대한 <b>안 친 사람</b>끼리</li>
                <li><em>3순위</em> 양 팀 <b>급수</b>도 맞춰서</li>
            </ul>
            방금 친 4명이 <b>그대로 또 나오는 일은 아예 차단</b>돼 있어요.
            휴식 중인 사람도 자동으로 빠집니다.
        </>),
    },
    {
        target: '[data-tut="auto"]', tab: 'matching',
        title: '만들어진 경기 손보기',
        body: (<>
            <ul>
                <li>카드 탭 → 다른 카드 탭 = <b>자리 교환</b> (경기 예정과도 교환돼요)</li>
                <li>빈칸 탭 = 대기에서 고른 선수를 <b>그 자리에</b></li>
                <li><span className="tut-key">✕</span> 대기로 돌려보내기</li>
                <li>왼쪽 <b>번호를 꾹</b> 누르면 그 경기만 삭제</li>
            </ul>
            마음에 들면 오른쪽 <em>START</em> 를 눌러 코트로 올립니다.
        </>),
    },
    {
        title: '"매칭 난이도를 낮춰주세요"가 뜨면?',
        body: (<>
            지금 만들 수 있는 조합이 전부 기준에 못 미친다는 뜻이에요.
            (예: 방금 같이 친 사람들만 남은 경우)
            <br/><b>잠깐 기다려 경기가 끝나거나</b>, 설정에서 <b>매칭 민감도를 한 단계 낮추면</b> 바로 만들어집니다.
        </>),
    },
    {
        target: '[data-tut="scheduled"]', tab: 'matching',
        title: '③ 경기 예정 — 직접 짜고 싶을 때',
        body: (<>
            대기 명단에서 <b>선수를 탭해 고르고</b>, 여기 <b>빈칸을 탭</b>하면 들어갑니다.
            여러 명을 골라 두면 순서대로 채워져요.
            <br/>왼쪽 <b>번호를 꾹</b> = 그 경기 삭제, <em>START</em> = 경기 시작.
        </>),
    },
    {
        target: '[data-tut="courts"]', tab: 'inProgress',
        title: '④ 경기 진행 — 끝나면 FINISH',
        body: (<>
            코트마다 <b>경기 시간</b>이 자동으로 흘러갑니다.
            경기가 끝나면 <em>FINISH</em> 한 번!
            <br/>그때 <b>누구와 같은 편이었고 누구와 붙었는지</b>가 기록돼서,
            다음 자동 매칭이 더 정확해집니다.
        </>),
    },
    {
        target: '[data-tut="courts"]', tab: 'inProgress',
        title: '★ 경기 중인 코트 바꾸는 법',
        body: (<>
            코트가 바뀌었을 때 쓰는 기능이에요.
            <ul>
                <li>왼쪽 <b>코트 번호를 0.8초 꾹</b> 누르면 노란 테두리가 생겨요</li>
                <li>그 상태로 <b>옮길 코트를 탭</b>하면 끝!</li>
            </ul>
            빈 코트면 <b>이동</b>, 경기 중인 코트면 <b>서로 맞교환</b>됩니다.
            취소는 같은 코트를 다시 탭하세요.
        </>),
    },
    {
        target: '[data-tut="courts"]', tab: 'inProgress',
        title: '경기 중에 누가 그냥 가버렸어요',
        body: (<>
            그 자리는 <b>🚪 나간 선수</b> 카드로 남습니다. 카드가 사라지지 않으니
            <b> FINISH 를 그대로 누르면</b> 정상적으로 경기가 종료돼요.
        </>),
    },
    {
        target: '[data-tut="nav"]', only: 'mobile',
        title: '화면 전환은 아래 두 버튼',
        body: (<>
            <b>경기 예정</b>과 <b>경기 진행</b>을 오갑니다.
            가운데 라임색 버튼은 <b>내 카드가 어디 있는지</b> 찾아서 반짝여 줘요.
            <br/>화면을 <b>아래로 당기면</b> 새로고침도 됩니다.
        </>),
    },
    {
        surface: 'menu', target: '[data-tut="menu"]',
        title: '내 메뉴 (오른쪽 위 동그라미)',
        body: (<>
            <ul>
                <li><b>잠시 휴식하기</b> — 매칭에서 빠져요 (복귀도 여기서)</li>
                <li><b>관리자 설정</b> — 아래에서 하나씩 볼게요</li>
                <li><b>튜트리얼 다시 보기</b> — 이 설명을 또 볼 수 있어요</li>
                <li><b>나가기</b> — 현황판에서 퇴장</li>
            </ul>
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-auto"]',
        title: '설정 ① 매칭 민감도',
        body: (<>
            <b>낮음</b>은 바로바로 경기를 만들고(회전율), <b>높음·최고</b>는
            안 친 사람끼리 만나도록 더 깐깐하게 고릅니다.
            <ul>
                <li>잘 모르겠으면 <em>보통</em> 그대로 두세요</li>
                <li>사람이 적으면 낮음~보통, 많으면 높음~최고</li>
                <li><b>남/여 따로</b> 체크하면 성별별로 다르게 줄 수 있어요</li>
            </ul>
            📖 <b>사용설명서</b> 버튼에 요약본도 있습니다.
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-admin"]',
        title: '설정 ② 관리자 권한 주기 / 빼기',
        body: (<>
            이름을 적고 <b>부여</b>를 누르면 그 사람도 관리자가 됩니다.
            목록의 <b>✕</b> 는 해임이에요.
            <ul>
                <li><b>저장 버튼과 상관없이 바로 적용</b>됩니다</li>
                <li>입장할 때 쓰는 이름과 <b>똑같이</b> (띄어쓰기 주의)</li>
                <li>'명단에 없음' 배지가 뜨면 오타일 수 있어요</li>
                <li>관리자는 최소 1명이라 마지막 한 명은 못 빼요</li>
            </ul>
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-general"]',
        title: '설정 ③ 코트 수 맞추기',
        body: (<>
            체육관 사정에 맞춰 <b>경기 진행 코트 수</b>를 바꾸세요.
            <b>경기 예정</b>은 미리 짜 둘 경기 칸 수입니다.
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-notice"]',
        title: '설정 ④ 공지 띄우기',
        body: (<>
            접속하면 처음 뜨는 공지창이에요. 4가지 중에 고르시면 됩니다.
            <ul>
                <li><b>없음</b> — 공지창 없이 바로 입장</li>
                <li><b>일반 텍스트</b> — 적은 글만 깔끔하게</li>
                <li><b>포스터</b> — 콕스타 포스터 디자인에 글이 얹혀요</li>
                <li><b>사진 업로드</b> — 만들어 둔 이미지 그대로</li>
            </ul>
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-somoim"]',
        title: '설정 ⑤ 소모임 연동',
        body: (<>
            정모가 있는 날 <b>오후 6시에 참석자 카드가 저절로</b> 만들어집니다.
            지금 바로 하고 싶으면 <b>🔄 동기화</b> 버튼을 누르세요. (여러 번 눌러도 안전)
            <br/>결과에 <b>⚠ 명단 미등록</b>이 있으면 그 사람은 명단에 추가한 뒤 다시 눌러주세요.
        </>),
    },
    {
        surface: 'roster', target: '[data-tut="roster"]',
        title: '설정 ⑥ 선수 정보 관리 (명단)',
        body: (<>
            여기 등록된 사람만 <b>이름만 적고 입장</b>할 수 있어요. (급수·성별을 자동으로 가져갑니다)
            <ul>
                <li><b>+ 추가</b> 로 새 회원 등록</li>
                <li><b>이름을 탭</b>하면 급수·성별 수정 / 삭제</li>
                <li><b>🔗</b> 표시는 소모임 계정과 연결됐다는 뜻</li>
            </ul>
            "등록된 선수 정보가 없다"는 문의가 오면 여기를 확인하세요.
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-addplayer"]',
        title: '설정 ⑦ 선수 임의 추가',
        body: (<>
            휴대폰이 없거나 급하게 온 손님을 <b>관리자가 대신 입장</b>시킵니다.
            이름·급수·성별만 넣으면 되고, 모임 회원이 아니면 <b>게스트</b>에 체크하세요.
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-advanced"]',
        title: '설정 ⑧ 고급 기능 (조심!)',
        body: (<>
            <ul>
                <li><b>🤖 테스트 로봇</b> — 연습용 가짜 선수 만들기</li>
                <li><b>모두 대기로 이동</b> — 진행·예정·자동매칭을 비우고 전원 대기로</li>
                <li><b>선수 히스토리 삭제</b> — 오늘 경기 기록을 0으로 (되돌릴 수 없어요)</li>
            </ul>
        </>),
    },
    {
        surface: 'settings', target: '[data-tut="set-save"]',
        title: '마지막에 저장 꼭 눌러주세요',
        body: (<>
            <b>코트 수 · 공지 · 매칭 민감도</b>는 <em>저장</em>을 눌러야 반영됩니다.
            <br/>(관리자 권한 부여/해임만 예외로 즉시 적용돼요)
        </>),
    },
    {
        title: '가만히 둬도 알아서 되는 것들',
        body: (<>
            <ul>
                <li><b>매일 새벽 2시</b> — 전원 퇴장 + 오늘 기록 정리 + 코트 비우기</li>
                <li><b>정모일 오후 6시</b> — 소모임 참석자 카드 자동 생성</li>
            </ul>
            매일 손으로 초기화하지 않으셔도 됩니다.
        </>),
    },
    {
        title: '준비 끝! 하루는 이렇게 흘러갑니다 🎉',
        body: (<>
            <b>사람들이 입장 → 매칭 만들기 → START → FINISH</b> 이 반복이 전부예요.
            <br/><br/>다시 보고 싶으면 오른쪽 위 <b>내 메뉴 ▸ 튜트리얼 다시 보기</b>.
            즐거운 운동 되세요!
        </>),
    },
];

// ── 사용자용 튜트리얼 (일반 선수) ──
const TUTORIAL_USER_STEPS = [
    {
        title: '콕스타는 이런 앱이에요',
        body: (<>
            오늘 온 사람들을 모아서 <b>다음에 칠 4명</b>을 정해주고,
            코트 상황을 <b>모두에게 실시간으로</b> 보여줍니다.
            <br/>순서를 눈치보며 기다리지 않아도 돼요. 화면만 보시면 됩니다!
        </>),
    },
    {
        target: '[data-tut="waiting"]', tab: 'matching',
        title: '① 여기 어딘가에 내 카드가 있어요',
        body: (<>
            <b>주황색 테두리</b>가 나입니다.
            카드에는 <b>급수</b>와 <b>오늘 몇 경기 했는지(3G)</b>가 적혀 있어요.
            <br/>회색으로 바뀌면 휴식 중, 흐릿하면 지금 코트에서 치고 있다는 뜻입니다.
        </>),
    },
    {
        target: '[data-tut="fab"]', only: 'mobile',
        title: '내 카드 못 찾겠으면 이 버튼',
        body: (<>
            누르면 <b>내 카드로 화면이 이동</b>하면서 반짝여 줍니다.
            사람이 많은 날 아주 편해요.
        </>),
    },
    {
        target: '[data-tut="auto"]', tab: 'matching',
        title: '② 자동 매칭 — 콕스타의 핵심 ★',
        body: (<>
            여기에 <b>내 이름이 올라오면 다음 경기</b>예요.
            관리자님이 매칭을 만들면 자동으로 나타납니다.
            <br/>이 4명을 어떻게 고르는지가 중요한데, 다음 장에서 알려드릴게요!
        </>),
    },
    {
        title: '★ 원칙 1 — 적게 친 사람이 먼저',
        body: (<>
            콕스타는 <b>운동을 못 한 사람을 먼저 끌어올립니다.</b>
            <ul>
                <li>오늘 <b>경기 수가 적은 사람</b>이 우선</li>
                <li><b>오래 기다린 사람</b>일수록 우선</li>
            </ul>
            그래서 <b>"나만 계속 못 치는"</b> 일이 생기지 않아요.
            목소리 큰 사람이 먼저 치는 구조가 아닙니다.
        </>),
    },
    {
        title: '★ 원칙 2 — 최대한 안 친 사람과',
        body: (<>
            같은 사람들끼리만 계속 치지 않도록,
            <ul>
                <li><b>방금 같은 편이었던 사람</b>은 크게 뒤로</li>
                <li><b>방금 상대였던 사람</b>도 뒤로</li>
                <li><b>오늘 아직 안 만난 사람</b>은 앞으로!</li>
            </ul>
            방금 친 <b>4명이 그대로 또 붙는 일은 아예 막혀</b> 있어요.
            덕분에 하루 운동하면 <b>여러 사람과 골고루</b> 치게 됩니다.
        </>),
    },
    {
        title: '★ 원칙 3 — 실력도 맞춰서',
        body: (<>
            위 두 조건을 지키면서 <b>양 팀 급수 합이 비슷해지도록</b> 편을 나눕니다.
            한 팀만 너무 세지 않게요.
            <br/><br/>정리하면 <em>공평하게 → 다양하게 → 재미있게</em>.
            사람 손이 아니라 <b>규칙</b>이 정하는 겁니다.
        </>),
    },
    {
        target: '[data-tut="scheduled"]', tab: 'matching',
        title: '③ 경기 예정',
        body: (<>
            관리자님이 <b>직접 짜 둔 경기</b>가 올라오는 칸입니다.
            자동 매칭과 똑같이, 내 이름이 있으면 다음 차례예요.
        </>),
    },
    {
        target: '[data-tut="courts"]', tab: 'inProgress',
        title: '④ 경기 진행 — 내 이름 있으면 코트로!',
        body: (<>
            지금 각 코트에서 <b>누가 몇 분째</b> 치고 있는지 보여줍니다.
            여기에 내 이름이 뜨면 <b>바로 그 번호 코트로</b> 가시면 돼요.
        </>),
    },
    {
        surface: 'menu', target: '[data-tut="menu"]',
        title: '쉬고 싶을 때 · 집에 갈 때',
        body: (<>
            오른쪽 위 <b>내 동그라미</b>를 누르면,
            <ul>
                <li><b>잠시 휴식하기</b> — 매칭에서 빠집니다. 물 마시거나 쉴 때!</li>
                <li><b>경기 복귀하기</b> — 다시 매칭에 들어갑니다</li>
                <li><b>나가기</b> — 현황판에서 퇴장 (기록은 남아요)</li>
            </ul>
            <b>꼭 눌러주세요.</b> 안 누르고 가시면 없는 사람으로 매칭이 잡혀요!
        </>),
    },
    {
        title: '작은 팁 두 가지',
        body: (<>
            <ul>
                <li>화면이 멈춘 것 같으면 <b>아래로 쭉 당겨</b> 새로고침</li>
                <li>처음 뜨는 <b>공지</b>는 '오늘 하루 보지 않기'로 넘길 수 있어요</li>
            </ul>
            카카오톡에서 열면 실시간 연결이 끊길 수 있어요.
            안내가 뜨면 <b>크롬·사파리로 열어주세요.</b>
        </>),
    },
    {
        title: '설명 끝! 즐겁게 운동하세요 🏸',
        body: (<>
            <b>입장 → 화면 보고 기다리기 → 내 이름 뜨면 코트로</b>. 이게 전부예요.
            <br/><br/>다시 보고 싶으면 <b>내 메뉴 ▸ 튜트리얼 다시 보기</b>.
            <br/>불편한 점은 관리자에게 편하게 말씀해주세요!
        </>),
    },
];

// [튜트리얼] 시작 화면 — 인사와 함께 들을지 말지 고른다
function TutorialIntroModal({ mode, userName, onStart, onSkip }) {
    const isAdminMode = mode === 'admin';
    return (
        <div className="tut-intro-wrap">
            <div className="tut-intro">
                <div className="emoji">{isAdminMode ? '👑' : '🏸'}</div>
                <span className="who">{isAdminMode ? 'COCKSTAR ADMIN' : 'COCKSTAR GUIDE'}</span>
                {isAdminMode ? (
                    <>
                        <h3>안녕하세요!<br/>콕스타 관리자가 되신 것을<br/>진심으로 축하합니다~</h3>
                        <p>
                            {userName ? `${userName} 님, ` : ''}이제 매칭·코트·설정을 모두 다루실 수 있어요.
                            <br/>어렵지 않습니다. <b>2분만</b> 함께 화면을 짚어볼게요!
                        </p>
                    </>
                ) : (
                    <>
                        <h3>안녕하세요!<br/>콕스타 개발자 정형진입니다</h3>
                        <p>
                            {userName ? `${userName} 님, ` : ''}반갑습니다 :)
                            <br/>처음이시면 <b>1분짜리 사용법</b>을 보여드릴게요.
                            이미 써보셨다면 바로 시작하셔도 됩니다!
                        </p>
                    </>
                )}
                <div className="tut-intro-actions">
                    <button className="tut-btn primary" onClick={onStart}>
                        {isAdminMode ? '관리자 튜트리얼 시작하기' : '튜트리얼 듣기'}
                    </button>
                    <button className="tut-btn ghost" onClick={onSkip}>
                        {isAdminMode ? '나중에 볼게요' : '괜찮아요! 사용해봤어요'}
                    </button>
                </div>
                <p className="tut-foot">나중에 <b>내 메뉴 ▸ 튜트리얼 다시 보기</b>에서 언제든 볼 수 있어요</p>
            </div>
        </div>
    );
}

// [튜트리얼] 스포트라이트 오버레이 — 실제 화면 요소를 비추고 말풍선으로 설명한다
function TutorialOverlay({ mode, steps, stepIndex, prepare, onPrev, onNext, onSkip }) {
    const [rect, setRect] = useState(null);
    const step = steps[stepIndex];

    useEffect(() => {
        if (!step) return;
        let cancelled = false;
        setRect(null);
        prepare(step);

        // 대상 요소가 그려질 때까지 잠깐 기다렸다가(설정창 열기 등) 위치를 잰다.
        // 끝까지 못 찾으면 대상 없는 단계처럼 화면 중앙 카드로 보여준다.
        const measure = (tries) => {
            if (cancelled) return;
            if (!step.target) { setRect(null); return; }
            const el = document.querySelector(step.target);
            if (!el || el.getBoundingClientRect().height === 0) {
                if (tries < 15) setTimeout(() => measure(tries + 1), 70);
                else setRect(null);
                return;
            }
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            // rAF는 탭이 백그라운드면 멈추므로 setTimeout으로 잰다 (scrollIntoView는 즉시 적용됨)
            setTimeout(() => {
                if (cancelled) return;
                const r = el.getBoundingClientRect();
                setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
            }, 50);
        };

        const timer = setTimeout(() => measure(0), 110);
        const onResize = () => measure(0);
        window.addEventListener('resize', onResize);
        return () => {
            cancelled = true;
            clearTimeout(timer);
            window.removeEventListener('resize', onResize);
        };
    }, [step, prepare]);

    if (!step) return null;

    const total = steps.length;
    const isLast = stepIndex === total - 1;
    // 대상이 화면 위쪽에 있으면 설명 카드를 아래에, 아래쪽에 있으면 위에 붙인다.
    const atBottom = !rect || (rect.top + rect.height / 2) < window.innerHeight * 0.5;
    const cardPos = !rect ? 'centered' : (atBottom ? 'at-bottom' : 'at-top');

    return (
        <div className="tut-layer">
            {rect && (
                <div
                    className="tut-spot"
                    style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
                />
            )}
            {/* 오버레이 위 조작을 막는 투명막 (대상이 없을 때만 스스로 어둡게) */}
            <div className={`tut-block ${rect ? '' : 'solid'}`} />

            <div className={`tut-card ${cardPos}`}>
                <div className="tut-top">
                    <span className="tut-badge">{mode === 'admin' ? '👑 관리자 튜트리얼' : '🏸 콕스타 사용법'}</span>
                    <button className="tut-x" onClick={onSkip}>건너뛰기</button>
                </div>
                <h4 className="tut-title">{step.title}</h4>
                <div className="tut-body">{step.body}</div>
                <div className="tut-track"><span style={{ width: `${((stepIndex + 1) / total) * 100}%` }} /></div>
                <div className="tut-actions">
                    <span className="tut-count">{stepIndex + 1} / {total}</span>
                    {stepIndex > 0 && <button className="tut-btn ghost" onClick={onPrev}>이전</button>}
                    <button className="tut-btn primary" onClick={onNext}>{isLast ? '시작하기 🎉' : '다음'}</button>
                </div>
            </div>
        </div>
    );
}

// [자동매칭] 이 모달은 더 이상 사용되지 않습니다.
/*
function AutoMatchSetupModal({ onConfirm, onCancel }) {
    ...
}
*/

