import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ALLERGEN_CHOICES, HEALTH_NOTE, WATCH_CHOICES } from '../health'
import { DEFAULT_PROFILE, loadProfile, profileAttrs, saveProfile, type FontSize, type Profile } from '../profile'

// 접근성 설정 화면 — 처음 한 번 고르면 폰에 저장된다.
// 고르는 즉시 이 화면 자체가 그 설정대로 바뀌어서, 결과를 바로 눈으로 확인할 수 있다.
export default function SetupPage() {
  const navigate = useNavigate()
  const [p, setP] = useState<Profile>(() => loadProfile() ?? DEFAULT_PROFILE)
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((prev) => ({ ...prev, [k]: v }))
  // 여러 개 고르는 항목: 누를 때마다 넣었다 뺐다 (빠르게 연달아 눌러도 앞의 선택이 사라지지 않게 prev 기준)
  const flip = <K extends 'watch' | 'allergies'>(k: K, v: Profile[K][number]) =>
    setP((prev) => {
      const list = prev[k] as string[]
      return { ...prev, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] }
    })

  const start = () => {
    saveProfile(p)
    navigate('/m')
  }

  return (
    <div className="app" {...profileAttrs(p)}>
      <main className="page">
        <h1>내 방식으로 주문하기</h1>
        <p className="lead">편한 화면을 골라 주세요. 한 번만 고르면 다음부터는 바로 열려요.</p>

        <section className="setting">
          <h2>글씨 크기</h2>
          <div className="choice-row" role="radiogroup" aria-label="글씨 크기">
            {(['normal', 'large', 'xlarge'] as FontSize[]).map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={p.fontSize === f}
                className={'choice' + (p.fontSize === f ? ' selected' : '')}
                onClick={() => set('fontSize', f)}
              >
                {{ normal: '보통', large: '크게', xlarge: '아주 크게' }[f]}
              </button>
            ))}
          </div>
        </section>

        <Toggle label="버튼을 크게" hint="손가락으로 누르기 쉬워요" value={p.bigButtons} onChange={(v) => set('bigButtons', v)} />
        <Toggle label="쉬운 말로 설명" hint="어려운 메뉴 설명을 쉽게 바꿔 드려요" value={p.easyWords} onChange={(v) => set('easyWords', v)} />
        <Toggle label="진한 색 (고대비)" hint="검은 바탕에 밝은 글씨로 또렷하게" value={p.highContrast} onChange={(v) => set('highContrast', v)} />

        {/* 건강 맞춤 표시 — 고른 내용은 이 폰에만 저장되고 서버로 보내지 않는다 */}
        <section className="setting">
          <h2>조심하는 것 (고르지 않아도 돼요)</h2>
          <p className="muted small-hint">고르면 메뉴에 표시해 드려요. 이 정보는 이 폰에만 저장돼요.</p>
          <div className="chip-row" role="group" aria-label="조심할 성분">
            {WATCH_CHOICES.map((w) => (
              <button
                key={w.id}
                role="checkbox"
                aria-checked={p.watch.includes(w.id)}
                className={'choice' + (p.watch.includes(w.id) ? ' selected' : '')}
                onClick={() => flip('watch', w.id)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <h2>알레르기</h2>
          <div className="chip-row" role="group" aria-label="알레르기">
            {ALLERGEN_CHOICES.map((a) => (
              <button
                key={a.id}
                role="checkbox"
                aria-checked={p.allergies.includes(a.id)}
                className={'choice' + (p.allergies.includes(a.id) ? ' selected' : '')}
                onClick={() => flip('allergies', a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="muted small-hint">{HEALTH_NOTE}</p>
        </section>

        <Toggle label="칼로리 보기" hint="메뉴마다 칼로리를 보여 드려요" value={p.showKcal} onChange={(v) => set('showKcal', v)} />

        <section className="preview" aria-label="미리 보기">
          <p className="muted">미리 보기</p>
          <div className="card">
            <div className="item-name">아메리카노</div>
            <div className="item-price">3,500원</div>
          </div>
        </section>

        <button className="btn primary block" onClick={start}>
          이 설정으로 시작하기
        </button>
      </main>
    </div>
  )
}

function Toggle(props: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <section className="setting">
      <button
        role="switch"
        aria-checked={props.value}
        className={'toggle' + (props.value ? ' on' : '')}
        onClick={() => props.onChange(!props.value)}
      >
        <span className="toggle-text">
          <span className="toggle-label">{props.label}</span>
          <span className="toggle-hint">{props.hint}</span>
        </span>
        <span className="toggle-state">{props.value ? '켜짐' : '꺼짐'}</span>
      </button>
    </section>
  )
}
