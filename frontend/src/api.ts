// 서버(FastAPI) 호출 모음. 주소는 /api/... 만 쓰면 vite 가 8010 서버로 넘겨준다.
// 단계 기호(A~E)는 docs/architecture.png 와 같다.

export interface MenuItem {
  id: string
  category: string
  name: string
  price: number
  desc: string
  options: string[]
  must?: { fact: string; any: string[] }[] // 꼭 남길 정보 (AI 설명에서 빠지면 검사 실패)
}

export interface Menu {
  id: string
  store: string
  version: string
  currency: string
  categories: { id: string; name: string }[]
  options: Record<string, { name: string; choices: { id: string; name: string; price: number }[] }>
  items: MenuItem[]
}

export interface SessionState {
  session: string
  store: string
  status: 'waiting' | 'paid'
  orderNo: number | null
  total: number | null
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let msg = `요청이 실패했어요 (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : msg
    } catch {
      /* 본문이 JSON 이 아니면 기본 문구 */
    }
    throw new Error(msg)
  }
  return res.json()
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** B. 매장 원본 메뉴 */
export const fetchMenu = (store: string) => call<Menu>(`/api/menu?store=${encodeURIComponent(store)}`)

/** A. 주문 창구 열기 (키오스크) */
export const createSession = (store: string) => call<{ session: string; store: string }>('/api/sessions', json({ store }))

/** E. 창구 상태 확인 (키오스크가 2초마다) */
export const getSession = (sid: string) => call<SessionState>(`/api/sessions/${encodeURIComponent(sid)}`)

/** 개발용: PC 내부망 IP (QR 주소 만들 때) */
export const fetchHost = () => call<{ ip: string }>('/api/host')

export function won(n: number): string {
  return n.toLocaleString('ko-KR') + '원'
}

// ───── C. AI 맞춤 화면 ─────
export interface ScreenItem {
  id: string
  name: string
  price: number
  desc: string // AI 가 바꾼 설명 (원본 화면이면 원래 설명)
  originalDesc: string
  options: string[] // 질문 순서대로 정렬됨
}

export interface ScreenOption {
  name: string
  question: string
  choices: { id: string; name: string; label: string; price: number }[]
}

export interface Screen {
  store: string
  storeId: string
  groups: { title: string; items: ScreenItem[] }[]
  options: Record<string, ScreenOption>
  source: 'ai' | 'cache' | 'original' // original = AI 실패로 원본 화면
  rulesVersion: string
  attempts: number
  checks: { name: string; ok: boolean; detail: string }[]
  error: string | null
  elapsedMs: number
}

/** C. 원본 메뉴 + 내 설정 → AI 맞춤 화면 (가격은 서버가 원본으로 붙여 줌) */
export const transformMenu = (store: string, profile: { fontSize: string; easyWords: boolean }, fresh = false) =>
  call<Screen>('/api/transform', json({ store, profile: { fontSize: profile.fontSize, easyWords: profile.easyWords }, fresh }))

// 메뉴 → 옵션 → 주문 목록 화면이 같은 설계도를 쓰도록 한 번 받은 결과를 기억해 둔다
// (화면을 옮길 때마다 AI 를 기다리지 않게)
const screenCache = new Map<string, Promise<Screen>>()

export function getScreen(store: string, profile: { fontSize: string; easyWords: boolean }): Promise<Screen> {
  const key = `${store}|${profile.fontSize}|${profile.easyWords}`
  let p = screenCache.get(key)
  if (!p) {
    p = transformMenu(store, profile)
    p.catch(() => screenCache.delete(key)) // 실패하면 다음에 다시 시도
    screenCache.set(key, p)
  }
  return p
}

/** AI 화면을 못 받았을 때: 원본 메뉴를 같은 모양으로 바꾼다 (주문은 항상 가능해야 함) */
export function screenFromMenu(menu: Menu): Pick<Screen, 'store' | 'storeId' | 'groups' | 'options'> {
  return {
    store: menu.store,
    storeId: menu.id,
    groups: menu.categories.map((c) => ({
      title: c.name,
      items: menu.items
        .filter((i) => i.category === c.id)
        .map((i) => ({ id: i.id, name: i.name, price: i.price, desc: i.desc, originalDesc: i.desc, options: i.options })),
    })),
    options: Object.fromEntries(
      Object.entries(menu.options).map(([k, o]) => [
        k,
        { name: o.name, question: `${o.name}을(를) 골라 주세요`, choices: o.choices.map((c) => ({ ...c, label: c.name })) },
      ]),
    ),
  }
}

// ───── D. 주문 ─────
export interface OrderLine {
  id: string
  options: Record<string, string> // 옵션 ID → 선택지 ID (이름·금액은 보내지 않는다)
  qty: number
}

export interface OrderResult {
  orderNo: number
  total: number // 서버가 원본 메뉴로 다시 계산한 금액
  lines: { id: string; name: string; qty: number; unitPrice: number; amount: number }[]
}

/** D. 주문 → 서버가 금액을 다시 계산하고 목업 결제 → 주문번호 */
export const createOrder = (session: string, items: OrderLine[]) =>
  call<OrderResult>('/api/orders', json({ session, items }))
