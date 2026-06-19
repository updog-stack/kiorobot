import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 실제 노션 연동 시: /api 요청을 매출 BFF(server/notion-sales-bff.mjs)로 프록시
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
