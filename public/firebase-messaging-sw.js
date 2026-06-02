// public/firebase-messaging-sw.js

// 1. Firebase 백그라운드용 스크립트 불러오기
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// 2. Firebase 설정 (App.jsx에 있는 config와 동일하게 작성)
const firebaseConfig = {
  apiKey: "AIzaSyCKT1JZ8MkA5WhBdL3XXxtm_0wLbnOBi5I",
  authDomain: "project-104956788310687609.firebaseapp.com",
  projectId: "project-104956788310687609",
  storageBucket: "project-104956788310687609.firebasestorage.app",
  messagingSenderId: "384562806148",
  appId: "1:384562806148:web:d8bfb83b28928c13e671d1"
};

// 3. 앱 초기화 및 메시징 객체 생성
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// 4. 백그라운드에서 푸시를 받았을 때의 동작
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] 백그라운드 메시지 수신: ', payload);
  
  const notificationTitle = payload.notification?.title || payload.data?.title || '🏸 콕스라이팅 알림';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || '앱을 확인해주세요.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true // 사용자가 알림을 확인하거나 지울 때까지 계속 유지
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
