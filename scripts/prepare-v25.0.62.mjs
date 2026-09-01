import './prepare-v25.0.59.mjs'
import fs from 'node:fs'

function replaceOnce(text,before,after,label){
  if(!text.includes(before))throw new Error('v25.0.62: no encontré '+label)
  const count=text.split(before).length-1
  if(count!==1)throw new Error('v25.0.62: '+label+' aparece '+count+' veces')
  return text.replace(before,after)
}

// 1) Motor: tolerar despertares/transitorios de Render sin perder el trabajo.
const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
const waitRx=/  async function waitJob\(jobId,originalStartedAt=Date\.now\(\)\)\{[\s\S]*?\n  \}\n  async function runPayload/
if(!waitRx.test(motor))throw new Error('v25.0.62: no encontré waitJob del Motor')
const waitReplacement=`  async function waitJob(jobId,originalStartedAt=Date.now()){
    let transientFailures=0
    for(;;){
      await sleep(transientFailures?3000:2000)
      let response=null,job={}
      try{
        response=await fetch('/api/nest-status?id='+encodeURIComponent(jobId),{cache:'no-store'})
        job=await response.json().catch(()=>({}))
      }catch(error){
        transientFailures+=1
        if(transientFailures<=8){setProgress('Sparrow sigue activo · reconectando con Render ('+transientFailures+'/8)…');continue}
        throw new Error('No se pudo reconectar con Sparrow después de varios intentos. El trabajo guardado se puede recuperar al volver a generar.')
      }
      const sec=Math.round((Date.now()-Number(originalStartedAt||Date.now()))/1000);setElapsed(Math.max(0,sec))
      if(!response.ok){
        const retryable=job?.retryable===true||[502,503,504].includes(response.status)
        if(retryable&&transientFailures<8){transientFailures+=1;setProgress('Sparrow se está despertando · reintento '+transientFailures+'/8 · trabajo guardado');continue}
        throw new Error(job.error||('No se pudo consultar el cálculo (HTTP '+response.status+')'))
      }
      transientFailures=0
      if(job.status==='done')return job.result||{}
      if(job.status==='error')throw new Error(job.result?.error||job.error||'Sparrow terminó sin una placa válida.')
      setProgress((job.stage||'Sparrow calculando…')+' · '+Number(job.elapsedSeconds||sec).toFixed(0)+' s · podés cambiar de pestaña sin perderlo')
      if(Date.now()-Number(originalStartedAt||Date.now())>25*60*1000)throw new Error('El trabajo lleva más de 25 minutos. Render puede haberse reiniciado; volvé a generar una vez.')
    }
  }
  async function runPayload`
motor=motor.replace(waitRx,waitReplacement)
fs.writeFileSync(motorFile,motor)

// 2) Retirar el asistente viejo y reemplazar el acceso interno por ChatGPT.
const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
app=replaceOnce(app,"const CatalogAssistant=lazy(()=>import('./pages/CatalogAssistant'))","const ChatGPTAssist=lazy(()=>import('./pages/ChatGPTAssist'))\nconst ShippingTest=lazy(()=>import('./pages/ShippingTest'))",'lazy del asistente viejo')
app=replaceOnce(app,"['assistant','✦','Asistente del catálogo'],['quotes'","['assistant','✦','Asistencia ChatGPT'],['shippingtest','🚚','Probar envíos'],['quotes'",'menú de asistencia')
app=replaceOnce(app,"{page==='assistant'&&<CatalogAssistant db={db} onSave={saveData}/>} {page==='quotes'","{page==='assistant'&&<ChatGPTAssist/>} {page==='shippingtest'&&<ShippingTest/>} {page==='quotes'",'pantalla del asistente')
fs.writeFileSync(appFile,app)

const v2DataFile='src/lib/v2Data.js'
let v2Data=fs.readFileSync(v2DataFile,'utf8')
v2Data=replaceOnce(v2Data,"  assistant:['customerCatalog','customerSettings','chatbotSettings','catalogCollections'],","  assistant:[],\n  shippingtest:[],",'secciones de asistencia')
fs.writeFileSync(v2DataFile,v2Data)

const customerFile='src/pages/CustomerOrderBase.jsx'
let customer=fs.readFileSync(customerFile,'utf8')
const oldVisible=(customer.match(/chatbotSettings\.enabled!==false&&/g)||[]).length
if(oldVisible<2)throw new Error('v25.0.62: no encontré las dos salidas visibles del asistente viejo')
customer=customer.replace(/chatbotSettings\.enabled!==false&&/g,'false&&')
fs.writeFileSync(customerFile,customer)

// 3) Volver a una lectura más clara: blancos limpios + azul noche + rosa/celeste.
const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
css+=`\n/* v25.0.62 · paleta clara inspirada en la versión anterior */
:root{--v2-bg:#f8fafc;--v2-surface:#ffffff;--v2-ink:#172033;--v2-muted:#687386;--v2-line:#e5e9f0;--v2-primary:#d82a74;--v2-primary-soft:#fff0f6;--v2-blue:#1596a8;--v2-purple:#7650a6;--v2-shadow:0 10px 30px rgba(23,32,51,.06)}
body,.app{background:#f8fafc!important;color:#172033!important}
.v2-shell .content>main{background:linear-gradient(180deg,#fbfdff 0%,#f8fafc 100%)!important}
.v2-shell .sidebar{background:#17213a!important;border-right:1px solid #26324f!important;box-shadow:8px 0 28px rgba(23,33,58,.08)!important}
.v2-shell .sidebar nav button{color:#c8d1df!important}.v2-shell .sidebar nav button:hover{background:rgba(255,255,255,.08)!important;color:#fff!important}.v2-shell .sidebar nav button.active{background:linear-gradient(135deg,#e62c7b,#b92f83)!important;color:#fff!important;box-shadow:0 8px 18px rgba(216,42,116,.22)!important}
.v2-shell .content>header{background:#fff!important;border-bottom:1px solid #e6eaf0!important;backdrop-filter:none!important}
.panel,.v2-card{background:#fff!important;border-color:#e5e9f0!important;box-shadow:0 8px 24px rgba(23,32,51,.045)!important}
.delivery-group{overflow:hidden!important}.delivery-group .delivery-head{background:#17213a!important;color:#fff!important;margin:-1px -1px 0!important;padding:20px 22px!important}.delivery-group .delivery-head small,.delivery-group .delivery-head span{color:#b9c4d6!important}.delivery-group .delivery-head>div>small{color:#ff79ad!important}.delivery-group .delivery-head>b{background:#dff9fb!important;color:#136f78!important;border-radius:14px!important;padding:11px 16px!important}
.cut-date-filter{background:#fff!important}.notice{background:#fff!important}.table-wrap table{background:#fff!important}
.catalog-chat-launcher-wrap,.catalog-chatbot{display:none!important}
`
fs.writeFileSync(cssFile,css)

// 4) Guards y versión.
const finalApp=fs.readFileSync(appFile,'utf8')
const finalCustomer=fs.readFileSync(customerFile,'utf8')
if(finalApp.includes('CatalogAssistant'))throw new Error('v25.0.62: el AppV2 todavía referencia el asistente viejo')
if(!finalApp.includes('ShippingTest'))throw new Error('v25.0.62: falta la prueba de Vía Cargo')
if(finalCustomer.includes('chatbotSettings.enabled!==false&&'))throw new Error('v25.0.62: el chatbot viejo sigue visible')
if(!motor.includes('transientFailures<=8'))throw new Error('v25.0.62: falta tolerancia transitoria del Motor')

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.62'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.62'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · motor resistente + interfaz clara + pruebas de envío'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.62'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.62'"))
console.log('v25.0.62 PREDEPLOY OK · Motor resiliente · asistente viejo retirado · ChatGPT + prueba Via Cargo · paleta clara')
