// 주문 목록(장바구니). 탭이 열려 있는 동안(sessionStorage) 보관한다.
// 키오스크 창구마다 따로 — QR 을 새로 찍으면(창구가 바뀌면) 빈 목록에서 시작한다.
import type { OrderLine } from './api'

const KEY = 'my-way-qr.cart.v1'

interface Saved {
  session: string | null
  lines: OrderLine[]
}

export function loadCart(session: string | null): OrderLine[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const saved: Saved = JSON.parse(raw)
    return saved.session === session ? saved.lines : []
  } catch {
    return []
  }
}

export function saveCart(session: string | null, lines: OrderLine[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ session, lines } satisfies Saved))
  } catch {
    /* 저장 못 해도 이번 화면은 동작 */
  }
}

/** 같은 메뉴·같은 옵션이면 수량만 늘린다 */
export function addToCart(session: string | null, line: OrderLine): OrderLine[] {
  const lines = loadCart(session)
  const same = lines.find((l) => l.id === line.id && sameOptions(l.options, line.options))
  const next = same
    ? lines.map((l) => (l === same ? { ...l, qty: Math.min(20, l.qty + line.qty) } : l))
    : [...lines, line]
  saveCart(session, next)
  return next
}

function sameOptions(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}
