import { initializeApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, collection } from 'firebase/firestore';

// ===================================================================================
// Firebase 설정 (기존 app.jsx에서 이동)
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

// db와 ref들을 export하여 App.jsx에서 쓰기 작업에 사용하도록 합니다.
export const db = getFirestore(app);
export const playersRef = collection(db, "players");
export const gameStateRef = doc(db, "gameState", "live");


// ===================================================================================
// 서비스 로직
// ===================================================================================
let playersData = {};
let gameStateData = null;
const subscribers = new Set();

// 초기 데이터 로딩이 완료되었는지 확인하기 위한 Promise
let resolvePlayers, resolveGameState;
const playersPromise = new Promise(resolve => { resolvePlayers = resolve; });
const gameStatePromise = new Promise(resolve => { resolveGameState = resolve; });
export const readyPromise = Promise.all([playersPromise, gameStatePromise]);


// Firestore 리스너 설정 (앱 전체에서 딱 한 번만 실행됨)
onSnapshot(playersRef, (snapshot) => {
  console.log("Firestore: Players data updated.");
  const players = {};
  snapshot.forEach(doc => players[doc.id] = doc.data());
  playersData = players;
  resolvePlayers(); // 첫 데이터 수신 완료
  notifySubscribers();
});

onSnapshot(gameStateRef, (doc) => {
  console.log("Firestore: Game state updated.");
  if (doc.exists()) {
    gameStateData = doc.data();
  } else {
    // 문서가 없을 경우를 대비한 기본값
    gameStateData = { 
        scheduledMatches: {}, 
        inProgressCourts: Array(4).fill(null),
        numScheduledMatches: 4,
        numInProgressCourts: 4,
    };
  }
  resolveGameState(); // 첫 데이터 수신 완료
  notifySubscribers();
});

// 데이터 변경을 구독중인 컴포넌트에게 알리는 함수
function notifySubscribers() {
  subscribers.forEach(callback => callback());
}

// React 컴포넌트가 사용할 서비스 객체
const firebaseService = {
  getPlayers: () => playersData,
  getGameState: () => gameStateData,
  subscribe: (callback) => {
    subscribers.add(callback);
    // 구독 해제 함수를 반환
    return () => subscribers.delete(callback);
  },
};

export default firebaseService;
