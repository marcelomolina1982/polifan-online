import fs from 'node:fs'

const file='src/App.jsx'
let src=fs.readFileSync(file,'utf8')

// El guardado de pedidos puede actualizar orders y clients en la misma acción.
// Clients es información derivada/refrescable: nunca debe cancelar el pedido.
// Reemplazamos el merge completo para clients por un merge tolerante y además
// quitamos clients de cualquier lista de conflictos antes de abortar.
const marker=`    if(key==='orders'&&wanted===undefined){merged.delete(id);continue}`
const patch=`    if(key==='clients'){
      if(wanted===undefined){merged.delete(id);continue}
      merged.set(id,{...(remote||{}),...(wanted||{}),id:wanted?.id||remote?.id,createdAt:remote?.createdAt||wanted?.createdAt,updatedAt:wanted?.updatedAt||remote?.updatedAt})
      continue
    }
    if(key==='orders'&&wanted===undefined){merged.delete(id);continue}`
if(!src.includes("if(key==='clients')")){
  if(!src.includes(marker))throw new Error('client save fix: no se encontró punto de merge')
  src=src.replace(marker,patch)
}

const conflictNeedle=`      if(conflicts.length){savingRef.current=false;setSaving(false);alert('No se guardó este cambio porque otra sesión modificó exactamente el mismo dato al mismo tiempo: '+conflicts.join(', ')+'.\\n\\nLos cambios distintos se combinan automáticamente. Recargá y repetí solamente este cambio.');return{ok:false,conflict:true,keys:conflicts}}`
const conflictPatch=`      const blockingConflicts=conflicts.filter(item=>!String(item).startsWith('clients'))
      if(blockingConflicts.length){savingRef.current=false;setSaving(false);alert('No se guardó este cambio porque otra sesión modificó exactamente el mismo dato al mismo tiempo: '+blockingConflicts.join(', ')+'.\\n\\nLos cambios distintos se combinan automáticamente. Recargá y repetí solamente este cambio.');return{ok:false,conflict:true,keys:blockingConflicts}}`
if(src.includes(conflictNeedle))src=src.replace(conflictNeedle,conflictPatch)
else if(!src.includes('blockingConflicts=conflicts.filter'))throw new Error('client save fix: no se encontró guardia de conflictos')

fs.writeFileSync(file,src)
if(!src.includes("if(key==='clients')")||!src.includes("blockingConflicts=conflicts.filter(item=>!String(item).startsWith('clients'))"))throw new Error('client save fix: validación final falló')
console.log('CLIENT SAVE FIX OK · clients nunca bloquea guardar un pedido')
