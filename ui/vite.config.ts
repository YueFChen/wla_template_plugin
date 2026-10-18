import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
})
