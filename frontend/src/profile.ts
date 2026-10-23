// 사용자 접근성 설정(프로필). 폰 브라우저(localStorage)에 저장해 다음 방문 때 다시 묻지 않는다.
import type { Watch } from './health'

export type FontSize = 'normal' | 'large' | 'xlarge'

export interface Profile {
  fontSize: FontSize // 글씨 크기
  bigButtons: boolean // 버튼·터치 영역 크게
  easyWords: boolean // 어려운 말을 쉬운 말로 (AI 변환)
  highContrast: boolean // 고대비 (검은 바탕 + 밝은 글씨)
  // 건강 맞춤 표시 — 이 폰에만 저장, 서버로 보내지 않음 (health.ts)
  watch: Watch[] // 조심할 성분
  allergies: string[] // 알레르기 ID
  showKcal: boolean // 칼로리 보기
}

export const DEFAULT_PROFILE: Profile = {
  fontSize: 'large',
  bigButtons: true,
  easyWords: true,
  highContrast: false,
  watch: [],
  allergies: [],
  showKcal: false,
}

const KEY = 'my-way-qr.profile.v1'

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) }
  } catch {
    return null // 사생활 보호 모드 등에서 저장소를 못 쓰면 처음 방문처럼 동작
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* 저장 실패해도 이번 화면에서는 계속 쓸 수 있음 */
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 무시 */
  }
}

/** 화면 최상위 요소에 붙일 속성. CSS 가 이 값을 보고 크기·색을 바꾼다. */
export function profileAttrs(p: Profile) {
  return {
    'data-font': p.fontSize,
    'data-big-buttons': p.bigButtons ? 'on' : 'off',
    'data-contrast': p.highContrast ? 'high' : 'normal',
  }
}

export function describeProfile(p: Profile): string[] {
  const out: string[] = []
  out.push({ normal: '보통 글씨', large: '큰 글씨', xlarge: '아주 큰 글씨' }[p.fontSize])
  if (p.bigButtons) out.push('큰 버튼')
  if (p.easyWords) out.push('쉬운 설명')
  if (p.highContrast) out.push('고대비')
  if (p.watch.length || p.allergies.length) out.push('건강 표시')
  if (p.showKcal) out.push('칼로리')
  return out
}
