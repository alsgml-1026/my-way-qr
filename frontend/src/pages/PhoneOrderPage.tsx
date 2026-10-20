import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { fetchMenu, won, type Menu } from '../api'
import { describeProfile, loadProfile, profileAttrs } from '../profile'
import { readVisit } from '../visit'

// 폰 주문 화면 (오늘 버전: 설정에 맞춰 크기·색이 바뀌는 메뉴 목록)
// 다음 단계(10/21): AI 화면 변환 결과 적용, 옵션 → 장바구니 → 목업 결제
export default function PhoneOrderPage() {
  // QR 주소의 매장·창구를 먼저 저장해 둔다 (설정 화면을 다녀와도 유지)
  const { search } = useLocation()
  const visit = useMemo(() => readVisit(search), [search])
  const profile = loadProfile()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    fetchMenu(visit.store).then(setMenu).catch((e: Error) => setError(e.message))
  }, [visit.store])

  if (!profile) return <Navigate to="/m/setup" replace />

  return (
    <div className="app" {...profileAttrs(profile)}>
      <main className="page">
        <header className="order-head">
          <h1>{menu?.store ?? '메뉴'}</h1>
          <div className="profile-bar">
            <span>내 설정: {describeProfile(profile).join(' · ')}</span>
            <Link to="/m/setup" className="link">바꾸기</Link>
          </div>
          {visit.session && <p className="muted small">키오스크 창구 {visit.session}에 연결됐어요</p>}
        </header>

        {error && <p className="error" role="alert">{error} — 서버가 켜져 있는지 확인해 주세요.</p>}
        {!menu && !error && <p className="muted">메뉴를 불러오는 중이에요…</p>}

        {menu?.categories.map((cat) => (
          <section key={cat.id} className="category">
            <h2>{cat.name}</h2>
            <ul className="item-list">
              {menu.items
                .filter((it) => it.category === cat.id)
                .map((it) => (
                  <li key={it.id}>
                    <button
                      className={'card item' + (picked === it.id ? ' selected' : '')}
                      onClick={() => setPicked(it.id)}
                    >
                      <span className="item-name">{it.name}</span>
                      <span className="item-desc">{it.desc}</span>
                      <span className="item-price">{won(it.price)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}

        {picked && (
          <div className="bottom-bar" role="status">
            <span>{menu?.items.find((i) => i.id === picked)?.name} 선택됨</span>
            <span className="muted">(옵션·결제는 다음 단계)</span>
          </div>
        )}
      </main>
    </div>
  )
}
