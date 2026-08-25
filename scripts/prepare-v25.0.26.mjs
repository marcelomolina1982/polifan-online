import './prepare-v25.0.25.mjs'
import fs from 'node:fs'

const file='src/App.jsx'
let text=fs.readFileSync(file,'utf8')

const oldLine="const next=data?.data?{...emptyState(),...data.data}:(cachedState?{...emptyState(),...cachedState}:emptyState())"
const newBlock=`let next=data?.data?{...emptyState(),...data.data}:(cachedState?{...emptyState(),...cachedState}:emptyState())
    try{
      const snap=JSON.parse(localStorage.getItem('polifan-app-backup-last')||'null')?.data
      const backupBueno=Array.isArray(snap?.figures)&&snap.figures.length===120&&Array.isArray(snap?.customerCatalog)&&snap.customerCatalog.length===104&&Array.isArray(snap?.catalogCollections)&&snap.catalogCollections.length===4&&Array.isArray(snap?.svgLibrary)&&snap.svgLibrary.length===192
      const estadoDegradado=(next.figures?.length||0)<120||(next.customerCatalog?.length||0)<104||(next.catalogCollections?.length||0)<4||(next.svgLibrary?.length||0)<192
      if(backupBueno&&estadoDegradado){
        const repaired={...next,figures:snap.figures,customerCatalog:snap.customerCatalog,catalogCollections:snap.catalogCollections,svgLibrary:snap.svgLibrary}
        const repairAt=new Date().toISOString()
        let q=supabase.from('app_state').update({data:repaired,updated_at:repairAt}).eq('id','main')
        if(data?.updated_at)q=q.eq('updated_at',data.updated_at)
        const repair=await q.select('updated_at')
        if(repair.data?.length){
          next=repaired
          serverRevisionRef.current=repair.data[0]?.updated_at||repairAt
          try{localStorage.setItem('polifan-app-cache',JSON.stringify(repaired))}catch{}
          alert('✅ Catálogo, categorías y Biblioteca SVG recuperados automáticamente desde la copia local segura. Inventario, pedidos y cortes actuales se conservaron.')
        }
      }
    }catch(error){console.error('Auto recuperación catálogo/SVG',error)}`

if(!text.includes(newBlock)){
  if(!text.includes(oldLine)) throw new Error('v25.0.26: no se encontró punto de carga para auto-recuperación')
  text=text.replace(oldLine,newBlock)
}

fs.writeFileSync(file,text)
console.log('v25.0.26: auto-recuperación selectiva catálogo/SVG preparada')
