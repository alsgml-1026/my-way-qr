// 사용자 테스트용: 폰에서 '되돌리기'(이전 질문·메뉴로·하나 빼기·빼기)를 몇 번 눌렀는지 센다.
// 주문할 때 서버로 보내 사용자테스트.csv 에 남긴다 → '실수·망설임' 지표.
// 키오스크 창구(session)마다 따로 센다.

const KEY = 'my-way-qr.undo.v1'

export function readUndo(session: string | null): number {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return 0
    const saved = JSON.parse(raw) as { session: string | null; count: number }
    return saved.session === session ? saved.count : 0
  } catch {
    return 0
  }
}

export function countUndo(session: string | null): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ session, count: readUndo(session) + 1 }))
  } catch {
    /* 못 세도 주문에는 영향 없음 */
  }
}
