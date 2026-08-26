import './prepare-v25.0.48.mjs'
import fs from 'node:fs'

// v25.0.49: evitar 504 de Vercel. Las funciones proxy fallan antes de 60 s
// y el frontend reintenta automáticamente cuando Render estaba dormido.

const nestFile='api/nest-start.js'
let nest=fs.readFileSync(nestFile,'utf8')
nest=nest.replace(/export const config=\{maxDuration:60\}/,"export const config={maxDuration:55}")
nest=nest.replace(/\n\s*\/\/ Wake the free Render service first;[\s\S]*?try\{await fetchTimed\(BASE\+'\/health',[\s\S]*?catch\{\}\n\s*const r=await fetchTimed\(BASE\+'\/solve-start',[\s\S]*?,30000\)/m,
`\n    // Una sola llamada despierta Render e inicia el trabajo. Evita sumar 30 s de health + 30 s de start.\n    const r=await fetchTimed(BASE+'/solve-start',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)},45000)`)
fs.writeFileSync(nestFile,nest)

const certFile='api/motor-definitivo.js'
let cert=fs.readFileSync(certFile,'utf8')
cert=cert.replace(/export const config=\{maxDuration:60\}/,"export const config={maxDuration:55}")
if(!cert.includes('AbortController')){
  cert=cert.replace("const BASE='https://polifan-hard-cert-v4.onrender.com'",`const BASE='https://polifan-hard-cert-v4.onrender.com'\n\nasync function fetchTimed(url,options={},timeoutMs=45000){\n  const controller=new AbortController()\n  const timer=setTimeout(()=>controller.abort(),timeoutMs)\n  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}\n  finally{clearTimeout(timer)}\n}`)
  cert=cert.replace('const r=await fetch(BASE+path,options)','const r=await fetchTimed(BASE+path,options,45000)')
  cert=cert.replace("return res.status(502).json({ok:false,error:'No se pudo conectar con el certificador geométrico: '+(e?.message||String(e)),backend:BASE})",
  "return res.status(e?.name==='AbortError'?503:502).json({ok:false,error:'No se pudo conectar con el certificador geométrico: '+(e?.name==='AbortError'?'timeout de Render':(e?.message||String(e))),backend:BASE,retryable:true})")
}
fs.writeFileSync(certFile,cert)

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
const oldCert=`  async function certify(svgText){\n    const response=await fetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'placa-sparrow.svg',svgText})})\n    let data={};try{data=await response.json()}catch{}\n    return {status:data.status||\`HTTP \${response.status}\`,minGap:data.validation?.min_gap_mm??data.min_gap_mm??'-',conflicts:data.validation?.conflicts??data.conflicts??'-',border:data.validation?.border_conflicts??data.border_conflicts??'-',seconds:data.seconds??'-',svgText:normalizeCertifiedLeftMargin(data.svgText||svgText,3),error:data.error||''}\n  }`
const newCert=`  async function certify(svgText){\n    let lastResponse=null,lastData={}\n    for(let attempt=1;attempt<=3;attempt++){\n      const response=await fetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'placa-sparrow.svg',svgText})})\n      let data={};try{data=await response.json()}catch{}\n      lastResponse=response;lastData=data\n      if(response.ok||![502,503,504].includes(response.status))break\n      setProgress(\`Certificador despertando en Render · reintento \${attempt}/3…\`)\n      await sleep(1800*attempt)\n    }\n    const response=lastResponse,data=lastData\n    return {status:data.status||\`HTTP \${response?.status||503}\`,minGap:data.validation?.min_gap_mm??data.min_gap_mm??'-',conflicts:data.validation?.conflicts??data.conflicts??'-',border:data.validation?.border_conflicts??data.border_conflicts??'-',seconds:data.seconds??'-',svgText:normalizeCertifiedLeftMargin(data.svgText||svgText,3),error:data.error||''}\n  }`
if(motor.includes(oldCert))motor=motor.replace(oldCert,newCert)

const oldStart=`  async function startJob(payload,multiplier){\n    const response=await fetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})\n    const data=await response.json().catch(()=>({}))\n    if(!response.ok&&!data.jobId)throw new Error(data.error||\`No se pudo iniciar Sparrow (HTTP \${response.status})\`)\n    if(!data.jobId)throw new Error('Render no devolvió el identificador del cálculo.')\n    saveActiveJob({jobId:data.jobId,multiplier:Number(multiplier||1),startedAt:Date.now()})\n    return data.jobId\n  }`
const newStart=`  async function startJob(payload,multiplier){\n    let response=null,data={}\n    for(let attempt=1;attempt<=3;attempt++){\n      response=await fetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})\n      data=await response.json().catch(()=>({}))\n      if(data.jobId||![502,503,504].includes(response.status))break\n      setProgress(\`Despertando Sparrow en Render · reintento \${attempt}/3…\`)\n      await sleep(1800*attempt)\n    }\n    if(!response?.ok&&!data.jobId)throw new Error(data.error||\`No se pudo iniciar Sparrow (HTTP \${response?.status||503})\`)\n    if(!data.jobId)throw new Error('Render no devolvió el identificador del cálculo.')\n    saveActiveJob({jobId:data.jobId,multiplier:Number(multiplier||1),startedAt:Date.now()})\n    return data.jobId\n  }`
if(motor.includes(oldStart))motor=motor.replace(oldStart,newStart)
fs.writeFileSync(motorFile,motor)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.49'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.49'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Sparrow resistente a timeouts de Vercel/Render'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.49'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.49'")
fs.writeFileSync(indexFile,index)
console.log('v25.0.49: proxies cortos + reintentos automáticos; sin 504 por espera acumulada')
