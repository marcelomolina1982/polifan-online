import fs from 'node:fs'

const file='src/App.jsx'
let src=fs.readFileSync(file,'utf8')

const marker=`    if(key==='orders'&&wanted===undefined){merged.delete(id);continue}`
const patch=`    if(key==='clients'){
      // Guardar un pedido no debe fallar porque otra sesión refrescó la ficha
      // del mismo cliente. El pedido que se está guardando es la intención más
      // reciente para esa ficha; se conserva cualquier campo remoto que el
      // formulario no traiga y se aplican encima los datos del pedido actual.
      if(wanted===undefined){merged.delete(id);continue}
      merged.set(id,{...(remote||{}),...(wanted||{}),id:wanted?.id||remote?.id})
      continue
    }
    if(key==='orders'&&wanted===undefined){merged.delete(id);continue}`

if(!src.includes("if(key==='clients')")){
  if(!src.includes(marker))throw new Error('client save fix: no se encontró punto de merge')
  src=src.replace(marker,patch)
}
if(!src.includes("merged.set(id,{...(remote||{}),...(wanted||{})"))throw new Error('client save fix: no quedó aplicado')
fs.writeFileSync(file,src)
console.log('CLIENT SAVE CONFLICT FIX OK · clientes concurrentes no bloquean pedidos')
