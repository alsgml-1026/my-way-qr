import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { createOrder, createSession, won, type OrderLine } from '../api'
import { loadCart, saveCart } from '../cart'
import { loadProfile, profileAttrs } from '../profile'
import { useScreen } from '../useScreen'
import { countUndo, readUndo } from '../undo'
import { readVisit } from '../visit'

// 주문 목록 → 결제(목업) → 완료 화면
// 여기 보이는 합계는 안내용. 실제 금액은 서버가 원본 메뉴로 다시 계산한다 (POST /api/orders).
export default function CartPage() {
  const { search } = useLocation()
  const visit = useMemo(() => readVisit(search), [search])
  const navigate = useNavigate()
  const profile = loadProfile()
  const { screen } = useScreen(visit.store, profile)
  const [lines, setLines] = useState<OrderLine[]>(() => loadCart(visit.session))
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!profile) return <Navigate to="/m/setup" replace />

  const items = screen?.groups.flatMap((g) => g.items) ?? []
  const view = lines.map((l) => {
    const item = items.find((i) => i.id === l.id)
    const picked = (item?.options ?? []).map((k) => screen?.options[k]?.choices.find((c) => c.id === l.options[k]))
    const unit = (item?.price ?? 0) + picked.reduce((s, c) => s + (c?.price ?? 0), 0)
    return { line: l, name: item?.name ?? l.id, labels: picked.map((c) => c?.label).filter(Boolean), amount: unit * l.qty }
  })
  const total = view.reduce((s, v) => s + v.amount, 0)

  const update = (next: OrderLine[]) => {
    setLines(next)
    saveCart(visit.session, next)
  }
  const changeQty = (idx: number, d: number) => {
    if (d < 0) countUndo(visit.session) // 사용자 테스트: 되돌리기 횟수
    update(lines.map((l, i) => (i === idx ? { ...l, qty: Math.min(20, Math.max(1, l.qty + d)) } : l)))
  }
  const remove = (idx: number) => {
    countUndo(visit.session)
    update(lines.filter((_, i) => i !== idx))
  }

  const pay = async () => {
    setPaying(true)
    setError(null)
    try {
      // 키오스크 QR 로 들어왔으면 해당 창구(visit.session)로 결제해 키오스크 화면에 주문번호를 띄우고,
      // /m 또는 /lab 에서 바로 들어와 창구가 없을 때는 즉시 새 창구를 열어 결제가 막히지 않게 한다.
      const activeSession = visit.session ?? (await createSession(visit.store)).session
      const r = await createOrder(activeSession, lines, {
        channel: 'phone',
        undo: readUndo(visit.session),
        profile: { fontSize: profile.fontSize, easyWords: profile.easyWords },
      })
      saveCart(visit.session, [])
      navigate('/m/done', { replace: true, state: { orderNo: r.orderNo, total: r.total } })
    } catch (e) {
      setError(e instanceof Error ? e.message : '결제 처리 중 오류가 발생했어요')
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="app" {...profileAttrs(profile)}>
      <main className="page">
        <Link className="btn back" to="/m">← 메뉴 더 고르기</Link>
        <h1>주문 목록</h1>

        {!lines.length && <p className="muted">아직 고른 메뉴가 없어요.</p>}

        <ul className="item-list">
          {view.map((v, idx) => (
            <li key={idx} className="card">
              <span className="item-name">{v.name}</span>
              {v.labels.length > 0 && <span className="item-desc">{v.labels.join(' · ')}</span>}
              <div className="qty-row small-row">
                <button className="btn qty-btn" onClick={() => changeQty(idx, -1)} aria-label={`${v.name} 하나 빼기`}>−</button>
                <span className="qty-num">{v.line.qty}개</span>
                <button className="btn qty-btn" onClick={() => changeQty(idx, 1)} aria-label={`${v.name} 하나 더하기`}>+</button>
                <button className="btn" onClick={() => remove(idx)}>빼기</button>
              </div>
              <span className="item-price">{won(v.amount)}</span>
            </li>
          ))}
        </ul>

        {lines.length > 0 && (
          <section className="pay-box">
            <p className="total-line">모두 {won(total)}</p>
            <button className="btn primary block" onClick={pay} disabled={paying}>
              {paying ? '결제하는 중이에요…' : `${won(total)} 결제하기`}
            </button>
            <p className="muted small">시연용 결제예요. 실제로 돈이 나가지 않아요.</p>
            {error && <p className="error" role="alert">{error}</p>}
          </section>
        )}
      </main>
    </div>
  )
}
