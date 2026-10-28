import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchFeatures } from '../api'
import { ALLERGEN_CHOICES, WATCH_CHOICES, type Watch } from '../health'
import { DEFAULT_PROFILE, loadProfile, profileAttrs, saveProfile, type FontSize, type Profile } from '../profile'

// ATM 카드식 2단계 접근성·건강 설정 화면
// 한 화면에 큰 질문 하나씩만 보여 주어 어르신·장애인도 헤매지 않고 바로 고를 수 있다.
export default function SetupPage() {
  const navigate = useNavigate()
  const [p, setP] = useState<Profile>(() => loadProfile() ?? {
    ...DEFAULT_PROFILE,
    fontSize: 'xlarge',
    bigButtons: true,
    easyWords: true,
    showKcal: true,
  })
  const [step, setStep] = useState<1 | 2>(1)
  const [healthOn, setHealthOn] = useState(true)

  useEffect(() => {
    fetchFeatures()
      .then((f) => setHealthOn(f.health))
      .catch(() => setHealthOn(true))
  }, [])

  const selectFontPreset = (fontSize: FontSize, easyWords: boolean, bigButtons: boolean) => {
    const next: Profile = { ...p, fontSize, easyWords, bigButtons }
    setP(next)
    if (healthOn) {
      setStep(2)
    } else {
      saveProfile(next)
      navigate('/m')
    }
  }

  const toggleWatch = (id: Watch) => {
    setP((prev) => {
      const exists = prev.watch.includes(id)
      return { ...prev, watch: exists ? prev.watch.filter((x) => x !== id) : [...prev.watch, id] }
    })
  }

  const toggleAllergen = (id: string) => {
    setP((prev) => {
      const exists = prev.allergies.includes(id)
      return { ...prev, allergies: exists ? prev.allergies.filter((x) => x !== id) : [...prev.allergies, id] }
    })
  }

  const finishSetup = () => {
    saveProfile(p)
    navigate('/m')
  }

  return (
    <div className="app" {...profileAttrs(p)}>
      <main className="page atm-page">
        <div className="atm-step-header">
          {step === 2 ? (
            <button type="button" className="btn back atm-back" onClick={() => setStep(1)}>
              ← 이전 화면
            </button>
          ) : (
            <span className="atm-brand">내 방식 QR · 맞춤 주문</span>
          )}
          <span className="atm-step-badge">{healthOn ? `${step} / 2 단계` : '1 / 1 단계'}</span>
        </div>

        {step === 1 && (
          <section className="atm-card" aria-label="글씨 크기 선택">
            <h1 className="atm-question">글씨를 얼마나 크게 해드릴까요?</h1>
            <p className="atm-sub">누르시면 바로 다음 화면으로 넘어갑니다.</p>

            <div className="atm-choice-stack">
              <button
                type="button"
                className={'atm-big-btn primary-choice' + (p.fontSize === 'xlarge' ? ' selected' : '')}
                onClick={() => selectFontPreset('xlarge', true, true)}
              >
                <span className="atm-btn-badge">어르신 추천</span>
                <span className="atm-btn-title">왕큰 글씨 + 쉬운 말 설명</span>
                <span className="atm-btn-desc">캐모마일 같은 어려운 메뉴도 쉬운 우리말로 알려드려요</span>
              </button>

              <button
                type="button"
                className={'atm-big-btn' + (p.fontSize === 'large' ? ' selected' : '')}
                onClick={() => selectFontPreset('large', true, true)}
              >
                <span className="atm-btn-title">큰 글씨 + 쉬운 말 설명</span>
                <span className="atm-btn-desc">글씨와 버튼을 큼직하고 보기 편하게 키워 드려요</span>
              </button>

              <button
                type="button"
                className={'atm-big-btn' + (p.fontSize === 'normal' ? ' selected' : '')}
                onClick={() => selectFontPreset('normal', false, false)}
              >
                <span className="atm-btn-title">보통 글씨 (일반 화면)</span>
                <span className="atm-btn-desc">원래 키오스크 메뉴 이름 그대로 빠르게 주문해요</span>
              </button>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={p.highContrast}
              className={'toggle atm-contrast-toggle' + (p.highContrast ? ' on' : '')}
              onClick={() => setP((prev) => ({ ...prev, highContrast: !prev.highContrast }))}
            >
              <span className="toggle-text">
                <span className="toggle-label">검은 바탕에 노란 글씨 (고대비)</span>
                <span className="toggle-hint">눈이 부시거나 글씨가 흐릿할 때 켜세요</span>
              </span>
              <span className="toggle-state">{p.highContrast ? '켜짐' : '꺼짐'}</span>
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="atm-card" aria-label="건강 맞춤 알림 선택">
            <h1 className="atm-question">조심하시는 성분이 있나요?</h1>
            <p className="atm-sub">고르시면 메뉴판에 빨간 경고 딱지로 크게 표시해 드려요.</p>

            <div className="atm-choice-stack">
              {WATCH_CHOICES.map((w) => {
                const isOn = p.watch.includes(w.id)
                const descMap: Record<Watch, string> = {
                  sugar: '설탕·당류가 많이 든 달콤한 음료를 알려드려요',
                  caffeine: '커피 등 잠이 안 올 수 있는 카페인 음료를 알려드려요',
                  sodium: '짜거나 나트륨이 높은 메뉴를 알려드려요',
                }
                return (
                  <button
                    key={w.id}
                    type="button"
                    role="checkbox"
                    aria-checked={isOn}
                    className={'atm-check-btn' + (isOn ? ' selected' : '')}
                    onClick={() => toggleWatch(w.id)}
                  >
                    <div className="atm-check-text">
                      <span className="atm-btn-title">{w.label} 조심하기</span>
                      <span className="atm-btn-desc">{descMap[w.id]}</span>
                    </div>
                    <span className="atm-check-pill">{isOn ? '✓ 선택됨' : '선택 안 함'}</span>
                  </button>
                )
              })}

              <button
                type="button"
                role="checkbox"
                aria-checked={p.showKcal}
                className={'atm-check-btn' + (p.showKcal ? ' selected' : '')}
                onClick={() => setP((prev) => ({ ...prev, showKcal: !prev.showKcal }))}
              >
                <div className="atm-check-text">
                  <span className="atm-btn-title">칼로리(열량) 같이 보기</span>
                  <span className="atm-btn-desc">메뉴마다 몇 kcal인지 한눈에 보여드려요</span>
                </div>
                <span className="atm-check-pill">{p.showKcal ? '✓ 켜짐' : '꺼짐'}</span>
              </button>
            </div>

            <details className="atm-allergy-details">
              <summary>알레르기 성분도 고르시겠어요? (우유·견과류 등)</summary>
              <div className="chip-row atm-allergy-chips" role="group" aria-label="알레르기">
                {ALLERGEN_CHOICES.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="checkbox"
                    aria-checked={p.allergies.includes(a.id)}
                    className={'choice' + (p.allergies.includes(a.id) ? ' selected' : '')}
                    onClick={() => toggleAllergen(a.id)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </details>

            <button type="button" className="btn primary block atm-start-btn" onClick={finishSetup}>
              다 골랐어요 · 메뉴판 보기 →
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

