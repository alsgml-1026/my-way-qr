import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// host: true  → 같은 와이파이의 폰에서 PC IP 로 접속 가능
// port 5180   → CPT(5173)와 겹치지 않게
// /api 요청은 FastAPI 서버(8010)로 넘김 → 폰은 5180 주소 하나만 알면 됨
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8010',
    },
  },
})
