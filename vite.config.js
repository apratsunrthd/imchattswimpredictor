import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/imchattswimpredictor/',   // ← your GitHub repo name
})