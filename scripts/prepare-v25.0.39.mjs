import './prepare-v25.0.34.mjs'
import fs from 'node:fs'

const file='src/App.jsx'
let text=fs.readFileSync(file,'utf8')

const anchor="}catch(error){console.error('Auto recuperación catálogo/SVG',error)}\n    serverRevisionRef.current=data?.updated_at||'';serverDataRef.current=next;setDb(next);try{localStorage.setItem('polifan-app-cache',JSON.stringify(next))}catch{}setLoading(false)"
const replacement=`}catch(error){console.error('Auto recuperación catálogo/SVG',error)}
    // v25.0.39 recuperación de emergencia: buscar en TODAS las copias locales
    // la última foto completa buena previa a la corrupción causada al confirmar placa.
    try{
      const degraded=(next.figures?.length||0)<120||(next.customerCatalog?.length||0)<104||(next.catalogCollections?.length||0)<4||(next.svgLibrary?.length||0)<192
      if(degraded){
        const candidates=[]
        for(let i=0;i<localStorage.length;i++){
          const key=localStorage.key(i)
          if(!key)continue
          try{
            const raw=JSON.parse(localStorage.getItem(key)||'null')
            const snap=raw?.data&&typeof raw.data==='object'?raw.data:raw
            if(!snap||typeof snap!=='object')continue
            const good=Array.isArray(snap.figures)&&snap.figures.length===120&&Array.isArray(snap.customerCatalog)&&snap.customerCatalog.length===104&&Array.isArray(snap.catalogCollections)&&snap.catalogCollections.length===4&&Array.isArray(snap.svgLibrary)&&snap.svgLibrary.length===192
            if(good)candidates.push({key,snap,savedAt:Date.parse(raw?.savedAt||raw?.updatedAt||snap?.updatedAt||0)||0})
          }catch{}
        }
        candidates.sort((a,b)=>b.savedAt-a.savedAt)
        const best=candidates[0]
        if(best){
          const restored={...emptyState(),...best.snap}
          const restoreAt=new Date().toISOString()
          let q=supabase.from('app_state').update({data:restored,updated_at:restoreAt,updated_by:session.user.id}).eq('id','main')
          if(data?.updated_at)q=q.eq('updated_at',data.updated_at)
          const result=await q.select('updated_at')
          if(result.data?.length){
            next=restored
            try{localStorage.setItem('polifan-app-cache',JSON.stringify(restored))}catch{}
            try{localStorage.setItem('polifan-recovery-v25.0.39',JSON.stringify({restoredAt:restoreAt,sourceKey:best.key,savedAt:best.savedAt||null}))}catch{}
            alert('✅ Sistema restaurado desde la última copia local completa anterior al fallo: 120 figuras · 104 catálogo · 4 categorías · 192 SVG. Inventario, pedidos y placas vuelven al mismo estado de esa copia.')
          }
        }
      }
    }catch(error){console.error('Recuperación total v25.0.39',error)}
    serverRevisionRef.current=data?.updated_at||'';serverDataRef.current=next;setDb(next);try{localStorage.setItem('polifan-app-cache',JSON.stringify(next))}catch{}setLoading(false)`

if(!text.includes(replacement)){
  if(!text.includes(anchor))throw new Error('v25.0.39: no se encontró punto de recuperación en App.jsx')
  text=text.replace(anchor,replacement)
}

fs.writeFileSync(file,text)
console.log('v25.0.39: recuperación total desde la última copia local 120/104/4/192 activada')
