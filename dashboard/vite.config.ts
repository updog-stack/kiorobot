import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // /api 요청을 BFF(server/notion-sales-bff.mjs)로 프록시.
    // 블로그 검사기 등 Claude 호출은 20~50초 걸리므로 타임아웃을 넉넉히(2분) 둔다.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        timeout: 300000,
        proxyTimeout: 300000,
      },
    },
  },
})
