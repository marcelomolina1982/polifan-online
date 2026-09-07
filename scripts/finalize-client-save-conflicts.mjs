import fs from 'node:fs'

const file='src/App.jsx'
let src=fs.readFileSync(file,'utf8')

const marker=`    if(key==='orders'&&wanted===undefined){merged.delete(id);continue}`
const patch=`    if(key==='clients'){
      // Los clientes se sincronizan con estrategia last-intent-wins por campo
      // para que guardar un pedido nunca quede bloqueado por un refresco de la
      // misma ficha desde otra sesión.
      if(wanted===undefined){merged.delete(id);continue}
      merged.set(id,{...(remote||{}),...(wanted||{}),id:wanted?.id||remote?.id,createdAt:remote?.createdAt||wanted?.createdAt,updatedAt:wanted?.updatedAt||remote?.updatedAt})
      continue
    }
    if(key==='orders'&&wanted===undefined){merged.delete(id);continue}`

// App.jsx puede ser regenerado por los prepare anteriores en cada build. Por
// eso esta etapa final aplica el parche sobre el archivo REAL que compilará Vite.
if(!src.includes("if(key==='clients')")){
  if(!src.includes(marker))throw new Error('client save fix: no se encontró punto de merge')
  src=src.replace(marker,patch)
}
if(!src.includes("if(key==='clients')")||!src.includes("createdAt:remote?.createdAt||wanted?.createdAt"))throw new Error('client save fix: no quedó aplicado en App compilado')
fs.writeFileSync(file,src)
console.log('CLIENT SAVE CONFLICT FIX OK · aplicado al App final compilado')
