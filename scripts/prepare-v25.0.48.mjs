import './prepare-v25.0.47.mjs'
import fs from 'node:fs'

// v25.0.48: Guardar pedido no debe comparar/reemplazar arrays completos de orders/clients.
// Aplica sólo el pedido actual y el cliente actual sobre el estado remoto más reciente.
const appFile='src/App.jsx'
let app=fs.readFileSync(appFile,'utf8')
const needle=`      if(next?.__figureMerge){`
const replacement=`      if(next?.__orderUpsert){
        const op=next.__orderUpsert
        const latestOrders=Array.isArray(latest?.orders)?latest.orders:[]
        const incoming=op.order
        const exists=latestOrders.some(o=>String(o?.id)===String(incoming?.id))
        merged.orders=exists?latestOrders.map(o=>String(o?.id)===String(incoming?.id)?incoming:o):[...latestOrders,incoming]
        const latestClients=Array.isArray(latest?.clients)?latest.clients:[]
        const candidate=op.client
        if(candidate){
          const key=c=>String(c?.id||c?.phone||c?.email||'').trim().toLocaleLowerCase('es')
          const ck=key(candidate)
          const ci=ck?latestClients.findIndex(c=>key(c)===ck):-1
          merged.clients=ci>=0?latestClients.map((c,i)=>i===ci?{...c,...candidate}:c):[...latestClients,candidate]
        }else merged.clients=latestClients
      }else if(next?.__figureMerge){`
if(app.includes(needle)) app=app.replace(needle,replacement)
else if(!app.includes('if(next?.__orderUpsert)')) throw new Error('v25.0.48: no se pudo instalar merge seguro de pedido')
fs.writeFileSync(appFile,app)

const orderFile='src/pages/OrderForm.jsx'
let order=fs.readFileSync(orderFile,'utf8')
const old=`    const saved=await onSave({...db,orders,clients});if(saved?.ok===false)return`
const neu=`    const saved=await onSave({...db,__onlyKeys:['orders','clients'],__orderUpsert:{order:final,client:clients.find(c=>String(c?.phone||'')===String(final.phone||''))||clients[clients.length-1]||null},orders,clients});if(saved?.ok===false)return`
if(order.includes(old)) order=order.replace(old,neu)
else if(!order.includes('__orderUpsert:{order:final')) throw new Error('v25.0.48: no se pudo aislar Guardar pedido')
fs.writeFileSync(orderFile,order)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.48'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.48'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · pedidos con merge seguro sobre estado remoto actual'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.48'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.48'")
fs.writeFileSync(indexFile,index)
console.log('v25.0.48: Guardar pedido actualiza sólo pedido+cliente sobre estado remoto actual')
