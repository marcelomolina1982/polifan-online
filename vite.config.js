import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import case9GuardPlugin from './case9GuardPlugin.js'
import case9MotorGuardPlugin from './case9MotorGuardPlugin.js'

export default defineConfig({
  plugins: [case9GuardPlugin(), case9MotorGuardPlugin(), react()],
  build:{
    rollupOptions:{
      output:{
        manualChunks(id){
          if(!id.includes('node_modules'))return
          if(id.includes('/react/')||id.includes('/react-dom/')||id.includes('/scheduler/'))return 'vendor-react'
          if(id.includes('@supabase/'))return 'vendor-supabase'
          if(id.includes('/jspdf/')||id.includes('/html2canvas/'))return 'vendor-documents'
        }
      }
    },
    chunkSizeWarningLimit:700
  }
})
