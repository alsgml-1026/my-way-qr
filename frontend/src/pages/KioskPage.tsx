import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createSession, fetchHost, fetchMenu, getSession, won, type Menu } from '../api'
import { DEFAULT_STORE } from '../visit'

// 모의 카페 키오스크 (PC·태블릿 가로 화면)
// 왼쪽: 흔한 키오스크처럼 글씨가 작고 빽빽한 기본 화면
// 오른쪽: "내 방식으로 주문하기" QR — 찍으면 폰에서 맞춤 화면이 열린다
//
// 흐름: [A] 창구 열기 → QR 표시 → [E] 2초마다 주문 확인 → 완료 표시 → 새 창구
const POLL_MS = 2000
const DONE_SHOW_MS = 10000

export default function KioskPage() {
  const params = new URLSearchParams(location.search)
  const store = params.get('store') || DEFAULT_STORE
  const debug = params.has('debug')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [base, setBase] = useState<string | null>(null) // QR 에 넣을 주소의 앞부분
  const [session, setSession] = useState<string | null>(null)
  const [done, setDone] = useState<{ orderNo: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

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
          if (s.status === 'paid' && s.orderNo != null) setDone({ orderNo: s.orderNo, total: s.total ?? 0 })
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
    const t = window.setTimeout(openSession, DONE_SHOW_MS)
    return () => window.clearTimeout(t)
  }, [done, openSession])

  const qrUrl = base && session ? `${base}/m?store=${encodeURIComponent(store)}&session=${session}` : null

  return (
    <div className="kiosk">
      <section className="kiosk-menu" aria-label="기본 키오스크 화면">
        <header className="kiosk-top">
          <strong>{menu?.store ?? '키오스크'}</strong>
          <span>주문하실 메뉴를 선택해 주세요</span>
        </header>
        <div className="kiosk-tabs">
          {menu?.categories.map((c, i) => (
            <span key={c.id} className={i === 0 ? 'on' : ''}>{c.name}</span>
          ))}
        </div>
        <div className="kiosk-grid">
          {menu?.items.map((it) => (
            <div key={it.id} className="kiosk-item">
              <div className="kiosk-thumb" aria-hidden />
              <div className="kiosk-name">{it.name}</div>
              <div className="kiosk-desc">{it.desc}</div>
              <div className="kiosk-price">{won(it.price)}</div>
            </div>
          ))}
        </div>
      </section>

      <aside className="kiosk-qr" aria-live="polite">
        {done ? (
          <div className="kiosk-done">
            <div className="kiosk-done-label">내 방식 주문 완료</div>
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
