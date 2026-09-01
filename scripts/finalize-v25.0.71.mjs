import './finalize-v25.0.68.mjs'
import fs from 'node:fs'

function one(text,before,after,label){
  const count=text.split(before).length-1
  if(count!==1)throw new Error(`finalize-v25.0.71: ${label} aparece ${count} veces`)
  return text.replace(before,after)
}

const webFile='src/pages/WebRequests.jsx'
let web=fs.readFileSync(webFile,'utf8')

web=one(
  web,
  "const isPending=row=>['Pendiente de pago','Presupuesto enviado'].includes(row.status)\nconst norm=value=>",
  "const isPending=row=>['Pendiente de pago','Presupuesto enviado'].includes(row.status)\nconst shippingPriceFor=row=>Math.max(0,Number(row?.customer?.shippingPrice??row?.customer?.shippingQuote?.price??0)||0)\nconst totalWithShippingFor=row=>Math.round(Number(row?.estimated_total||0)+shippingPriceFor(row))\nconst norm=value=>",
  'helpers de envío'
)

web=one(
  web,
  "   const current=existingQuote(row)\n   const quote={id:current?.id||crypto.randomUUID(),code:current?.code||nextQuoteCode(),source:'Web',sourceId:row.id,status:'Pendiente',date:todayArgentinaISO(),customer:c,client:c.name||[c.firstName,c.lastName].filter(Boolean).join(' '),firstName:c.firstName||'',lastName:c.lastName||'',phone:c.phone||'',dni:c.dni||'',email:c.email||'',address:c.address||'',betweenStreets:c.betweenStreets||'',locality:c.locality||'',district:c.district||'',province:c.province||'',postalCode:c.postalCode||'',deliveryType:c.method||'Logística',agencyDelivery:c.agencyDelivery||'',delivery:row.estimated_from||'',items,total:totalFor(items),notes:row.notes||'',createdAt:current?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()}",
  "   const current=existingQuote(row)\n   const productTotal=totalFor(items),shippingCost=shippingPriceFor({...row,customer:c})\n   const quote={id:current?.id||crypto.randomUUID(),code:current?.code||nextQuoteCode(),source:'Web',sourceId:row.id,status:'Pendiente',date:todayArgentinaISO(),customer:c,client:c.name||[c.firstName,c.lastName].filter(Boolean).join(' '),firstName:c.firstName||'',lastName:c.lastName||'',phone:c.phone||'',dni:c.dni||'',email:c.email||'',address:c.address||'',betweenStreets:c.betweenStreets||'',locality:c.locality||'',district:c.district||'',province:c.province||'',postalCode:c.postalCode||'',deliveryType:c.method||'Logística',agencyDelivery:c.agencyDelivery||'',delivery:row.estimated_from||'',items,productsTotal:productTotal,shippingCost,total:productTotal+shippingCost,notes:row.notes||'',createdAt:current?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()}",
  'presupuesto con envío'
)

web=one(
  web,
  "const c=r.customer||{};const isPickup=(c.method||'Logística')==='Retiro en el local';let shippingCost=0,shippingPaid='No corresponde';if(!isPickup){const shippingInput=window.prompt('Costo de envío ya presupuestado (solo números):','0');if(shippingInput===null)return;shippingCost=Math.max(0,Number(String(shippingInput).replace(/[^0-9.,]/g,'').replace(',','.'))||0);shippingPaid=window.confirm('¿El costo de envío ya está PAGADO?\\nAceptar = Pagado · Cancelar = Pendiente de pago')?'Pagado':'Pendiente de pago'}",
  "const c=r.customer||{};const isPickup=(c.method||'Logística')==='Retiro en el local';let shippingCost=isPickup?0:shippingPriceFor(r),shippingPaid=isPickup?'No corresponde':'Pendiente de pago';if(!isPickup&&!shippingCost&&c.shippingPending){const shippingInput=window.prompt('Costo de envío ya presupuestado (solo números):','0');if(shippingInput===null)return;shippingCost=Math.max(0,Number(String(shippingInput).replace(/[^0-9.,]/g,'').replace(',','.'))||0)}",
  'confirmación conserva envío cotizado'
)

web=one(
  web,
  "<td>{money(r.estimated_total)}</td><td>{r.status}</td>",
  "<td><b>{money(totalWithShippingFor(r))}</b>{shippingPriceFor(r)>0&&<small className=\"block\">Productos {money(r.estimated_total)} · Envío {money(shippingPriceFor(r))}</small>}</td><td>{r.status}</td>",
  'total de listado con envío'
)

web=one(
  web,
  "<div><b>Destino</b><span>{c.method==='Retiro en el local'?'Retiro en el local':[c.address,c.locality,c.province,c.postalCode].filter(Boolean).join(' · ')||'—'}</span></div></div>}",
  "<div><b>Destino</b><span>{c.method==='Retiro en el local'?'Retiro en el local':[c.address,c.locality,c.province,c.postalCode].filter(Boolean).join(' · ')||'—'}</span></div><div><b>Envío cotizado</b><span>{c.shippingPending?'Cotización manual':shippingPriceFor(row)>0?money(shippingPriceFor(row)):'Sin cargo / retiro'}</span></div><div><b>Total con envío</b><span>{money(totalWithShippingFor(row))}</span></div></div>}",
  'detalle muestra envío y total'
)

web=one(
  web,
  "<div className=\"request-summary-cards\"><span><b>{unique}</b> modelos</span><span><b>{total}</b> piezas</span><span><b>{money(row.estimated_total)}</b> total estimado</span></div>",
  "<div className=\"request-summary-cards\"><span><b>{unique}</b> modelos</span><span><b>{total}</b> piezas</span><span><b>{money(row.estimated_total)}</b> productos</span><span><b>{money(shippingPriceFor(row))}</b> envío</span><span><b>{money(totalWithShippingFor(row))}</b> total</span></div>",
  'resumen visual con envío'
)

if(!web.includes('shippingPriceFor'))throw new Error('No quedó helper de envío')
if(!web.includes('productsTotal:productTotal,shippingCost,total:productTotal+shippingCost'))throw new Error('No quedó presupuesto con envío')
fs.writeFileSync(webFile,web)

const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
css+=`\n/* v25.0.71 · solicitudes web: modal visible y totales de envío */
.web-request-modal-backdrop{align-items:flex-start!important;overflow-y:auto!important;padding:58px 18px 24px!important;box-sizing:border-box!important}
.web-request-modal{margin:0 auto!important;max-height:calc(100vh - 82px)!important;overflow:auto!important;overscroll-behavior:contain!important}
.request-summary-cards{grid-template-columns:repeat(5,minmax(0,1fr))!important}
@media(max-width:900px){.request-summary-cards{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media(max-width:760px){.web-request-modal-backdrop{padding:54px 8px 14px!important}.web-request-modal{max-height:calc(100vh - 68px)!important;width:100%!important}.request-summary-cards{grid-template-columns:1fr 1fr!important}}
`
fs.writeFileSync(cssFile,css)

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
if(!/import\s*\{[^}]*\bpatchV2Sections\b[^}]*\}\s*from\s*['\"]\.\/lib\/v2Data['\"]/.test(app)){
  const rx=/import\s*\{([^}]*)\}\s*from\s*['\"]\.\/lib\/v2Data['\"]/
  if(!rx.test(app))throw new Error('AppV2 perdió el import de v2Data')
  app=app.replace(rx,(_,names)=>`import {${names.trim().replace(/,\s*$/, '')},patchV2Sections} from './lib/v2Data'`)
  fs.writeFileSync(appFile,app)
}
if(!/import\s*\{[^}]*\bpatchV2Sections\b[^}]*\}\s*from\s*['\"]\.\/lib\/v2Data['\"]/.test(fs.readFileSync(appFile,'utf8')))throw new Error('No se pudo restaurar patchV2Sections en AppV2')
const dataFile='src/lib/v2Data.js'
if(!fs.readFileSync(dataFile,'utf8').includes('export async function patchV2Sections'))throw new Error('v2Data no exporta patchV2Sections')

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.71'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.71'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Solicitudes web con envío + presupuesto estable'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.71'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.71'"))

console.log('v25.0.71 FINALIZE OK · envío visible · total final · presupuesto con shipping · modal corregido · CAS import restaurado')
