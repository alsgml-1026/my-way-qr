import { useEffect, useState } from 'react'
import { fetchMenu, requestVisionStore, transformMenu, won, type Menu, type Screen } from '../api'
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
      <VisionStoreSection />

      <header className="lab-head" style={{ marginTop: 28 }}>
        <div>
          <h1>AI 화면 변환 확인</h1>
          <p className="muted">
            {menu?.store ?? store} · 원래 메뉴 설명과 AI가 바꾼 설명을 비교해요 (
            <a href="/lab?store=modui-cafe">모두의 카페</a> · <a href="/lab?store=modui-bunsik">모두의 분식</a>)
          </p>
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

function VisionStoreSection() {
  const [storeName, setStoreName] = useState('정겨운 우리동네 국수·분식')
  const [imageB64, setImageB64] = useState<string | undefined>(undefined)
  const [fileName, setFileName] = useState<string>('')
  const [genBusy, setGenBusy] = useState(false)
  const [genStore, setGenStore] = useState<Menu | null>(null)
  const [genErr, setGenErr] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      setImageB64(undefined)
      setFileName('')
      return
    }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setImageB64(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleGenerate = () => {
    setGenBusy(true)
    setGenErr(null)
    requestVisionStore(storeName, imageB64)
      .then((r) => setGenStore(r.store))
      .catch((e: Error) => setGenErr(e.message))
      .finally(() => setGenBusy(false))
  }

  return (
    <section
      className="vision-store-sec"
      style={{ padding: 20, borderRadius: 14, border: '2px solid #1f4e79', background: '#f7f5f2' }}
    >
      <h2 style={{ marginTop: 0 }}>📸 사장님용: 종이 메뉴판 사진 1장 → Vision AI 10초 매장 자동 생성기</h2>
      <p className="muted">
        전국 소상공인 매장에서 JSON 파일을 직접 작성할 필요 없이, 메뉴판 사진만 찍어 올리면 AI가 메뉴·가격·옵션 추출은 물론
        예상 당류·나트륨·카페인·알레르기 태그와 어르신용 쉬운 설명까지 자동으로 생성해 즉시 QR 매장으로 등록합니다.
        (사진 없이 눌러도 시연용 샘플 매장이 즉시 개설됩니다.)
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <input
          type="text"
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          aria-label="생성할 매장 이름"
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', fontSize: 15, minWidth: 240 }}
        />
        <input type="file" accept="image/*" onChange={handleFileChange} style={{ fontSize: 14 }} />
        <button type="button" className="lab-run" disabled={genBusy} onClick={handleGenerate}>
          {genBusy ? 'Vision AI 분석 중…' : '📸 메뉴판 AI 자동 추출 & 매장 즉시 개설'}
        </button>
      </div>
      {fileName && (
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          선택된 메뉴판 이미지: <b>{fileName}</b> (Vision AI 전송 준비 완료)
        </p>
      )}
      {genErr && <p className="error">{genErr}</p>}
      {genStore && (
        <div style={{ marginTop: 16, background: '#fff', padding: 14, borderRadius: 10, border: '1px solid #ddd' }}>
          <p style={{ fontWeight: 800, color: '#1b5e20', margin: '0 0 8px' }}>
            ✓ 『{genStore.store}』(ID: {genStore.id}) 매장 JSON 및 영양·알레르기 데이터 자동 생성 완료! ({genStore.items.length}개 메뉴)
          </p>
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 14 }}>
            {genStore.items.map((it) => (
              <li key={it.id}>
                <b>{it.name}</b> ({won(it.price)}) — {it.desc}
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href={`/m?store=${encodeURIComponent(genStore.id)}`} className="btn primary" style={{ display: 'inline-flex' }}>
              📱 방금 생성된 『{genStore.store}』 폰 주문판 바로 열기 (/m?store={genStore.id}) →
            </a>
            <a href={`/kiosk?store=${encodeURIComponent(genStore.id)}`} className="btn" style={{ display: 'inline-flex' }}>
              🖥️ 키오스크 QR 화면 열기 (/kiosk?store={genStore.id})
            </a>
          </div>
        </div>
      )}
    </section>
  )
}
