import { useMemo } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { won } from '../api'
import { loadCart } from '../cart'
import { healthAlerts } from '../health'
import { describeProfile, loadProfile, profileAttrs } from '../profile'
import { useScreen } from '../useScreen'
import { readVisit } from '../visit'

// 폰 주문 화면
// 1) 원본 메뉴를 먼저 보여 주고 (바로 주문 가능)
// 2) AI 맞춤 화면이 도착하면 바꿔 끼운다 (AI 가 실패하면 원본 그대로)
// 메뉴를 누르면 → 옵션(한 화면 한 질문, ItemOptionsPage) → 주문 목록(CartPage) → 완료(DonePage)
export default function PhoneOrderPage() {
  // QR 주소의 매장·창구를 먼저 저장해 둔다 (설정 화면을 다녀와도 유지)
  const { search } = useLocation()
  const visit = useMemo(() => readVisit(search), [search])
  const navigate = useNavigate()
  const profile = loadProfile()
  const { screen, aiState, error } = useScreen(visit.store, profile)
  const cart = loadCart(visit.session)
  const count = cart.reduce((n, l) => n + l.qty, 0)

  if (!profile) return <Navigate to="/m/setup" replace />

  const groups = screen?.groups ?? []

  return (
    <div className="app" {...profileAttrs(profile)}>
      <main className="page">
        <header className="order-head">
          <h1>{screen?.store ?? '메뉴'}</h1>
          <div className="profile-bar">
            <span>내 설정: {describeProfile(profile).join(' · ')}</span>
            <Link to="/m/setup" className="link">바꾸기</Link>
          </div>
          {visit.session && <p className="muted small">키오스크 창구 {visit.session}에 연결됐어요</p>}
          <p className={'ai-badge ' + aiState} role="status">
            {aiState === 'loading' && '내 설정에 맞게 화면을 바꾸는 중이에요…'}
            {aiState === 'done' && '✓ 내 설정에 맞게 바꾼 화면이에요'}
            {aiState === 'failed' && '원래 메뉴 화면이에요 (바로 주문할 수 있어요)'}
          </p>
        </header>

        {error && <p className="error" role="alert">{error} — 서버가 켜져 있는지 확인해 주세요.</p>}
        {!groups.length && !error && <p className="muted">메뉴를 불러오는 중이에요…</p>}

        {groups.map((g) => (
          <section key={g.title} className="category">
            <h2>{g.title}</h2>
            <ul className="item-list">
              {g.items.map((it) => {
                const alerts = healthAlerts(it.health, profile)
                const kcal = profile.showKcal ? it.health?.kcal : null
                return (
                  <li key={it.id}>
                    <button className="card item" onClick={() => navigate(`/m/item/${encodeURIComponent(it.id)}`)}>
                      <span className="item-name">{it.name}</span>
                      <span className="item-desc">{it.desc}</span>
                      {(alerts.length > 0 || kcal != null) && (
                        <span className="health-row">
                          {alerts.map((a) => (
                            <span key={a.key} className="health-tag warn">⚠ {a.text}</span>
                          ))}
                          {kcal != null && <span className="health-tag">{kcal.toLocaleString('ko-KR')}kcal</span>}
                        </span>
                      )}
                      <span className="item-price">{won(it.price)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {count > 0 && (
          <Link className="bottom-bar" to="/m/cart">
            <span>주문할 메뉴 {count}개</span>
            <span>주문 목록 보기 →</span>
          </Link>
        )}
      </main>
    </div>
  )
}
