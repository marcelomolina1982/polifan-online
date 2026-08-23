import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import case9GuardPlugin from './case9GuardPlugin.js'
import case9MotorGuardPlugin from './case9MotorGuardPlugin.js'
import sparrowLabRoutePlugin from './sparrowLabRoutePlugin.js'

export default defineConfig({
  define: {
    __SPARROW_LAB_BUILD__: JSON.stringify('63dad4e-area-first-trim'),
  },
  plugins: [sparrowLabRoutePlugin(), case9GuardPlugin(), case9MotorGuardPlugin(), react()],
})
