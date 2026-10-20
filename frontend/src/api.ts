// 서버(FastAPI) 호출 모음. 주소는 /api/... 만 쓰면 vite 가 8010 서버로 넘겨준다.
// 단계 기호(A~E)는 docs/architecture.png 와 같다.

export interface MenuItem {
  id: string
  category: string
  name: string
  price: number
  desc: string
  options: string[]
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
