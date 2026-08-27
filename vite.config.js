import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import case9GuardPlugin from './case9GuardPlugin.js'
import case9MotorGuardPlugin from './case9MotorGuardPlugin.js'
import sparrowLabRoutePlugin from './sparrowLabRoutePlugin.js'

function previewSupabaseProjectPlugin(){
  return {
    name:'preview-supabase-project',
    enforce:'pre',
    transform(code,id){
      if(!id.replace(/\\/g,'/').endsWith('/src/supabase.js')) return null
      return code
        .replaceAll('https://mcmndnxrbsdlaxpfidsn.supabase.co','https://eftksimpkkvmyfurwqii.supabase.co')
        .replaceAll('sb_publishable_jYJLmMGO5E0doDU2tf9xyA_tB6QsqyH','sb_publishable_RJheqVJ6VdJC7291e2z7WQ_0vsBsDWN')
    }
  }
}

export default defineConfig({
  define: {
    __SPARROW_LAB_BUILD__: JSON.stringify('63dad4e-area-first-trim'),
  },
  plugins: [previewSupabaseProjectPlugin(), sparrowLabRoutePlugin(), case9GuardPlugin(), case9MotorGuardPlugin(), react()],
})
