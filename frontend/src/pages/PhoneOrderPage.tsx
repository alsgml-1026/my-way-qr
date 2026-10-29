import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { createOrder, createSession, listStores, requestIntentOrder, requestStt, won, type IntentOrderResult } from '../api'
import { addToCart, loadCart, saveCart } from '../cart'
import { healthAlerts } from '../health'
import { loadProfile, profileAttrs } from '../profile'
import { readUndo } from '../undo'
import { useScreen } from '../useScreen'
import { readVisit } from '../visit'

const CAFE_VOICE_EXAMPLES = [
  '나 당뇨가 있어서 단 건 안 되고 밤에 잠 잘 오는 따뜻한 차 줘',
  '가슴 안 두근거리는 디카페인 커피 시원하게 두 잔 줘',
  '속 편하고 달달한 딸기 우유 음료 하나 줘',
]

const BUNSIK_VOICE_EXAMPLES = [
  '나 혈압이 있어서 덜 짜고 따뜻한 국물 요리 줘',
  '매운 거 못 먹는데 안 맵고 부드러운 떡볶이 줘',
  '새우 알레르기가 있는데 속 편한 김밥 두 줄 포장해 줘',
]

function speakKorean(text: string) {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'ko-KR'
      u.rate = 0.95
      window.speechSynthesis.speak(u)
    }
  } catch {
    /* 음성 합성 미지원 브라우저 무시 */
  }
}

// 폰 주문 화면 (어르신·장애인 친화 다이어트 버전 + AI 한마디 음성 → 메뉴 자동 변환 & 원클릭 주문)
export default function PhoneOrderPage() {
  const { search } = useLocation()
  const visit = useMemo(() => readVisit(search), [search])
  const navigate = useNavigate()
  const profile = loadProfile()
  const { screen, aiState, error } = useScreen(visit.store, profile)
  const cart = loadCart(visit.session)
  const count = cart.reduce((n, l) => n + l.qty, 0)
  const [activeTab, setActiveTab] = useState<string>('전체')

  // AI 한마디 음성·의도 주문 상태 (핵심 기능이므로 기본 펼침)
  const [voiceOpen, setVoiceOpen] = useState(true)
  const [listening, setListening] = useState(false)
  const [utterance, setUtterance] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [orderBusy, setOrderBusy] = useState(false)
  const [voiceErr, setVoiceErr] = useState<string | null>(null)
  const [intentRes, setIntentRes] = useState<IntentOrderResult | null>(null)
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRecRef = useRef<any>(null)

  // 매장 고르기: 키오스크 QR 없이 /m 으로 바로 들어온 경우만 (QR 로 오면 매장이 이미 정해져 있음)
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (visit.session) return
    listStores().then(setStores).catch(() => {}) // 목록을 못 받아도 지금 매장은 그대로 동작
  }, [visit.session])
  const changeStore = (id: string) => {
    if (id === visit.store) return
    saveCart(null, []) // 다른 매장 메뉴가 주문 목록에 섞이지 않게
    setIntentRes(null)
    setUtterance('')
    setActiveTab('전체')
    navigate(`/m?store=${encodeURIComponent(id)}`)
  }

  if (!profile) return <Navigate to="/m/setup" replace />

  const groups = screen?.groups ?? []
  const tabNames = ['전체', ...groups.map((g) => g.title)]
  const visibleGroups = activeTab === '전체' ? groups : groups.filter((g) => g.title === activeTab)
  const hasHealthWatch = profile.watch.length > 0 || profile.allergies.length > 0
  const voiceExamples = visit.store.includes('cafe') ? CAFE_VOICE_EXAMPLES : BUNSIK_VOICE_EXAMPLES

  const runIntentOrder = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setUtterance(trimmed)
    setAiBusy(true)
    setVoiceErr(null)
    setIntentRes(null)
    requestIntentOrder(visit.store, trimmed, profile.watch, profile.allergies)
      .then((res) => {
        setIntentRes(res)
        const q = res.qty ?? 1
        speakKorean(`${res.reason} ${res.itemName} ${q}개, ${res.totalPrice ?? res.unitPrice * q}원입니다. 아래 파란 버튼을 누르시면 바로 주문됩니다.`)
      })
      .catch((e: Error) => setVoiceErr(e.message))
      .finally(() => setAiBusy(false))
  }

  const startWhisperRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      mr.ondataavailable = (e) => chunks.push(e.data)
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
        const reader = new FileReader()
        reader.onloadend = () => {
          const b64 = String(reader.result || '')
          setAiBusy(true)
          requestStt(b64, blob.type)
            .then((r) => runIntentOrder(r.text))
            .catch(() => setAiBusy(false))
        }
        reader.readAsDataURL(blob)
      }
      mediaRecRef.current = mr
      mr.start()
      setListening(true)
    } catch {
      // 마이크 권한이 없거나 PC 데모 환경일 때는 첫 번째 예시 발화로 즉시 시연
      runIntentOrder(voiceExamples[0])
    }
  }

  const toggleMic = async () => {
    if (listening) {
      try {
        speechRecRef.current?.stop()
      } catch {
        /* ignore */
      }
      try {
        if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
          mediaRecRef.current.stop()
        }
      } catch {
        /* ignore */
      }
      setListening(false)
      return
    }

    // 1순위: 브라우저 내장 실시간 음성인식 (Web Speech API)
    const SpeechRec = (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    if (typeof SpeechRec === 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rec: any = new (SpeechRec as any)()
        rec.lang = 'ko-KR'
        rec.interimResults = false
        speechRecRef.current = rec
        setListening(true)
        let handled = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rec.onresult = (ev: any) => {
          const transcript = ev.results?.[0]?.[0]?.transcript || ''
          handled = true
          setListening(false)
          if (transcript) runIntentOrder(transcript)
        }
        rec.onerror = () => {
          setListening(false)
          if (!handled) {
            void startWhisperRecording()
          }
        }
        rec.onend = () => setListening(false)
        rec.start()
        return
      } catch {
        /* Web Speech 시작 실패 시 MediaRecorder + Whisper 폴백 */
      }
    }

    // 2순위 백업: MediaRecorder 녹음 후 백엔드 OpenAI Whisper API (/api/stt) 호출
    await startWhisperRecording()
  }

  // 장바구니에 담고 장바구니 화면으로 이동
  const acceptIntentToCart = () => {
    if (!intentRes) return
    addToCart(visit.session, { id: intentRes.itemId, options: intentRes.options, qty: intentRes.qty ?? 1 })
    navigate('/m/cart')
  }

  // 말 한마디 → 변환된 메뉴로 그 자리에서 즉시 주문(결제 완료)까지 원스톱 처리
  const payIntentImmediately = async () => {
    if (!intentRes) return
    setOrderBusy(true)
    setVoiceErr(null)
    try {
      const activeSession = visit.session ?? (await createSession(visit.store)).session
      const orderLine = { id: intentRes.itemId, options: intentRes.options, qty: intentRes.qty ?? 1 }
      const r = await createOrder(activeSession, [orderLine], {
        channel: 'phone',
        undo: readUndo(visit.session),
        profile: { fontSize: profile.fontSize, easyWords: profile.easyWords },
      })
      saveCart(visit.session, [])
      speakKorean(`주문이 완료되었습니다. 주문 번호는 ${r.orderNo}번입니다.`)
      navigate('/m/done', { replace: true, state: { orderNo: r.orderNo, total: r.total } })
    } catch (e) {
      setVoiceErr(e instanceof Error ? e.message : '주문 처리 중 오류가 발생했어요')
    } finally {
      setOrderBusy(false)
    }
  }

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
          {!visit.session && stores.length > 1 && (
            <nav className="store-pick" aria-label="매장 고르기">
              {stores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`store-pick-btn${s.id === visit.store ? ' active' : ''}`}
                  aria-pressed={s.id === visit.store}
                  onClick={() => changeStore(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </nav>
          )}
          {aiState === 'loading' && (
            <p className="ai-badge loading" role="status">
              쉬운 말 메뉴판으로 바꾸는 중이에요…
            </p>
          )}
        </header>

        {/* 핵심 기능 1: 할머니·할아버지가 메뉴 이름 몰라도 말로 하면 메뉴+옵션으로 자동 변환되어 바로 주문 */}
        <section className="voice-order-box" aria-label="AI 말로 주문하기">
          <button
            type="button"
            className={'voice-trigger-btn' + (voiceOpen ? ' open' : '')}
            onClick={() => setVoiceOpen((v) => !v)}
          >
            <span className="voice-icon">🎤</span>
            <span className="voice-trigger-text">
              <strong>메뉴 이름 몰라도 말로 바로 주문하기 (AI 점원)</strong>
              <small>&ldquo;{voiceExamples[0]}&rdquo; 처럼 편하게 말씀하세요</small>
            </span>
          </button>

          {voiceOpen && (
            <div className="voice-panel">
              <div className="voice-mic-row">
                <button
                  type="button"
                  className={'btn primary voice-mic-btn' + (listening ? ' listening' : '')}
                  onClick={toggleMic}
                >
                  {listening ? '🔴 듣는 중... (다 말씀하셨으면 누르세요)' : '🎙️ 여기를 누르고 점원에게 말하듯 주문하기'}
                </button>
              </div>

              <p className="muted small-hint">마이크로 말씀하시거나 아래 어르신 말씀 예시를 눌러보세요:</p>
              <div className="voice-examples">
                {voiceExamples.map((ex) => (
                  <button key={ex} type="button" className="voice-ex-chip" onClick={() => runIntentOrder(ex)}>
                    &ldquo;{ex}&rdquo;
                  </button>
                ))}
              </div>

              <div className="voice-input-row">
                <input
                  type="text"
                  value={utterance}
                  onChange={(e) => setUtterance(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runIntentOrder(utterance)
                  }}
                  placeholder="예: 찬 커피 안 쓰게 두 잔 줘 / 안 매운 국물 줘"
                  className="voice-text-input"
                />
                <button type="button" className="btn primary" onClick={() => runIntentOrder(utterance)}>
                  메뉴로 변환
                </button>
              </div>

              {aiBusy && <p className="ai-badge loading">🤖 AI 점원이 어르신 말씀을 메뉴와 옵션으로 바꾸고 있어요…</p>}
              {voiceErr && <p className="error" role="alert">{voiceErr}</p>}

              {intentRes && (
                <div className="intent-result-card" role="region" aria-live="polite">
                  <span className="intent-badge">🤖 어르신 말씀 → 맞춤 메뉴·옵션 변환 완료</span>
                  <p className="muted" style={{ margin: '0 0 6px', fontSize: '0.9em' }}>
                    말씀하신 내용: &ldquo;{intentRes.utterance}&rdquo;
                  </p>
                  <p className="intent-reason">{intentRes.reason}</p>
                  <div className="intent-summary-box">
                    <div className="intent-item-title">
                      {intentRes.itemName} {(intentRes.qty ?? 1) > 1 ? `× ${intentRes.qty}개` : ''}{' '}
                      <small>({intentRes.optionSummary})</small>
                    </div>
                    <div className="intent-item-price">
                      {won(intentRes.totalPrice ?? intentRes.unitPrice * (intentRes.qty ?? 1))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button
                      type="button"
                      className="btn primary block intent-accept-btn"
                      disabled={orderBusy}
                      onClick={payIntentImmediately}
                    >
                      {orderBusy
                        ? '주문 처리 중이에요…'
                        : `⚡ 네, 이 메뉴로 바로 주문(결제 완료)하기 →`}
                    </button>
                    <button
                      type="button"
                      className="btn block"
                      disabled={orderBusy}
                      onClick={acceptIntentToCart}
                    >
                      🛒 주문 목록(장바구니)에 담고 다른 메뉴 더 고르기
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

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
