export const config={maxDuration:60}

const BASE='https://polifan-cnc-solver.onrender.com'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const RETRYABLE=new Set([429,502,503,504])

async function fetchTimed(url,options={},timeoutMs=12000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal})}
  finally{clearTimeout(timer)}
}

async function wake(){
  try{await fetchTimed(BASE+'/health',{headers:{accept:'application/json'},cache:'no-store'},12000)}catch(_e){}
}

function send(res,r,text){
  const ct=r.headers.get('content-type')||'application/json'
  res.status(r.status)
  res.setHeader('content-type',ct)
  res.setHeader('cache-control','no-store')
  res.setHeader('x-solver-backend','prod')
  if(r.status===202 && ct.includes('application/json')){
    try{
      const body=JSON.parse(text)
      if(body?.jobId && !String(body.jobId).includes(':')) body.jobId='prod:'+body.jobId
      body.backend='prod'
      return res.send(JSON.stringify(body))
    }catch(_e){}
  }
  return res.send(text)
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})

  const incoming=req.body||{}
  const payload={...incoming,gapCm:.25,targetDensity:70,widthCm:122,heightCm:58,
    clientEngineVersion:'Sparrow ESTABLE PRODUCCION',clientBuild:'emergency-prod-only-2026-08-22',
    requiredGapMm:2.5,edgeMarginMm:3,maxGrowthTarget:16}

  const failures=[]

  try{
    const r=await fetchTimed(BASE+'/nest-jobs',{
      method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)
    },12000)
    const text=await r.text()
    if(!RETRYABLE.has(r.status)) return send(res,r,text)
    failures.push({phase:'direct',status:r.status,response:text.slice(0,300)})
  }catch(e){
    failures.push({phase:'direct',error:e?.name==='AbortError'?'timeout':(e?.message||String(e))})
  }

  await wake()
  await sleep(900)

  try{
    const r=await fetchTimed(BASE+'/nest-jobs',{
      method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)
    },12000)
    const text=await r.text()
    if(!RETRYABLE.has(r.status)) return send(res,r,text)
    failures.push({phase:'after-wake',status:r.status,response:text.slice(0,300)})
  }catch(e){
    failures.push({phase:'after-wake',error:e?.name==='AbortError'?'timeout':(e?.message||String(e))})
  }

  res.setHeader('cache-control','no-store')
  res.setHeader('x-solver-backend','prod')
  return res.status(503).json({
    ok:false,
    backend:'prod',
    error:'El motor estable de producción no respondió después de despertarlo. No se generó ninguna placa ni se modificó el inventario.',
    failures,
    retryable:true
  })
}
