// 서버(FastAPI) 호출 모음. 주소는 /api/... 만 쓰면 vite 가 8010 서버로 넘겨준다.

export interface MenuItem {
  id: string
  category: string
  name: string
  price: number
  desc: string
  options: string[]
}

export interface Menu {
  store: string
  version: string
  currency: string
  categories: { id: string; name: string }[]
  options: Record<string, { name: string; choices: { id: string; name: string; price: number }[] }>
  items: MenuItem[]
}

export async function fetchMenu(): Promise<Menu> {
  const res = await fetch('/api/menu')
  if (!res.ok) throw new Error(`메뉴를 불러오지 못했어요 (${res.status})`)
  return res.json()
}

export function won(n: number): string {
  return n.toLocaleString('ko-KR') + '원'
}
