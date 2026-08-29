import './prepare-v25.0.53.mjs'
import fs from 'node:fs'

// v25.0.54: hidratación SVG móvil robusta.
// Sólo carga la geometría que realmente puede entrar al pool enviado al motor (32 kits),
// limita concurrencia contra Supabase y reintenta fallos transitorios de red.

function mustReplace(text,before,after,label){
  if(!text.includes(before)) throw new Error('v25.0.54: no encontré '+label)
  const count=text.split(before).length-1
  if(count!==1) throw new Error(`v25.0.54: ${label} aparece ${count} veces; no aplico cambio ambiguo`)
  return text.replace(before,after)
}

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
const oldHydrate=`async function hydrateUnits(units){
  const components=[...new Map((units||[]).flatMap(u=>u.components||[]).map(c=>[String(c?.id||''),c])).values()].filter(c=>c?.id&&!c.svgText)
  if(!components.length)return units
  const loaded=await Promise.all(components.map(async c=>{const row=await loadV2SvgFull(c.id);return row?.data||null}))
  const byId=new Map(loaded.filter(Boolean).map(x=>[String(x.id),x]))
  return (units||[]).map(u=>({...u,components:(u.components||[]).map(c=>byId.get(String(c.id))||c)}))
}`
const newHydrate=`async function hydrateUnits(units){
  const all=Array.isArray(units)?units:[]
  const motorPool=all.slice(0,32)
  const components=[...new Map(motorPool.flatMap(u=>u.components||[]).map(c=>[String(c?.id||''),c])).values()].filter(c=>c?.id&&!c.svgText)
  if(!components.length)return all
  const byId=new Map(),failures=[]
  let cursor=0
  const workers=Math.min(4,components.length)
  async function loadOne(component){
    let lastError=null
    for(let attempt=1;attempt<=3;attempt++){
      try{const row=await loadV2SvgFull(component.id);const data=row?.data;if(data?.svgText){byId.set(String(component.id),data);return}lastError=new Error('SVG sin geometría')}catch(error){lastError=error}
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,350*attempt))
    }
    failures.push({id:String(component.id),name:component.name||component.modelName||'SVG',error:lastError?.message||String(lastError||'Error de red')})
  }
  async function worker(){for(;;){const index=cursor++;if(index>=components.length)return;await loadOne(components[index])}}
  await Promise.all(Array.from({length:workers},()=>worker()))
  if(failures.length){const sample=failures.slice(0,3).map(x=>x.name).join(', ');throw new Error('No se pudieron cargar '+failures.length+' SVG necesarios'+(sample?' ('+sample+')':'')+'. Revisá la conexión y volvé a generar.')}
  return all.map(u=>({...u,components:(u.components||[]).map(c=>byId.get(String(c.id))||c)}))
}`
if(motor.includes(oldHydrate))motor=mustReplace(motor,oldHydrate,newHydrate,'hydrateUnits original')
else if(!motor.includes('const motorPool=all.slice(0,32)'))throw new Error('v25.0.54: hydrateUnits no está en un estado conocido')
const catchMarker="    }catch(err){clearActiveJob();setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:err.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])}finally{setBusy(false);setProgress('')}"
if(motor.includes(catchMarker))motor=motor.replace(catchMarker,"    }catch(err){clearActiveJob();const message=String(err?.message||err||'Error desconocido');const friendly=message==='Failed to fetch'?'No se pudo completar una petición de red. Revisá la conexión y volvé a generar una vez.':message;setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:friendly,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])}finally{setBusy(false);setProgress('')}")
fs.writeFileSync(motorFile,motor)

const v2DataFile='src/lib/v2Data.js'
let v2=fs.readFileSync(v2DataFile,'utf8')
if(!v2.includes('export async function loadV2SvgFull(id)')){
  v2+=`\nexport async function loadV2SvgFull(id){\n  const sessionResult=await supabase.auth.getSession()\n  const token=sessionResult?.data?.session?.access_token||''\n  if(!token)throw new Error('La sesión venció. Volvé a ingresar antes de generar una placa.')\n  const response=await fetch('/api/v2-svg-full?id='+encodeURIComponent(String(id||'')),{cache:'no-store',headers:{authorization:'Bearer '+token}})\n  const payload=await response.json().catch(()=>({}))\n  if(!response.ok)throw new Error(payload?.error||('No se pudo cargar SVG (HTTP '+response.status+')'))\n  return{data:payload?.data||null,updatedAt:payload?.updatedAt||''}\n}\n`
}
fs.writeFileSync(v2DataFile,v2)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.54'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.54'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · carga SVG móvil robusta'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.54'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.54'"))
console.log('v25.0.54: SVG vía Vercel autenticado · pool real 32 · concurrencia 4 · reintentos 3 · error contextualizado')
