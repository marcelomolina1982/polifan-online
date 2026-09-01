import './finalize-v25.0.76.mjs'
import fs from 'node:fs'

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
if(!motor.includes('widthCm:122.4'))throw new Error('v25.0.77: no se encontró ancho útil anterior 122.4')
motor=motor.replace('widthCm:122.4','widthCm:121.8')
if(!motor.includes('const x=3+Number(p.xCm||0)*10,y=6+Number(p.yCm||0)*10,angle=Number(p.angle||0)'))throw new Error('v25.0.77: no se encontró offset horizontal anterior')
motor=motor.replace('const x=3+Number(p.xCm||0)*10,y=6+Number(p.yCm||0)*10,angle=Number(p.angle||0)','const x=6+Number(p.xCm||0)*10,y=6+Number(p.yCm||0)*10,angle=Number(p.angle||0)')
motor=motor.replaceAll('1224 × 568 mm útiles · margen vertical reforzado 6 mm','1218 × 568 mm útiles · guarda real 6 mm en los cuatro lados')
if(!motor.includes('widthCm:121.8')||!motor.includes('const x=6+Number(p.xCm||0)*10,y=6+Number(p.yCm||0)*10'))throw new Error('v25.0.77: no quedó área segura del motor')
fs.writeFileSync(motorFile,motor)

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
const oldMissing="const missing=full?keys:keys.filter(k=>!loadedRef.current.has(k))"
const newMissing="const liveOrderPages=new Set(['orders','new','sheetplanner']);const missing=full?keys:keys.filter(k=>(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
if(!app.includes(oldMissing))throw new Error('v25.0.77: no se encontró política de cache V2')
app=app.replace(oldMissing,newMissing)
if(!app.includes("liveOrderPages=new Set(['orders','new','sheetplanner'])"))throw new Error('v25.0.77: no quedó refresco operativo de orders')
fs.writeFileSync(appFile,app)

/* Aislamos estructuralmente el guardado del submit, sin depender de cómo los
   finalizers anteriores hayan decorado la llamada onSave. */
const orderFormFile='src/pages/OrderForm.jsx'
let orderForm=fs.readFileSync(orderFormFile,'utf8')
const clientsAnchor='const clients=upsertClientFromOrder(db.clients||[],final)'
const receiptAnchor="if(!editing){try{await downloadOrderReceiptJpg(final)}catch(err){console.error(err)}}"
const clientsPos=orderForm.indexOf(clientsAnchor)
const receiptPos=orderForm.indexOf(receiptAnchor,clientsPos)
if(clientsPos<0||receiptPos<0)throw new Error('v25.0.78: no se encontró el tramo estructural submit→recibo')
const saveStart=orderForm.indexOf('const saved=await onSave(',clientsPos)
if(saveStart<0||saveStart>receiptPos)throw new Error('v25.0.78: no se encontró onSave del submit entre clients y recibo')
const saveEndMarker='if(saved?.ok===false)return'
const saveEndBase=orderForm.indexOf(saveEndMarker,saveStart)
if(saveEndBase<0||saveEndBase>receiptPos)throw new Error('v25.0.78: no se encontró cierre seguro del onSave del submit')
const saveEnd=saveEndBase+saveEndMarker.length
const patchedOrderSave="const saved=await onSave(editing?{...db,orders,_onlyKeys:['orders']}:{...db,orders,clients,_onlyKeys:['orders','clients']});if(saved?.ok===false)return"
orderForm=orderForm.slice(0,saveStart)+patchedOrderSave+orderForm.slice(saveEnd)
if(!orderForm.includes("editing?{...db,orders,_onlyKeys:['orders']}"))throw new Error('v25.0.78: no quedó guardado independiente de edición')
fs.writeFileSync(orderFormFile,orderForm)

/* Solicitudes web: los indicadores de catálogo y SVG sólo son válidos si la
   pantalla carga las secciones que realmente comprueba. */
const dataFile='src/lib/v2Data.js'
let data=fs.readFileSync(dataFile,'utf8')
const oldWebSections="  webrequests:['quotes','orders'],"
const newWebSections="  webrequests:['quotes','orders','customerCatalog','svgLibrary'],"
if(!data.includes(oldWebSections))throw new Error('v25.0.79: no se encontró carga original de Solicitudes web')
data=data.replace(oldWebSections,newWebSections)
if(!data.includes(newWebSections))throw new Error('v25.0.79: Solicitudes web no quedó con catálogo + SVG')
fs.writeFileSync(dataFile,data)

/* Legibilidad global real, tanto escritorio como móvil. Se aumenta la base sin
   forzar anchos, para que tablas y formularios mantengan su comportamiento. */
const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
const readabilityMarker='/* v25.0.79 · legibilidad global PC + móvil */'
if(css.includes(readabilityMarker))throw new Error('v25.0.79: bloque de legibilidad duplicado')
css+=`\n${readabilityMarker}\n.v2-shell .content>main{font-size:16px!important;line-height:1.45!important}\n.v2-shell .panel,.v2-shell .v2-card,.v2-shell .notice,.v2-shell .delivery-estimate-box{font-size:16px!important}\n.v2-shell table{font-size:15px!important}\n.v2-shell th,.v2-shell td{font-size:15px!important;line-height:1.4!important}\n.v2-shell input,.v2-shell select,.v2-shell textarea,.v2-shell button{font-size:15px!important;line-height:1.3!important}\n.v2-shell label{font-size:15px!important;line-height:1.35!important}\n.v2-shell small,.v2-shell .block{font-size:13.5px!important;line-height:1.35!important}\n.v2-shell .sidebar nav button,.v2-shell .sidebar .nav-group button{font-size:15px!important}\n.v2-shell h1{font-size:clamp(30px,3vw,42px)!important;line-height:1.08!important}\n.v2-shell h2{font-size:24px!important;line-height:1.15!important}\n.v2-shell h3{font-size:19px!important;line-height:1.2!important}\n.v2-shell .request-tabs button,.v2-shell .request-actions button,.v2-shell .web-request-modal-actions button{font-size:15px!important}\n@media(max-width:760px){.v2-shell .content>main,.v2-shell .panel,.v2-shell .v2-card{font-size:16px!important}.v2-shell input,.v2-shell select,.v2-shell textarea,.v2-shell button{font-size:16px!important}.v2-shell table,.v2-shell th,.v2-shell td{font-size:14.5px!important}.v2-shell small,.v2-shell .block{font-size:13.5px!important}}\n`
fs.writeFileSync(cssFile,css)
if(!css.includes(readabilityMarker)||!css.includes('.v2-shell table{font-size:15px!important}'))throw new Error('v25.0.79: no quedó bloque global de legibilidad')

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.79'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.79'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · tipografía legible + solicitudes verificadas'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.79-readability-webchecks'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.79-readability-webchecks'"))
console.log('v25.0.79 FINALIZE OK · pedidos seguros + tipografía global legible + Solicitudes web con catálogo/SVG reales')
