import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import case9GuardPlugin from './case9GuardPlugin.js'

export default defineConfig({
  plugins: [case9GuardPlugin(), react()],
})
