import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// [advice from AI] KTV POC 프론트엔드 설정
export default defineConfig({
  plugins: [react()],
  server: {
    port: 6430,
    host: '0.0.0.0',
    // [advice from AI] 백엔드 API 프록시 설정
    proxy: {
      '/api': {
        target: 'http://backend:6431',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://backend:6431',
        changeOrigin: true,
      }
    }
  },
  preview: {
    port: 6430,
    host: '0.0.0.0',
  }
})
