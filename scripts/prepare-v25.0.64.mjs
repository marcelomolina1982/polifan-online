import './prepare-v25.0.63.mjs'
import fs from 'node:fs'

function replaceOnce(text,before,after,label){
  if(!text.includes(before))throw new Error('v25.0.64: no encontré '+label)
  const count=text.split(before).length-1
  if(count!==1)throw new Error('v25.0.64: '+label+' aparece '+count+' veces')
  return text.replace(before,after)
}

// 1) El cálculo no debe perderse si Render reinicia y olvida su mapa de jobs.
const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
motor=replaceOnce(
  motor,
  "saveActiveJob({jobId:data.jobId,multiplier:Number(multiplier||1),startedAt:Date.now()})",
  "saveActiveJob({jobId:data.jobId,multiplier:Number(multiplier||1),startedAt:Date.now(),payload,restartCount:Number(loadActiveJob()?.restartCount||0)})",
  'persistencia del payload de recuperación del Motor'
)
const waitRx=/  async function waitJob\(jobId,originalStartedAt=Date\.now\(\)\)\{[\s\S]*?\n  \}\n  async function runPayload/
if(!waitRx.test(motor))throw new Error('v25.0.64: no encontré waitJob generado por 25.0.62')
const waitReplacement=`  async function waitJob(jobId,originalStartedAt=Date.now()){
    let transientFailures=0
    let lostJobRecoveries=Number(loadActiveJob()?.restartCount||0)
    for(;;){
      await sleep(transientFailures?3000:2000)
      let response=null,job={}
      try{
        response=await fetch('/api/nest-status?id='+encodeURIComponent(jobId),{cache:'no-store'})
        job=await response.json().catch(()=>({}))
      }catch(error){
        transientFailures+=1
        if(transientFailures<=8){setProgress('Sparrow sigue activo · reconectando con Render ('+transientFailures+'/8)…');continue}
        throw new Error('No se pudo reconectar con Sparrow después de varios intentos. El trabajo queda guardado para reintentar.')
      }
      const sec=Math.round((Date.now()-Number(originalStartedAt||Date.now()))/1000);setElapsed(Math.max(0,sec))
      if(!response.ok){
        const lostJob=response.status===404&&/trabajo no encontrado|job no encontrado/i.test(String(job?.error||''))
        if(lostJob&&lostJobRecoveries<2){
          const active=loadActiveJob()
          if(active?.payload){
            lostJobRecoveries+=1
            setProgress('Render reinició · retomando el mismo cálculo automáticamente…')
            const newJobId=await startJob(active.payload,Number(active.multiplier||1))
            const restartedAt=Date.now()
            saveActiveJob({...loadActiveJob(),jobId:newJobId,payload:active.payload,multiplier:Number(active.multiplier||1),startedAt:restartedAt,restartCount:lostJobRecoveries})
            jobId=newJobId;originalStartedAt=restartedAt;transientFailures=0
            continue
          }
        }
        const retryable=job?.retryable===true||[502,503,504].includes(response.status)
        if(retryable&&transientFailures<8){transientFailures+=1;setProgress('Sparrow se está despertando · reintento '+transientFailures+'/8 · trabajo guardado');continue}
        throw new Error(lostJob?'Render reinició dos veces durante este cálculo. Tocá Generar una placa para iniciar nuevamente.':(job.error||('No se pudo consultar el cálculo (HTTP '+response.status+')')))
      }
      transientFailures=0
      if(job.status==='done')return job.result||{}
      if(job.status==='error')throw new Error(job.result?.error||job.error||'Sparrow terminó sin una placa válida.')
      setProgress((job.stage||'Sparrow calculando…')+' · '+Number(job.elapsedSeconds||sec).toFixed(0)+' s · podés cambiar de pestaña sin perderlo')
      if(Date.now()-Number(originalStartedAt||Date.now())>25*60*1000)throw new Error('El trabajo lleva más de 25 minutos. Volvé a generar una vez.')
    }
  }
  async function runPayload`
motor=motor.replace(waitRx,waitReplacement)
fs.writeFileSync(motorFile,motor)

// 2) Nunca forzar una recarga de pantalla sólo porque cambió el service worker.
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8')
index=index.replace(/\s*const reloadKey='sw-reloaded-'\+build[\s\S]*?if\(r\.waiting\)r\.waiting\.postMessage\?\.\(\{type:'SKIP_WAITING'\}\)/,`\n            // La actualización queda lista sin interrumpir un pedido o cálculo en curso.\n            if(r.waiting)r.waiting.postMessage?.({type:'SKIP_WAITING'})`)
if(index.includes('location.reload()'))throw new Error('v25.0.64: todavía existe una recarga automática del service worker')
fs.writeFileSync(indexFile,index)

// 3) Misma identidad visual que la barra lateral: blanco, rosa, celeste y texto azul/gris.
const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
css+=`\n/* v25.0.64 · identidad clara unificada */
:root{--v2-bg:#f7f9fc;--v2-card:#fff;--v2-ink:#263548;--v2-muted:#7d8999;--v2-line:#e6eaf0;--v2-purple:#e82d79;--v2-cyan:#23b7cf;--v2-green:#2c9b68}
html,body,#root,.v2-shell,.v2-shell .content,.v2-shell .content>main{background:#f7f9fc!important;color:#263548!important}
.v2-shell .content>main:before{background:linear-gradient(180deg,#fff,rgba(247,249,252,0))!important}
.v2-shell .panel,.v2-shell .v2-card,.studio-priority,.studio-flow,.studio-agenda,.studio-metrics button,.studio-command,.studio-launchpad button{background:#fff!important;color:#263548!important;border-color:#e6eaf0!important;box-shadow:0 8px 24px rgba(38,53,72,.055)!important;backdrop-filter:none!important}
.studio-capacity{background:#fff!important;color:#263548!important;border:1px solid #e6eaf0!important;box-shadow:0 8px 24px rgba(38,53,72,.055)!important}
.studio-capacity:after{background:radial-gradient(circle,rgba(35,183,207,.13),transparent 68%)!important}
.studio-capacity .studio-card-label>span{color:#9aa4b3!important}.studio-capacity .studio-card-label button{color:#d82a74!important}
.studio-ring:before{background:#fff!important;box-shadow:inset 0 0 0 1px #e4e8ef!important}.studio-ring strong,.studio-capacity-copy>strong,.studio-capacity-copy>div b{color:#263548!important}.studio-ring span,.studio-capacity-copy>p{color:#7d8999!important}.studio-capacity-copy>strong em{color:#9aa4b3!important}.studio-capacity-copy>div span{background:#f5f7fb!important;color:#7d8999!important;border:1px solid #edf0f4!important}
.studio-top-actions .accent,.v2-shell button.primary{background:linear-gradient(135deg,#e82d79,#ff5b9f)!important;color:#fff!important;box-shadow:0 9px 20px rgba(232,45,121,.18)!important}
.studio-live{background:#f2fbfc!important;color:#263548!important;border:1px solid #d7f0f3!important}.studio-live span{color:#768697!important}.studio-live b{color:#263548!important}
.studio-launchpad i{background:#fff0f6!important;color:#d82a74!important;border:1px solid #ffd7e8!important}.studio-search{background:#f7f9fc!important;border-color:#e6eaf0!important}
.studio-card-label button,.studio-topline span{color:#d82a74!important}.studio-stage-track button i{box-shadow:0 0 0 6px #f5f7fb!important}
.notice,.delivery-estimate-box,.table-wrap,table,thead,tbody,tr,td,th{border-color:#e6eaf0!important}.notice,.delivery-estimate-box,.table-wrap{background:#fff!important;color:#263548!important}
.v2-shell input,.v2-shell select,.v2-shell textarea{background:#fff!important;border-color:#dfe5ed!important;color:#263548!important}.v2-shell input:focus,.v2-shell select:focus,.v2-shell textarea:focus{border-color:#f27cac!important;box-shadow:0 0 0 4px rgba(232,45,121,.08)!important}
@media(max-width:760px){.v2-shell .sidebar{transition:transform .07s ease-out!important;will-change:transform!important;contain:paint!important}.v2-shell .menu{touch-action:manipulation!important}}
`
fs.writeFileSync(cssFile,css)

// 4) Guardas finales + versión.
const finalMotor=fs.readFileSync(motorFile,'utf8')
if(!finalMotor.includes('Render reinició · retomando el mismo cálculo automáticamente'))throw new Error('v25.0.64: falta recuperación de job perdido')
if(!finalMotor.includes('payload,restartCount'))throw new Error('v25.0.64: falta persistir payload de recuperación')
if(fs.readFileSync(indexFile,'utf8').includes('location.reload()'))throw new Error('v25.0.64: recarga automática todavía presente')
if(!css.includes('.studio-capacity{background:#fff!important'))throw new Error('v25.0.64: falta aclarar capacidad del dashboard')

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.64'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.64'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · paleta unificada + motor recuperable + ventas estable'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.64'"))
index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.64'")
fs.writeFileSync(indexFile,index)
console.log('v25.0.64 PREDEPLOY OK · paleta sidebar en toda la app · menú inmediato · sin recarga forzada · Motor recupera jobs perdidos')
