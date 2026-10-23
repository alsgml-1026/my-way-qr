import { Navigate, useLocation } from 'react-router-dom'
import { won } from '../api'
import { loadProfile, profileAttrs } from '../profile'

// 주문 완료 — 키오스크 화면에도 같은 주문번호가 뜬다 (키오스크가 2초마다 확인)
export default function DonePage() {
  const { state } = useLocation() as { state: { orderNo: number; total: number } | null }
  const profile = loadProfile()

  if (!profile) return <Navigate to="/m/setup" replace />
  if (!state) return <Navigate to="/m" replace />

  return (
    <div className="app" {...profileAttrs(profile)}>
      <main className="page done">
        <p className="done-label">주문이 끝났어요</p>
        <p className="done-no">
          {state.orderNo}
          <small>번</small>
        </p>
        <p className="total-line">{won(state.total)} 결제 완료</p>
        <p className="lead">키오스크 화면에도 같은 번호가 떠요.<br />메뉴가 준비되면 이 번호로 불러 드릴게요.</p>
      </main>
    </div>
  )
}
