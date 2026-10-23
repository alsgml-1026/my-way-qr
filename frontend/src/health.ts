// 건강 맞춤 표시 (docs/handoff-1023/HANDOFF.md 9번)
// 서버가 메뉴마다 붙여 준 health(칼로리·태그·알레르기) 중에서 내 설정에 맞는 것만 고른다.
// 내 설정(무엇을 조심하는지)은 폰에만 저장되고 서버로 보내지 않는다.
import type { Health } from './api'
import type { Profile } from './profile'

export type Watch = 'sugar' | 'sodium' | 'caffeine'

export const WATCH_CHOICES: { id: Watch; label: string }[] = [
  { id: 'sugar', label: '당' },
  { id: 'sodium', label: '나트륨(짠맛)' },
  { id: 'caffeine', label: '카페인' },
]

// backend/app/health.py 의 ALLERGENS 와 ID 를 맞춘다
export const ALLERGEN_CHOICES: { id: string; label: string }[] = [
  { id: 'milk', label: '우유' },
  { id: 'egg', label: '달걀' },
  { id: 'wheat', label: '밀' },
  { id: 'soy', label: '대두' },
  { id: 'peanut', label: '땅콩' },
  { id: 'nuts', label: '견과류' },
  { id: 'shellfish', label: '새우·게' },
  { id: 'pork', label: '돼지고기' },
]

export const HEALTH_NOTE = '메뉴판 성분 정보를 보여 드려요. 지금은 시연용 예시 수치예요. 의학적 조언이 아니에요.'

export interface HealthAlert {
  key: string
  text: string // 메뉴 카드에 짧게: '당 많음 30g', '우유 들어 있음'
}

/** 이 메뉴에서 내 설정에 걸리는 것만 */
export function healthAlerts(h: Health | null | undefined, p: Profile): HealthAlert[] {
  if (!h) return []
  const tags = h.tags.filter((t) => p.watch.includes(t.id as Watch)).map((t) => ({ key: t.id, text: `${t.label} ${t.amount}` }))
  const allergens = h.allergens
    .filter((a) => p.allergies.includes(a.id))
    .map((a) => ({ key: a.id, text: `${a.name} 들어 있음` }))
  return [...tags, ...allergens]
}
