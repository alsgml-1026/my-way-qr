import { Link, Navigate, Route, Routes } from 'react-router-dom'
import SetupPage from './pages/SetupPage'
import PhoneOrderPage from './pages/PhoneOrderPage'

// 화면 주소
//   /          개발용 첫 화면 (어디로 갈지 고르기)
//   /m         폰 주문 화면 — 설정이 없으면 /m/setup 으로 보냄
//   /m/setup   접근성 설정 화면 (처음 한 번)
//   /kiosk     키오스크 QR 화면 (10/21 작업 예정)
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DevHome />} />
      <Route path="/m" element={<PhoneOrderPage />} />
      <Route path="/m/setup" element={<SetupPage />} />
      <Route path="/kiosk" element={<ComingSoon what="키오스크 QR 화면" />} />
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

function ComingSoon({ what }: { what: string }) {
  return (
    <main className="page">
      <h1>{what}</h1>
      <p className="muted">다음 단계에서 만들 예정이에요.</p>
      <Link className="btn" to="/">처음으로</Link>
    </main>
  )
}
