import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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

export default defineConfig({
  plugins: [
    somoimDevApi(),
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
})
