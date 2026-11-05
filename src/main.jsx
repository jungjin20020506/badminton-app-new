import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { UpdateBanner } from './components/UpdateBanner.jsx'

// [업데이트 안내] 배너는 App 바깥에 두어 로딩·인앱브라우저 안내·입장·메인 어느 화면에서도 뜬다
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <UpdateBanner />
  </StrictMode>,
)
