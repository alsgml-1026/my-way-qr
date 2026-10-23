import { useEffect, useState } from 'react'
import { fetchMenu, getScreen, screenFromMenu, type Menu, type Screen } from './api'
import type { Profile } from './profile'

export type ShownScreen = Pick<Screen, 'store' | 'storeId' | 'groups' | 'options'>

// 폰 화면들이 함께 쓰는 "지금 보여 줄 화면"
// 1) 원본 메뉴를 먼저 받아 바로 보여 주고 (바로 주문 가능)
// 2) AI 맞춤 화면이 도착하면 바꿔 끼운다 (AI 가 실패하면 원본 그대로)
export function useScreen(store: string, profile: Profile | null) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [screen, setScreen] = useState<Screen | null>(null)
  const [aiState, setAiState] = useState<'loading' | 'done' | 'failed'>('loading')
  const [error, setError] = useState<string | null>(null)

  const fontSize = profile?.fontSize
  const easyWords = profile?.easyWords

  useEffect(() => {
    fetchMenu(store).then(setMenu).catch((e: Error) => setError(e.message))
  }, [store])

  useEffect(() => {
    if (!fontSize || easyWords === undefined) return
    setAiState('loading')
    getScreen(store, { fontSize, easyWords })
      .then((s) => {
        setScreen(s)
        setAiState(s.source === 'original' ? 'failed' : 'done')
      })
      .catch(() => setAiState('failed'))
  }, [store, fontSize, easyWords])

  const shown: ShownScreen | null = screen ?? (menu ? screenFromMenu(menu) : null)
  return { screen: shown, aiState, error }
}
