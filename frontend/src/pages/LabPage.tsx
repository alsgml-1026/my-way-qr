import { useEffect, useState } from 'react'
import { fetchMenu, transformMenu, type Menu, type Screen } from '../api'
import type { FontSize } from '../profile'
import { DEFAULT_STORE } from '../visit'

// AI 변환 확인 화면 (PC용) — 회의 시연·보고서 캡처·규칙 고칠 때 확인용
// 설정을 고르면 원래 설명과 AI 설명을 나란히 보여 주고, 검사 결과도 보여 준다.
const FONTS: { id: FontSize; label: string }[] = [
  { id: 'normal', label: '보통 글씨' },
  { id: 'large', label: '큰 글씨' },
  { id: 'xlarge', label: '아주 큰 글씨' },
]
const SOURCE_TEXT = { ai: 'AI가 새로 만듦', cache: '미리 만들어 둔 화면', original: 'AI 실패 → 원래 화면' }

export default function LabPage() {
  const store = new URLSearchParams(location.search).get('store') || DEFAULT_STORE
  const [fontSize, setFontSize] = useState<FontSize>('large')
  const [easyWords, setEasyWords] = useState(true)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [screen, setScreen] = useState<Screen | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMenu(store).then(setMenu).catch((e: Error) => setError(e.message))
  }, [store])

  const run = (fresh: boolean) => {
    setBusy(true)
    setError(null)
    transformMenu(store, { fontSize, easyWords }, fresh)
      .then(setScreen)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }
  // 설정을 바꾸면 바로 (캐시가 있으면 캐시로) 다시 보여 준다
  useEffect(() => run(false), [fontSize, easyWords]) // eslint-disable-line react-hooks/exhaustive-deps

  const must = (id: string) => menu?.items.find((i) => i.id === id)?.must?.map((m) => m.fact) ?? []
  const passed = screen?.checks.filter((c) => c.ok).length ?? 0

  return (
    <main className="lab">
      <header className="lab-head">
        <div>
          <h1>AI 화면 변환 확인</h1>
          <p className="muted">{menu?.store ?? store} · 원래 메뉴 설명과 AI가 바꾼 설명을 비교해요</p>
        </div>
        <div className="lab-controls">
          {FONTS.map((f) => (
            <button key={f.id} className={'lab-chip' + (fontSize === f.id ? ' on' : '')} onClick={() => setFontSize(f.id)}>
              {f.label}
            </button>
          ))}
          <button className={'lab-chip' + (easyWords ? ' on' : '')} onClick={() => setEasyWords((v) => !v)}>
            쉬운 말 {easyWords ? '켬' : '끔'}
          </button>
          <button className="lab-run" disabled={busy} onClick={() => run(true)}>
            {busy ? 'AI가 만드는 중…' : 'AI로 새로 만들기'}
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {screen && (
        <>
          <section className="lab-meta">
            <span className={'lab-badge ' + screen.source}>{SOURCE_TEXT[screen.source]}</span>
            <span>규칙 {screen.rulesVersion}</span>
            {screen.source !== 'cache' && <span>시도 {screen.attempts}번 · {(screen.elapsedMs / 1000).toFixed(1)}초</span>}
            <span>검사 {passed}/{screen.checks.length} 통과</span>
            {screen.error && <span className="error">{screen.error}</span>}
          </section>

          <section className="lab-checks">
            {screen.checks.map((c, i) => (
              <div key={c.name} className={'lab-check ' + (c.ok ? 'ok' : 'bad')} title={c.detail}>
                {c.ok ? '✓' : '✗'} {i + 1}. {c.name}
                {!c.ok && <small>{c.detail}</small>}
              </div>
            ))}
          </section>

          <table className="lab-table">
            <thead>
              <tr>
                <th>묶음</th>
                <th>메뉴</th>
                <th>원래 설명</th>
                <th>AI 설명</th>
                <th>꼭 남길 정보</th>
              </tr>
            </thead>
            <tbody>
              {screen.groups.flatMap((g) =>
                g.items.map((it, idx) => (
                  <tr key={it.id}>
                    {idx === 0 && <td rowSpan={g.items.length} className="lab-group">{g.title}</td>}
                    <td><b>{it.name}</b></td>
                    <td className="muted">{it.originalDesc}</td>
                    <td>
                      {it.desc} <small className="muted">({it.desc.length}자)</small>
                    </td>
                    <td className="muted">{must(it.id).join(', ')}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>

          <h2>옵션 질문 (한 화면에 하나씩, 이 순서)</h2>
          <table className="lab-table">
            <thead>
              <tr>
                <th>원래</th>
                <th>AI 질문</th>
                <th>선택지 (원래 → AI)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(screen.options).map(([k, o]) => (
                <tr key={k}>
                  <td className="muted">{o.name}</td>
                  <td><b>{o.question}</b></td>
                  <td>{o.choices.map((c) => `${c.name} → ${c.label}`).join('  /  ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  )
}
