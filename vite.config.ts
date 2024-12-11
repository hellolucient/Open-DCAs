import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'buffer': 'buffer'
    }
  },
  define: {
    'process.env': {},
    'global': {},
    'Buffer': ['buffer', 'Buffer']
  },
  optimizeDeps: {
    include: ['buffer']
  }
})