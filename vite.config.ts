import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { sites } from './build/sites-vite-plugin'

export default defineConfig({
  plugins: [vue(), sites()],
  server: {
    host: true,
    watch: process.env.CODEX_SANDBOX === 'seatbelt'
      ? { useFsEvents: false, usePolling: true }
      : undefined
  },
  build: { target: 'es2022' }
})
