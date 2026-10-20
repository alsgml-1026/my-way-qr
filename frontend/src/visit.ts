// 이번 방문 정보: QR 주소(?store=…&session=…)에서 읽은 매장과 주문 창구.
// 설정 화면을 다녀와도 잃어버리지 않도록 탭이 열려 있는 동안(sessionStorage) 보관한다.

export interface Visit {
  store: string
  session: string | null // 키오스크 QR 없이 /m 으로 바로 들어오면 null (개발용)
}

const KEY = 'my-way-qr.visit.v1'
export const DEFAULT_STORE = 'dajeong-cafe'

/** 주소에 store/session 이 있으면 저장하고, 없으면 이전에 저장한 값을 쓴다. */
export function readVisit(search: string): Visit {
  const q = new URLSearchParams(search)
  const store = q.get('store')
  const session = q.get('session')
  if (store || session) {
    const v: Visit = { store: store || DEFAULT_STORE, session: session || null }
    try {
      sessionStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      /* 저장 못 해도 이번 화면은 동작 */
    }
    return v
  }
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* 무시 */
  }
  return { store: DEFAULT_STORE, session: null }
}
