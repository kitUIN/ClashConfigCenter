import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// 开发和预览时将 API 请求代理到后端，避免配置 CORS。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.CCC_BACKEND_URL || 'http://127.0.0.1:8000'
  const allowedHosts = (env.CCC_ALLOWED_HOSTS || 'clash.kituin.fun')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
  const proxy = {
    '/api': { target, changeOrigin: false },
    '/sub': { target, changeOrigin: false },
    '/health': { target, changeOrigin: false },
    '/docs': { target, changeOrigin: false },
    '/redoc': { target, changeOrigin: false },
    '/openapi.json': { target, changeOrigin: false },
  }
  return {
    plugins: [react()],
    server: { port: 5173, allowedHosts, proxy },
    preview: { port: 4173, allowedHosts, proxy },
  }
})
