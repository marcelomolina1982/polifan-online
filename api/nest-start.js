export const config={maxDuration:60}

const BASE='https://polifan-motor-1230-bench-v5.onrender.com'
const SUPABASE_URL=process.env.VITE_SUPABASE_URL||'https://eftksimpkkvmyfurwqii.supabase.co'
const SUPABASE_KEY=process.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_RJheqVJ6VdJC7291e2z7WQ_0vsBsDWN'

async function fetchTimed(url,options={},timeoutMs=30000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
  finally{clearTimeout(timer)}
}

async function loadSvg(id,token){
  const r=await fetchTimed(SUPABASE_URL+'/rest/v1/rpc/get_v2_svg_full',{
    method:'POST',
    headers:{apikey:SUPABASE_KEY,authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({p_id:String(id||'')})
  },15000)
  const text=await r.text();let body=null;try{body=text?JSON.parse(text):null}catch{}
  if(!r.ok)throw new Error(body?.message||body?.error||`Supabase HTTP ${r.status}`)
  const row=Array.isArray(body)?body[0]:body
  const data=row?.data||null
  if(!data?.svgText)throw new Error('SVG sin geometría: '+id)
  return data
}

async function hydratePayload(incoming,token){
  const ids=[...new Set((incoming.kits||[]).flatMap(k=>k.parts||[]).filter(p=>!p.svgText&&p.svgId).map(p=>String(p.svgId)))]
  const byId=new Map();let cursor=0
  async function worker(){for(;;){const i=cursor++;if(i>=ids.length)return;const id=ids[i];byId.set(id,await loadSvg(id,token))}}
  await Promise.all(Array.from({length:Math.min(4,ids.length)},()=>worker()))
  return {...incoming,kits:(incoming.kits||[]).map(k=>({...k,parts:(k.parts||[]).map(p=>{if(p.svgText)return p;const full=byId.get(String(p.svgId));return {...p,svgText:full?.svgText||'',sourceWidthCm:Number(p.sourceWidthCm||full?.sourceWidthCm||full?.widthCm),sourceHeightCm:Number(p.sourceHeightCm||full?.sourceHeightCm||full?.heightCm),widthCm:Number(p.widthCm||full?.sourceWidthCm||full?.widthCm),heightCm:Number(p.heightCm||full?.sourceHeightCm||full?.heightCm)}})}))}
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'})
  const raw=req.body||{}
  const token=String(raw._accessToken||'').trim()
  if(!token)return res.status(401).json({ok:false,error:'Sesión requerida para iniciar Sparrow'})
  const incoming={...raw};delete incoming._accessToken
  try{
    const hydrated=await hydratePayload(incoming,token)
    // La placa física es 1230×580 mm. El SVG final suma un offset de 6 mm en X/Y,
    // por eso Sparrow solo puede acomodar piezas dentro de 1218×568 mm.
    // No sobrescribir estas medidas con 123×58: ese era el motivo por el que
    // Residual Fill encontraba piezas que luego el certificador marcaba fuera de placa.
    const payload={...hydrated,gapCm:.3,widthCm:121.8,heightCm:56.8,requiredGapMm:3,edgeMarginMm:0,budgetSeconds:Number(incoming.budgetSeconds||240),urgentAnchorCount:Number(incoming.urgentAnchorCount||4),clientEngineVersion:'Sparrow V1.13 / V5 1230 safe-area',clientBuild:'sparrow-v1.13-v5-safe-1218x568-2026-09-01'}
    try{await fetchTimed(BASE+'/health',{headers:{accept:'application/json'}},30000)}catch{}
    const r=await fetchTimed(BASE+'/solve-start',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)},30000)
    const text=await r.text();let body={};try{body=JSON.parse(text||'{}')}catch{}
    if(!r.ok||!body.jobId)return res.status(r.status||503).json({ok:false,error:body.error||`Sparrow 1230 V5 no pudo iniciar (HTTP ${r.status})`,backend:'motor-1230-v5'})
    const jobId=String(body.jobId).includes(':')?String(body.jobId):'motor1230v5:'+body.jobId
    res.setHeader('cache-control','no-store');res.setHeader('x-solver-backend','motor-1230-v5')
    return res.status(202).json({...body,ok:true,jobId,backend:'motor-1230-v5'})
  }catch(e){
    return res.status(503).json({ok:false,backend:'motor-1230-v5',error:'No se pudo iniciar Sparrow 1230 V5: '+(e?.name==='AbortError'?'timeout':(e?.message||String(e))),retryable:true})
  }
}
