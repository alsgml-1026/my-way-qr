import { useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { won } from '../api'
import { addToCart } from '../cart'
import { HEALTH_NOTE, healthAlerts } from '../health'
import { loadProfile, profileAttrs } from '../profile'
import { useScreen } from '../useScreen'
import { countUndo } from '../undo'
import { readVisit } from '../visit'

// 옵션 고르기 — 한 화면에 질문 하나 (AGENTS.md 3. 옵션 화면이 지킬 약속)
// 질문·선택지 문구는 AI 가 바꾼 것(question, label), 순서는 서버가 정렬해 준 item.options 그대로.
// 질문을 다 고르면 마지막 화면에서 개수를 정하고 주문 목록에 담는다.
export default function ItemOptionsPage() {
  const { itemId } = useParams()
  const { search } = useLocation()
  const visit = useMemo(() => readVisit(search), [search])
  const navigate = useNavigate()
  const profile = loadProfile()
  const { screen, error } = useScreen(visit.store, profile)
  const [step, setStep] = useState(0)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [qty, setQty] = useState(1)

  if (!profile) return <Navigate to="/m/setup" replace />

  const item = screen?.groups.flatMap((g) => g.items).find((i) => i.id === itemId)
  if (screen && !item) return <Navigate to="/m" replace />

  const keys = item?.options ?? []
  const alerts = healthAlerts(item?.health, profile)
  const key = keys[step] as string | undefined // undefined = 질문을 다 골라서 개수 정하는 화면
  const opt = key ? screen?.options[key] : undefined
  const unit =
    (item?.price ?? 0) +
    keys.reduce((sum, k) => sum + (screen?.options[k]?.choices.find((c) => c.id === chosen[k])?.price ?? 0), 0)

  const pick = (choiceId: string) => {
    setChosen((prev) => ({ ...prev, [key!]: choiceId }))
    setStep((s) => s + 1)
  }
  const back = () => {
    countUndo(visit.session) // 사용자 테스트: 되돌리기 횟수
    if (step > 0) setStep((s) => s - 1)
    else navigate('/m')
  }
  const add = () => {
    addToCart(visit.session, { id: item!.id, options: chosen, qty })
    navigate('/m/cart')
  }

  return (
    <div className="app" {...profileAttrs(profile)}>
      <main className="page">
        <button className="btn back" onClick={back}>← {step > 0 ? '이전 질문' : '메뉴로'}</button>

        {error && <p className="error" role="alert">{error}</p>}
        {!item && !error && <p className="muted">불러오는 중이에요…</p>}

        {item && (
          <>
            <header className="option-head">
              <h1>{item.name}</h1>
              {keys.length > 0 && (
                <p className="muted step">
                  {key ? `질문 ${step + 1} / ${keys.length}` : '마지막 단계'}
                </p>
              )}
            </header>

            {opt && (
              <section aria-live="polite">
                <h2 className="question">{opt.question}</h2>
                <ul className="item-list">
                  {opt.choices.map((c) => (
                    <li key={c.id}>
                      <button
                        className={'card item choice-card' + (chosen[key!] === c.id ? ' selected' : '')}
                        onClick={() => pick(c.id)}
                      >
                        <span className="item-name">{c.label}</span>
                        {c.price > 0 && <span className="item-price">{won(c.price)} 더 내요</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!key && (
              <section aria-live="polite">
                <h2 className="question">몇 개 드릴까요?</h2>
                <div className="qty-row">
                  <button className="btn qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="하나 빼기">−</button>
                  <span className="qty-num" aria-live="polite">{qty}개</span>
                  <button className="btn qty-btn" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="하나 더하기">+</button>
                </div>
                {keys.length > 0 && (
                  <ul className="summary">
                    {keys.map((k) => (
                      <li key={k}>
                        {/* 원래 옵션 이름(사이즈·샷 추가)은 어려운 말이라 빼고, AI 가 바꾼 선택지만 보여 준다 */}
                        {screen?.options[k]?.choices.find((c) => c.id === chosen[k])?.label}
                      </li>
                    ))}
                  </ul>
                )}
                {/* 건강 표시: 담기 전에 한 번 더 알려 준다 (막지는 않음) */}
                {alerts.length > 0 && (
                  <div className="health-box" role="note">
                    <strong>확인해 주세요</strong>
                    <ul>
                      {alerts.map((a) => (
                        <li key={a.key}>⚠ {a.text}</li>
                      ))}
                    </ul>
                    <small>{HEALTH_NOTE} 기본 선택 기준이에요.</small>
                  </div>
                )}
                {profile.showKcal && item.health?.kcal != null && (
                  <p className="muted">{item.health.kcal.toLocaleString('ko-KR')}kcal (기본 선택 기준)</p>
                )}
                <p className="total-line">{won(unit * qty)}</p>
                <button className="btn primary block" onClick={add}>주문 목록에 담기</button>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
