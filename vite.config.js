import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// [소모임 동기화] 개발 서버(npm run dev)에서도 Vercel의 /api/somoim 과 동일하게
// 동작하도록 하는 미들웨어. (배포 시에는 Vercel serverless function이 처리)
const somoimDevApi = () => ({
  name: 'somoim-dev-api',
  configureServer(server) {
    server.middlewares.use('/api/somoim', async (req, res) => {
      try {
        const { fetchAndParseSomoim, DEFAULT_GID } = await import('./api/_lib/somoimParser.js')
        const url = new URL(req.url, 'http://localhost')
        const gid = url.searchParams.get('gid') || DEFAULT_GID
        const { members, events } = await fetchAndParseSomoim(gid)
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: true, fetchedAt: new Date().toISOString(), gid, memberCount: members.length, members, events }))
      } catch (e) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, code: e.code || 'UNKNOWN', message: e.message }))
      }
    })
  },
})

// [업데이트 안내] 빌드할 때마다 새로 찍히는 빌드 번호 + 커밋 해시.
// 코드(__BUILD_ID__/__COMMIT_SHA__)와 서버 파일(version.json) 양쪽에 새겨져,
// 앱이 두 값을 비교해 새 버전을 감지한다. 커밋 해시는 "지금 떠 있는 코드가 어느
// 커밋인지"를 설정 화면에서 바로 알 수 있게 해 준다.
const buildId = new Date().toISOString();
const commitSha = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'local'; }
})();
const versionJson = () => ({
  name: 'emit-version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId, commit: commitSha }) });
  },
});

// [시뮬레이션] `vite --mode sim` 이면 firebase/firestore 를 브라우저 안의 가짜 Firestore
// (src/sim/fakeFirestore.js)로 바꿔치기한다. 실제 서버를 건드리지 않고 전체 흐름을 돌려볼 때 쓴다.
// 배포 빌드(mode=production)·일반 dev 에는 적용되지 않는다.
const simAlias = (mode) => (mode === 'sim'
  ? { alias: { 'firebase/firestore': fileURLToPath(new URL('./src/sim/fakeFirestore.js', import.meta.url)) } }
  : undefined);

export default defineConfig(({ mode }) => ({
  resolve: simAlias(mode),
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __COMMIT_SHA__: JSON.stringify(commitSha),
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // [성능] 한 덩어리(895KB)였던 번들을 역할별로 나눈다.
        //  · 벤더 청크는 앱 코드가 바뀌어도 해시가 그대로라 브라우저 캐시가 살아남는다
        //  · firebase 가 가장 크다 — firestore / storage 를 분리해 병렬로 받는다
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@sentry')) return 'vendor-sentry';
          if (id.includes('firebase/firestore') || id.includes('@firebase/firestore')) return 'vendor-firestore';
          if (id.includes('@firebase/storage') || id.includes('firebase/storage')) return 'vendor-storage';
          if (id.includes('@firebase') || id.includes('firebase')) return 'vendor-firebase';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
  // [테스트] Vitest 설정 — `npm test`
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 60000,
  },
  plugins: [
    somoimDevApi(),
    versionJson(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'firebase-messaging-sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        injectionPoint: undefined
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'COCKSLIGHTING',
        short_name: 'COCKSLIGHTING',
        description: '실시간 배드민턴 경기 관리 시스템',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
}))
