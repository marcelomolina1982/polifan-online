export const config={maxDuration:60}

const BASE='https://polifan-motor-1230-bench-v4.onrender.com'

async function fetchTimed(url,options={},timeoutMs=30000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
  finally{clearTimeout(timer)}
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'})
  const incoming=req.body||{}
  const payload={...incoming,gapCm:.3,widthCm:123,heightCm:58,requiredGapMm:3,edgeMarginMm:3,budgetSeconds:Number(incoming.budgetSeconds||240),urgentAnchorCount:Number(incoming.urgentAnchorCount||4),clientEngineVersion:'Sparrow V4 1230 exact +1',clientBuild:'best-effort-multipass-v4-1230-exact-plus-one-2026-08-28'}
  try{
    try{await fetchTimed(BASE+'/health',{headers:{accept:'application/json'}},30000)}catch{}
    const r=await fetchTimed(BASE+'/solve-start',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)},30000)
    const text=await r.text()
    let body={};try{body=JSON.parse(text||'{}')}catch{}
    if(!r.ok||!body.jobId){
      return res.status(r.status||503).json({ok:false,error:body.error||`Sparrow 1230 no pudo iniciar (HTTP ${r.status})`,backend:'motor-1230-v4'})
    }
    const jobId=String(body.jobId).includes(':')?String(body.jobId):'motor1230:'+body.jobId
    res.setHeader('cache-control','no-store');res.setHeader('x-solver-backend','motor-1230-v4')
    return res.status(202).json({...body,ok:true,jobId,backend:'motor-1230-v4'})
  }catch(e){
    return res.status(503).json({ok:false,backend:'motor-1230-v4',error:'No se pudo iniciar Sparrow 1230 en Render: '+(e?.name==='AbortError'?'timeout':(e?.message||String(e))),retryable:true})
  }
}
