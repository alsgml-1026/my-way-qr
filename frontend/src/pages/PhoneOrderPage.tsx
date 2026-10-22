import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { fetchMenu, transformMenu, won, type Menu, type Screen, type ScreenItem } from '../api'
import { describeProfile, loadProfile, profileAttrs } from '../profile'
import { readVisit } from '../visit'

// 폰 주문 화면
// 1) 원본 메뉴를 먼저 보여 주고 (바로 주문 가능)
// 2) AI 맞춤 화면이 도착하면 바꿔 끼운다 (AI 가 실패하면 원본 그대로)
// 다음 단계(대리님): 메뉴 선택 → 옵션(한 화면 한 질문) → 장바구니 → 목업 결제
export default function PhoneOrderPage() {
  // QR 주소의 매장·창구를 먼저 저장해 둔다 (설정 화면을 다녀와도 유지)
  const { search } = useLocation()
  const visit = useMemo(() => readVisit(search), [search])
  const profile = loadProfile()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [screen, setScreen] = useState<Screen | null>(null)
  const [aiState, setAiState] = useState<'loading' | 'done' | 'failed'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const fontSize = profile?.fontSize
  const easyWords = profile?.easyWords

  useEffect(() => {
    fetchMenu(visit.store).then(setMenu).catch((e: Error) => setError(e.message))
  }, [visit.store])

  useEffect(() => {
    if (!fontSize || easyWords === undefined) return
    setAiState('loading')
    transformMenu(visit.store, { fontSize, easyWords })
      .then((s) => {
        setScreen(s)
        setAiState(s.source === 'original' ? 'failed' : 'done')
      })
      .catch(() => setAiState('failed'))
  }, [visit.store, fontSize, easyWords])

  if (!profile) return <Navigate to="/m/setup" replace />

  // AI 화면이 있으면 그걸, 없으면 원본 메뉴를 같은 모양으로 바꿔서 보여 준다
  const groups: { title: string; items: ScreenItem[] }[] =
    screen?.groups ??
    (menu
      ? menu.categories.map((c) => ({
          title: c.name,
          items: menu.items
            .filter((i) => i.category === c.id)
            .map((i) => ({ id: i.id, name: i.name, price: i.price, desc: i.desc, originalDesc: i.desc, options: i.options })),
        }))
      : [])
  const pickedItem = groups.flatMap((g) => g.items).find((i) => i.id === picked)

  return (
    <div className="app" {...profileAttrs(profile)}>
      <main className="page">
        <header className="order-head">
          <h1>{screen?.store ?? menu?.store ?? '메뉴'}</h1>
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
              {g.items.map((it) => (
                <li key={it.id}>
                  <button
                    className={'card item' + (picked === it.id ? ' selected' : '')}
                    onClick={() => setPicked(it.id)}
                  >
                    <span className="item-name">{it.name}</span>
                    <span className="item-desc">{it.desc}</span>
                    {picked === it.id && it.desc !== it.originalDesc && (
                      <span className="item-orig">원래 설명: {it.originalDesc}</span>
                    )}
                    <span className="item-price">{won(it.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {pickedItem && (
          <div className="bottom-bar" role="status">
            <span>{pickedItem.name} 선택됨</span>
            <span className="muted">(옵션·결제는 다음 단계)</span>
          </div>
        )}
      </main>
    </div>
  )
}
