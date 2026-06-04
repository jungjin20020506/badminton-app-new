// public/firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCKT1JZ8MkA5WhBdL3XXxtm_0wLbnOBi5I",
  authDomain: "project-104956788310687609.firebaseapp.com",
  projectId: "project-104956788310687609",
  storageBucket: "project-104956788310687609.firebasestorage.app",
  messagingSenderId: "384562806148",
  appId: "1:384562806148:web:d8bfb83b28928c13e671d1"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// PWA 설치/활성화 즉시 제어권 획득
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// 백그라운드 FCM 메시지 수신 처리
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification?.title || payload.data?.title || '🏸 콕스라이팅 알림';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || '앱을 확인해주세요.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    data: payload.data || {}
  };
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// 알림 클릭 시 앱 포커스
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
