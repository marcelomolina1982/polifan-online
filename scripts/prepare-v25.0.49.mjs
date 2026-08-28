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

// Candidata V2: menos egress, guardado atómico, cache liviana y catálogo público optimizado.
const v2DataFile='src/lib/v2Data.js'
let v2=fs.readFileSync(v2DataFile,'utf8')
v2=v2.replace("dashboard:['orders','movements','stockMin','figures','cutBatches']","dashboard:['orders','movements','stockMin','figures','cutBatches','packagingStock']")
if(!v2.includes('loadV2SectionsWithRevisions'))v2+=`\nexport async function loadV2SectionsWithRevisions(keys,{fullCatalog=false}={}){\n  const wanted=uniq(keys)\n  if(!wanted.length)return{data:{},revisions:{},updatedAt:''}\n  if(!fullCatalog){\n    try{\n      const {data,error}=await supabase.rpc('get_v2_sections_with_revisions',{p_keys:wanted})\n      if(error)throw error\n      const row=Array.isArray(data)?data[0]:data\n      return{data:row?.data||{},revisions:row?.revisions||{},updatedAt:row?.updated_at||''}\n    }catch(error){if(!isSchemaCacheError(error))throw error}\n  }\n  const base=await loadV2Sections(wanted,{fullCatalog})\n  const {data:revisionRows,error:revisionError}=await supabase.rpc('get_v2_section_revisions',{p_keys:wanted})\n  if(revisionError)throw revisionError\n  const revisions={}\n  for(const row of revisionRows||[])revisions[row.section_key]=row.updated_at\n  return{...base,revisions}\n}\n\nexport async function patchV2SectionsChecked(patch,expectedRevisions,userId){\n  const {data,error}=await supabase.rpc('patch_v2_sections_checked',{p_patch:patch,p_expected_revisions:expectedRevisions||{},p_updated_by:userId||null})\n  if(error)throw error\n  const row=Array.isArray(data)?data[0]:data\n  return{updatedAt:row?.updated_at||'',conflictKeys:row?.conflict_keys||[]}\n}\n\nexport async function loadV2SvgMetadata(){\n  const {data,error}=await supabase.rpc('get_v2_svg_metadata')\n  if(error)throw error\n  const row=Array.isArray(data)?data[0]:data\n  return{data:row?.data||[],updatedAt:row?.updated_at||''}\n}\n\nexport async function loadV2SvgFull(id){\n  const {data,error}=await supabase.rpc('get_v2_svg_full',{p_id:String(id||'')})\n  if(error)throw error\n  const row=Array.isArray(data)?data[0]:data\n  return{data:row?.data||null,updatedAt:row?.updated_at||''}\n}\n`
fs.writeFileSync(v2DataFile,v2)

const appV2File='src/AppV2.jsx'
let appV2=fs.readFileSync(appV2File,'utf8')
appV2=appV2.replace("import {loadV2Sections,patchV2Sections,pageSections,pageNeedsFullCatalog} from './lib/v2Data'","import {loadV2Sections,loadV2SectionsWithRevisions,patchV2SectionsChecked,pageSections,pageNeedsFullCatalog} from './lib/v2Data'")
appV2=appV2.replace("const readCache=()=>{try{return JSON.parse(localStorage.getItem(V2_CACHE)||'{}')}catch{return{}}}\nconst writeCache=value=>{try{localStorage.setItem(V2_CACHE,JSON.stringify(value))}catch{}}",`const V2_CACHE_EXCLUDE=new Set(['customerCatalog','svgLibrary'])\nconst sanitizeCache=value=>{const data={...(value?.data||{})};for(const key of V2_CACHE_EXCLUDE)delete data[key];return{...value,keys:(value?.keys||[]).filter(k=>!V2_CACHE_EXCLUDE.has(k)),data}}\nconst readCache=()=>{try{return sanitizeCache(JSON.parse(localStorage.getItem(V2_CACHE)||'{}'))}catch{return{}}}\nconst writeCache=value=>{try{localStorage.setItem(V2_CACHE,JSON.stringify(sanitizeCache(value)))}catch{try{localStorage.removeItem(V2_CACHE)}catch{}}}`)
appV2=appV2.replace("const latestResult=await loadV2Sections(keys,{fullCatalog:keys.includes('customerCatalog')&&pageNeedsFullCatalog(page)})","const latestResult=await loadV2SectionsWithRevisions(keys,{fullCatalog:keys.includes('customerCatalog')&&pageNeedsFullCatalog(page)})")
appV2=appV2.replace("      await patchV2Sections(patch,session?.user?.id)\n      const confirmed=",`      const checked=await patchV2SectionsChecked(patch,latestResult.revisions||{},session?.user?.id)\n      if(checked.conflictKeys?.length){alert('Otra sesión guardó cambios mientras estabas trabajando: '+checked.conflictKeys.join(', ')+'. Recargá esa sección antes de repetir el cambio.');return{ok:false,conflict:true}}\n      const confirmed=`)
fs.writeFileSync(appV2File,appV2)

const publicFile='src/pages/CustomerOrder.jsx'
let publicPage=fs.readFileSync(publicFile,'utf8')
publicPage=publicPage.replace("const {data,error}=await supabase.from('public_catalog').select('data,updated_at').eq('id','main').maybeSingle()\n      if(!error&&data?.data){applyPublic(data.data,data.updated_at||'');return}","const {data,error}=await supabase.rpc('get_public_catalog_v2')\n      const payload=Array.isArray(data)?data[0]:data\n      if(!error&&payload){applyPublic(payload,payload.updatedAt||'');return}")
publicPage=publicPage.replace("const onOnline=()=>refresh(false)\n    window.addEventListener('focus',()=>refresh(false));window.addEventListener('online',onOnline);document.addEventListener('visibilitychange',onVisible)","const onOnline=()=>refresh(false)\n    const onFocus=()=>refresh(false)\n    window.addEventListener('focus',onFocus);window.addEventListener('online',onOnline);document.addEventListener('visibilitychange',onVisible)")
publicPage=publicPage.replace("table:'public_catalog',filter:'id=eq.main'","table:'public_catalog_revision',filter:'id=eq.main'")
publicPage=publicPage.replace("return()=>{mounted=false;window.removeEventListener('online',onOnline);document.removeEventListener('visibilitychange',onVisible);supabase.removeChannel(channel)}","return()=>{mounted=false;window.removeEventListener('focus',onFocus);window.removeEventListener('online',onOnline);document.removeEventListener('visibilitychange',onVisible);supabase.removeChannel(channel)}")
fs.writeFileSync(publicFile,publicPage)

const publicBaseFile='src/pages/CustomerOrderBase.jsx'
let publicBase=fs.readFileSync(publicBaseFile,'utf8')
publicBase=publicBase.replace("const { data: row, error } = await supabase.from('app_state').select('data,updated_at').eq('id', 'main').maybeSingle()\n          if(error) throw error\n          if(!row?.data) throw new Error('No se encontró la planificación principal.')\n          const state = row.data","const { data: planningRows, error } = await supabase.rpc('get_public_production_planning')\n          if(error) throw error\n          const row=Array.isArray(planningRows)?planningRows[0]:planningRows\n          if(!row?.data) throw new Error('No se encontró la planificación principal.')\n          const state = row.data")
fs.writeFileSync(publicBaseFile,publicBase)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.49'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.49'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · candidata V2 optimizada para pruebas reales'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.49'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.49'")
fs.writeFileSync(indexFile,index)
console.log('v25.0.49: candidata V2 · catálogo/planning livianos · guardado atómico · cache segura · Render resistente')
