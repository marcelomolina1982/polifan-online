import fs from 'node:fs'

const file='src/App.jsx'
let src=fs.readFileSync(file,'utf8')
const needle="    if(key==='orders'&&wanted===undefined){merged.delete(id);continue}"
const replacement="    if(key==='clients'){\n      if(wanted===undefined){merged.delete(id);continue}\n      if(remote===undefined){merged.set(id,wanted);continue}\n      merged.set(id,{...remote,...wanted,id:wanted?.id||remote?.id,createdAt:remote?.createdAt||wanted?.createdAt,updatedAt:wanted?.updatedAt||remote?.updatedAt})\n      continue\n    }\n    if(key==='orders'&&wanted===undefined){merged.delete(id);continue}"
if(!src.includes(needle))throw new Error('client merge: no se encontró punto de inserción')
src=src.replace(needle,replacement)
fs.writeFileSync(file,src)
console.log('CLIENT MERGE OK · clientes concurrentes ya no bloquean pedidos')
