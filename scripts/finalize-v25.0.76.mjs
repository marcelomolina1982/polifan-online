import './finalize-v25.0.75.mjs'
import fs from 'node:fs'

const webFile='src/pages/WebRequests.jsx'
let web=fs.readFileSync(webFile,'utf8')
const oldSave="const orders=[...db.orders,order];const clients=upsertClientFromOrder(db.clients||[],order);await onSave({...db,orders,clients});try{await downloadOrderReceiptJpg(order)}"
const newSave="const orders=[...db.orders,order];const clients=upsertClientFromOrder(db.clients||[],order);const saved=await onSave({...db,orders,clients});if(saved?.ok===false)return;const persistedOrders=Array.isArray(saved?.data?.orders)?saved.data.orders:[];const persisted=persistedOrders.some(x=>x?.id===order.id&&String(x?.number)===String(next));if(!persisted){alert('No se pudo verificar que el pedido quedara guardado. La solicitud sigue pendiente y no se marcó como confirmada.');return}try{await downloadOrderReceiptJpg(order)}"
if(!web.includes(oldSave))throw new Error('v25.0.76: no se encontró guardado de solicitud web')
web=web.replace(oldSave,newSave)
fs.writeFileSync(webFile,web)

const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
const marker='/* v25.0.76 legibilidad equivalente a la app anterior */'
if(!css.includes(marker))css+=`\n\n${marker}\n.v2-shell main{font-size:16px!important;line-height:1.45}\n.v2-shell main table th,.v2-shell main table td{font-size:14px!important;line-height:1.4}\n.v2-shell main button,.v2-shell main input,.v2-shell main select,.v2-shell main textarea{font-size:14px!important}\n.v2-shell main small,.v2-shell main .block{font-size:12.5px!important;line-height:1.35}\n.v2-shell main .panel p,.v2-shell main .panel span,.v2-shell main .panel label{font-size:14px}\n.v2-shell main h3{font-size:18px}\n`
fs.writeFileSync(cssFile,css)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.76'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.76'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Pedidos web seguros y tipografía legible'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.76'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.76'"))
console.log('v25.0.76 FINALIZE OK · solicitud web sólo confirma tras persistencia verificada · tipografía legible')
