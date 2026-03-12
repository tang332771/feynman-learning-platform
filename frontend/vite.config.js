import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Electron 打包产物通过 file:// 加载时，需要使用相对路径引用静态资源
  // 否则会去请求 file:///assets/... 导致白屏。
  base: mode === 'electron' ? './' : '/',
}))
