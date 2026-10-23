import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  createOrder,
  createSession,
  fetchHost,
  fetchMenu,
  fetchTestResults,
  getSession,
  startTest,
  won,
  type Menu,
  type MenuItem,
  type OrderLine,
  type TestResult,
  type TestState,
} from '../api'
import { DEFAULT_STORE } from '../visit'

// 모의 카페 키오스크 (PC·태블릿 가로 화면)
// 왼쪽: 흔한 키오스크처럼 글씨가 작고 빽빽한 기본 화면 — 실제로 주문도 된다 (사용자 테스트 '기존 방식' 비교용)
// 오른쪽: "내 방식으로 주문하기" QR — 찍으면 폰에서 맞춤 화면이 열린다
//
// 흐름: [A] 창구 열기 → QR 표시 → [E] 2초마다 주문 확인 → 완료 표시 → 새 창구
// /kiosk?test  사용자 테스트: 진행자가 참가자 번호를 넣고 '시작' → 결제까지 걸린 시간을 서버가 기록
// /kiosk?debug QR 주소 글자 표시
// /kiosk?store=modui-bunsik  다른 매장 (위쪽 '매장' 목록으로도 바꿀 수 있음)
const POLL_MS = 2000
const DONE_SHOW_MS = 10000
const TEST_DONE_SHOW_MS = 30000 // 테스트 때는 진행자가 결과를 볼 수 있게 더 오래

type Done = { orderNo: number; total: number; channel: 'phone' | 'kiosk' | null; seconds: number | null }
type Picking = { item: MenuItem; chosen: Record<string, string>; qty: number }

// 서버에 있는 매장 목록 (매장 파일만 추가하면 여기 자동으로 나타난다)
async function listStores(): Promise<{ id: string; name: string }[]> {
  const res = await fetch('/api/health')
  const { stores } = (await res.json()) as { stores: Record<string, string> }
  return Promise.all(Object.keys(stores).map(async (id) => ({ id, name: (await fetchMenu(id)).store })))
}

function changeStore(id: string) {
  const q = new URLSearchParams(location.search)
  q.set('store', id)
  location.search = q.toString() // 새 매장으로 다시 열기 (창구도 새로 열림)
}

export default function KioskPage() {
  const params = new URLSearchParams(location.search)
  const store = params.get('store') || DEFAULT_STORE
  const debug = params.has('debug')
  const testMode = params.has('test')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [base, setBase] = useState<string | null>(null) // QR 에 넣을 주소의 앞부분
  const [session, setSession] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  // 기존 키오스크 화면 주문 상태
  const [tab, setTab] = useState<string | null>(null)
  const [picking, setPicking] = useState<Picking | null>(null)
  const [cart, setCart] = useState<OrderLine[]>([])
  const [paying, setPaying] = useState(false)
  const undo = useRef(0) // 사용자 테스트: 취소·삭제 누른 횟수

  // 사용자 테스트 상태
  const [participant, setParticipant] = useState('P1')
  const [test, setTest] = useState<TestState | null>(null)
  const [results, setResults] = useState<TestResult[]>([])
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    listStores().then(setStores).catch(() => {}) // 목록을 못 받아도 지금 매장은 그대로 동작
  }, [])

  // QR 주소: PC 에서 localhost 로 열었으면 폰이 접속할 수 있게 내부망 IP 로 바꾼다.
  useEffect(() => {
    const local = ['localhost', '127.0.0.1'].includes(location.hostname)
    if (!local) {
      setBase(location.origin)
      return
    }
    fetchHost()
      .then(({ ip }) => setBase(`${location.protocol}//${ip}:${location.port}`))
      .catch(() => setBase(location.origin))
  }, [])

  const openSession = useCallback(() => {
    setDone(null)
    setSession(null)
    setTest(null)
    setCart([])
    setPicking(null)
    undo.current = 0
    createSession(store)
      .then((r) => {
        setSession(r.session)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [store])

  useEffect(() => {
    fetchMenu(store).then(setMenu).catch((e: Error) => setError(e.message))
    openSession()
  }, [store, openSession])

  // [E] 주문이 들어왔는지 2초마다 확인
  useEffect(() => {
    if (!session || done) return
    timer.current = window.setInterval(() => {
      getSession(session)
        .then((s) => {
          if (s.status === 'paid' && s.orderNo != null)
            setDone({ orderNo: s.orderNo, total: s.total ?? 0, channel: s.channel, seconds: s.seconds })
        })
        .catch(() => openSession()) // 서버 재시작 등으로 창구가 사라지면 새로 연다
    }, POLL_MS)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [session, done, openSession])

  // 완료 화면을 잠시 보여 준 뒤 다음 손님을 위해 새 창구
  useEffect(() => {
    if (!done) return
    if (testMode) fetchTestResults().then(setResults).catch(() => {})
    const t = window.setTimeout(openSession, testMode ? TEST_DONE_SHOW_MS : DONE_SHOW_MS)
    return () => window.clearTimeout(t)
  }, [done, openSession, testMode])

  useEffect(() => {
    if (testMode) fetchTestResults().then(setResults).catch(() => {})
  }, [testMode])

  // ───── 기존 키오스크 화면 주문 ─────
  const items = menu?.items.filter((it) => !tab || it.category === tab) ?? []
  const unitPrice = (it: MenuItem, chosen: Record<string, string>) =>
    it.price +
    it.options.reduce((sum, k) => sum + (menu?.options[k]?.choices.find((c) => c.id === chosen[k])?.price ?? 0), 0)

  const openItem = (it: MenuItem) => {
    if (!menu || done) return
    // 흔한 키오스크처럼 첫 번째 선택지가 미리 골라져 있다
    const chosen = Object.fromEntries(it.options.map((k) => [k, menu.options[k].choices[0].id]))
    setPicking({ item: it, chosen, qty: 1 })
  }
  const cancelPick = () => {
    undo.current += 1
    setPicking(null)
  }
  const addPick = () => {
    if (!picking) return
    setCart((c) => [...c, { id: picking.item.id, options: picking.chosen, qty: picking.qty }])
    setPicking(null)
  }
  const removeLine = (idx: number) => {
    undo.current += 1
    setCart((c) => c.filter((_, i) => i !== idx))
  }
  const cartTotal = cart.reduce((sum, l) => {
    const it = menu?.items.find((i) => i.id === l.id)
    return sum + (it ? unitPrice(it, l.options) * l.qty : 0)
  }, 0)

  const pay = () => {
    if (!session || !cart.length) return
    setPaying(true)
    createOrder(session, cart, { channel: 'kiosk', undo: undo.current })
      .then((r) => {
        setCart([])
        setDone({ orderNo: r.orderNo, total: r.total, channel: 'kiosk', seconds: r.seconds })
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setPaying(false))
  }

  // ───── 사용자 테스트 ─────
  const begin = () => {
    if (!session || !participant.trim()) return
    startTest(session, participant.trim())
      .then((t) => setTest({ participant: t.participant, startedAt: t.startedAt }))
      .catch((e: Error) => setError(e.message))
  }

  const qrUrl = base && session ? `${base}/m?store=${encodeURIComponent(store)}&session=${session}` : null

  return (
    <div className="kiosk">
      <section className="kiosk-menu" aria-label="기본 키오스크 화면">
        <header className="kiosk-top">
          <strong>{menu?.store ?? '키오스크'}</strong>
          <span>주문하실 메뉴를 선택해 주세요</span>
          {stores.length > 1 && (
            <label className="kiosk-store-pick">
              매장{' '}
              <select value={store} onChange={(e) => changeStore(e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
        </header>
        <div className="kiosk-tabs">
          <button className={tab === null ? 'on' : ''} onClick={() => setTab(null)}>전체</button>
          {menu?.categories.map((c) => (
            <button key={c.id} className={tab === c.id ? 'on' : ''} onClick={() => setTab(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="kiosk-grid">
          {items.map((it) => (
            <button key={it.id} className="kiosk-item" onClick={() => openItem(it)}>
              <div className="kiosk-thumb" aria-hidden />
              <div className="kiosk-name">{it.name}</div>
              <div className="kiosk-desc">{it.desc}</div>
              <div className="kiosk-price">{won(it.price)}</div>
            </button>
          ))}
        </div>

        <footer className="kiosk-cart">
          <div className="kiosk-cart-lines">
            {!cart.length && <span className="kiosk-cart-empty">선택한 상품이 없습니다</span>}
            {cart.map((l, idx) => {
              const it = menu?.items.find((i) => i.id === l.id)
              const opts = (it?.options ?? []).map((k) => menu?.options[k]?.choices.find((c) => c.id === l.options[k])?.name)
              return (
                <div key={idx} className="kiosk-cart-line">
                  <span>{it?.name} ({opts.join('/')}) x{l.qty}</span>
                  <button onClick={() => removeLine(idx)}>삭제</button>
                </div>
              )
            })}
          </div>
          <div className="kiosk-cart-pay">
            <span>총 {won(cartTotal)}</span>
            <button disabled={!cart.length || paying || !session || !!done} onClick={pay}>
              {paying ? '처리중' : '결제하기'}
            </button>
          </div>
        </footer>

        {picking && menu && (
          <div className="kiosk-modal" role="dialog" aria-label={`${picking.item.name} 옵션`}>
            <div className="kiosk-modal-box">
              <div className="kiosk-modal-head">
                <strong>{picking.item.name}</strong>
                <span>{won(unitPrice(picking.item, picking.chosen) * picking.qty)}</span>
              </div>
              {picking.item.options.map((k) => (
                <div key={k} className="kiosk-opt">
                  <div className="kiosk-opt-name">{menu.options[k].name}</div>
                  <div className="kiosk-opt-choices">
                    {menu.options[k].choices.map((c) => (
                      <button
                        key={c.id}
                        className={picking.chosen[k] === c.id ? 'on' : ''}
                        onClick={() => setPicking({ ...picking, chosen: { ...picking.chosen, [k]: c.id } })}
                      >
                        {c.name}
                        {c.price > 0 && <small> +{c.price}</small>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="kiosk-opt">
                <div className="kiosk-opt-name">수량</div>
                <div className="kiosk-opt-choices">
                  <button onClick={() => setPicking({ ...picking, qty: Math.max(1, picking.qty - 1) })}>-</button>
                  <span className="kiosk-qty">{picking.qty}</span>
                  <button onClick={() => setPicking({ ...picking, qty: Math.min(20, picking.qty + 1) })}>+</button>
                </div>
              </div>
              <div className="kiosk-modal-btns">
                <button onClick={cancelPick}>취소</button>
                <button className="primary" onClick={addPick}>담기</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <aside className="kiosk-qr" aria-live="polite">
        {testMode && (
          <TestPanel
            participant={participant}
            setParticipant={setParticipant}
            test={test}
            done={done}
            canStart={!!session && !done}
            onStart={begin}
            results={results}
          />
        )}
        {done ? (
          <div className="kiosk-done">
            <div className="kiosk-done-label">{done.channel === 'kiosk' ? '주문 완료' : '내 방식 주문 완료'}</div>
            <div className="kiosk-done-no">{done.orderNo}<small>번</small></div>
            <div className="kiosk-done-total">{won(done.total)} 결제 완료</div>
            <p>음료가 준비되면 번호로 불러 드릴게요.</p>
          </div>
        ) : (
          <>
            <h2>글씨가 작아 불편하세요?</h2>
            <p className="kiosk-qr-lead">휴대폰 카메라로 찍으면<br /><b>내 방식 화면</b>으로 주문할 수 있어요</p>
            <div className="kiosk-qr-box">
              {qrUrl ? <QRCodeSVG value={qrUrl} size={260} marginSize={2} /> : <div className="kiosk-qr-wait">준비 중…</div>}
            </div>
            <ul className="kiosk-qr-points">
              <li>큰 글씨 · 큰 버튼</li>
              <li>쉬운 설명</li>
              <li>내 휴대폰으로 천천히</li>
            </ul>
            {/* QR 주소(내부 IP 포함)는 영상·사진에 찍히지 않게 /kiosk?debug 일 때만 보여 준다 */}
            {qrUrl && debug && <code className="kiosk-qr-url">{qrUrl}</code>}
            {session && <div className="kiosk-session">창구 {session}</div>}
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </aside>
    </div>
  )
}

// 진행자용 칸 (/kiosk?test 일 때만): 참가자 번호 → 시작 → 걸린 시간 → 최근 기록
function TestPanel(props: {
  participant: string
  setParticipant: (v: string) => void
  test: TestState | null
  done: Done | null
  canStart: boolean
  onStart: () => void
  results: TestResult[]
}) {
  const { participant, setParticipant, test, done, canStart, onStart, results } = props
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!test || done) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [test, done])

  // 화면 표시용 경과 시간 (기록은 서버 시계로 따로 잰다)
  const elapsed = test && !done ? Math.max(0, Math.floor(now / 1000 - test.startedAt)) : null

  return (
    <div className="test-panel">
      <div className="test-row">
        <label>
          참가자 <input value={participant} onChange={(e) => setParticipant(e.target.value)} maxLength={20} disabled={!!test} />
        </label>
        {!test && (
          <button onClick={onStart} disabled={!canStart}>▶ 시작</button>
        )}
        {elapsed != null && <span className="test-clock">{elapsed}초</span>}
      </div>
      {done && done.seconds != null && (
        <p className="test-result">
          {done.channel === 'kiosk' ? '기존 키오스크' : '내 방식 QR'} · <b>{done.seconds}초</b> 기록됨
        </p>
      )}
      {done && done.seconds == null && <p className="test-result">시작을 누르지 않아 시간은 기록되지 않았어요</p>}
      {results.length > 0 && (
        <table className="test-table">
          <thead>
            <tr><th>참가자</th><th>방식</th><th>초</th><th>되돌리기</th></tr>
          </thead>
          <tbody>
            {results.slice(0, 6).map((r, i) => (
              <tr key={i}><td>{r.참가자}</td><td>{r.방식}</td><td>{r.걸린초}</td><td>{r.되돌리기}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
