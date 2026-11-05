import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// 스타일 — 순서가 곧 우선순위다 (뒤가 앞을 덮어쓴다). 목록 설명은 index.css 참고
import './index.css'
import './styles/01-base.css'
import './styles/02-tokens.css'
import './styles/03-appbar-nav.css'
import './styles/04-cards.css'
import './styles/05-match-options.css'
import './styles/06-guide.css'
import './styles/07-tutorial.css'
import './styles/08-live.css'
import './styles/09-brand.css'
import './styles/10-skeleton.css'
import './styles/11-theme-dark.css'
import './styles/12-team.css'
import './styles/13-system-ui.css'
import './styles/14-theme-light.css'
import './styles/15-poster.css'
import './styles/15-poster.css'
import './styles/15-poster.css'

import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { UpdateBanner } from './components/UpdateBanner.jsx'
import { Toaster } from './components/Toaster.jsx'
import { ConnectionBanner } from './components/ConnectionBanner.jsx'
import { initMonitoring } from './lib/monitoring'
import { initTheme } from './lib/theme'

// [테마] 첫 그리기 전에 저장된 테마(다크/라이트)를 html 에 적용해 깜빡임을 막는다
initTheme()
// [모니터링] VITE_SENTRY_DSN 이 있을 때만 켜진다 (없으면 아무것도 불러오지 않는다)
initMonitoring()

// 시스템 UI(업데이트 배너·토스트·연결 띠)는 App 바깥에 두어 로딩·인앱브라우저 안내·입장·메인
// 어느 화면에서도 뜬다. ErrorBoundary 는 App 의 렌더 오류를 잡아 복구 화면을 보여준다.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <ConnectionBanner />
    <UpdateBanner />
    <Toaster />
  </StrictMode>,
)
