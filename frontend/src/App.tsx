import { Link, Navigate, Route, Routes } from 'react-router-dom'
import SetupPage from './pages/SetupPage'
import PhoneOrderPage from './pages/PhoneOrderPage'
import KioskPage from './pages/KioskPage'

// 화면 주소
//   /          개발용 첫 화면 (어디로 갈지 고르기)
//   /m         폰 주문 화면 — 설정이 없으면 /m/setup 으로 보냄
//   /m/setup   접근성 설정 화면 (처음 한 번)
//   /kiosk     모의 키오스크 (기본 화면 + 내 방식 QR + 주문번호 표시)
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DevHome />} />
      <Route path="/m" element={<PhoneOrderPage />} />
      <Route path="/m/setup" element={<SetupPage />} />
      <Route path="/kiosk" element={<KioskPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function DevHome() {
  return (
    <main className="page dev-home">
      <h1>내 방식 QR</h1>
      <p className="muted">개발용 첫 화면이에요.</p>
      <nav className="stack">
        <Link className="btn primary" to="/m">폰 주문 화면 (/m)</Link>
        <Link className="btn" to="/m/setup">설정 화면 (/m/setup)</Link>
        <Link className="btn" to="/kiosk">키오스크 화면 (/kiosk)</Link>
      </nav>
    </main>
  )
}
