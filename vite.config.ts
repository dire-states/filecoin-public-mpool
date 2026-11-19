import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app under /<repo>/; local dev and preview stay at the root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
