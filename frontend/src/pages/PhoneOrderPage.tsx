import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { won } from '../api'
import { loadCart } from '../cart'
import { healthAlerts } from '../health'
import { loadProfile, profileAttrs } from '../profile'
import { useScreen } from '../useScreen'
import { readVisit } from '../visit'

// 폰 주문 화면 (어르신·장애인 친화 다이어트 버전)
// - 상단 잡다한 시스템 배너를 없애고 큼직한 카테고리 탭 제공
// - 각 메뉴 카드는 [신호등 배지 1개 + 왕큰 메뉴명/가격 + 쉬운 말 한 줄 설명] 3요소로 압축
export default function PhoneOrderPage() {
  const { search } = useLocation()
  const visit = useMemo(() => readVisit(search), [search])
  const navigate = useNavigate()
  const profile = loadProfile()
  const { screen, aiState, error } = useScreen(visit.store, profile)
  const cart = loadCart(visit.session)
  const count = cart.reduce((n, l) => n + l.qty, 0)
  const [activeTab, setActiveTab] = useState<string>('전체')

  if (!profile) return <Navigate to="/m/setup" replace />

  const groups = screen?.groups ?? []
  const tabNames = ['전체', ...groups.map((g) => g.title)]
  const visibleGroups = activeTab === '전체' ? groups : groups.filter((g) => g.title === activeTab)
  const hasHealthWatch = profile.watch.length > 0 || profile.allergies.length > 0

  return (
    <div className="app" {...profileAttrs(profile)}>
      <main className="page">
        <header className="order-head clean-head">
          <div className="order-title-row">
            <h1>{screen?.store ?? '메뉴'}</h1>
            <Link to="/m/setup" className="btn setting-btn">
              글씨·건강 설정
            </Link>
          </div>
          {aiState === 'loading' && (
            <p className="ai-badge loading" role="status">
              쉬운 말 메뉴판으로 바꾸는 중이에요…
            </p>
          )}
        </header>

        {groups.length > 1 && (
          <nav className="cat-tabs" aria-label="메뉴 종류">
            {tabNames.map((t) => (
              <button
                key={t}
                type="button"
                className={'cat-tab' + (activeTab === t ? ' active' : '')}
                onClick={() => setActiveTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
        )}

        {error && <p className="error" role="alert">{error} — 서버가 켜져 있는지 확인해 주세요.</p>}
        {!groups.length && !error && <p className="muted">메뉴를 불러오는 중이에요…</p>}

        {visibleGroups.map((g) => (
          <section key={g.title} className="category">
            {activeTab === '전체' && <h2 className="cat-heading">{g.title}</h2>}
            <ul className="item-list">
              {g.items.map((it) => {
                const alerts = healthAlerts(it.health, profile)
                const kcal = profile.showKcal && it.health?.kcal != null ? `${it.health.kcal.toLocaleString('ko-KR')}kcal` : null
                const isWarn = alerts.length > 0

                // 배지 여러 개를 신호등 배지 딱 1줄로 합침
                let badgeText = ''
                if (isWarn) {
                  const alertSummary = alerts.map((a) => a.text).join(' · ')
                  badgeText = kcal ? `⚠️ ${alertSummary} · ${kcal}` : `⚠️ ${alertSummary}`
                } else if (hasHealthWatch) {
                  badgeText = kcal ? `● 안심 (주의 성분 없음) · ${kcal}` : '● 안심 (주의 성분 없음)'
                } else if (kcal) {
                  badgeText = kcal
                }

                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      className={'card item clean-item' + (isWarn ? ' item-warn-border' : '')}
                      onClick={() => navigate(`/m/item/${encodeURIComponent(it.id)}`)}
                    >
                      {badgeText && (
                        <span className={'signal-badge ' + (isWarn ? 'warn' : hasHealthWatch ? 'safe' : 'neutral')}>
                          {badgeText}
                        </span>
                      )}
                      <div className="item-main-row">
                        <span className="item-name">{it.name}</span>
                        <span className="item-price">{won(it.price)}</span>
                      </div>
                      {it.desc && <span className="item-desc-easy">{it.desc}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {count > 0 && (
          <Link className="bottom-bar" to="/m/cart">
            <span>담은 메뉴 {count}개</span>
            <span>주문하기 →</span>
          </Link>
        )}
      </main>
    </div>
  )
}

