export const config={maxDuration:60}

const BASE='https://polifan-sparrow-clean-docker.onrender.com'

async function fetchTimed(url,options={},timeoutMs=30000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
  finally{clearTimeout(timer)}
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'})
  const incoming=req.body||{}
  const payload={...incoming,gapCm:.3,widthCm:122,heightCm:58,requiredGapMm:3,edgeMarginMm:3,clientEngineVersion:'Sparrow V1.13 stable async',clientBuild:'stable-clean-2026-08-24'}
  try{
    // Wake the free Render service first; ignore wake failures and still attempt start.
    try{await fetchTimed(BASE+'/health',{headers:{accept:'application/json'}},30000)}catch{}
    const r=await fetchTimed(BASE+'/solve-start',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)},30000)
    const text=await r.text()
    let body={};try{body=JSON.parse(text||'{}')}catch{}
    if(!r.ok||!body.jobId){
      return res.status(r.status||503).json({ok:false,error:body.error||`Sparrow no pudo iniciar (HTTP ${r.status})`,backend:'clean'})
    }
    const jobId=String(body.jobId).includes(':')?String(body.jobId):'clean:'+body.jobId
    res.setHeader('cache-control','no-store');res.setHeader('x-solver-backend','clean')
    return res.status(202).json({...body,ok:true,jobId,backend:'clean'})
  }catch(e){
    return res.status(503).json({ok:false,backend:'clean',error:'No se pudo iniciar Sparrow en Render: '+(e?.name==='AbortError'?'timeout':(e?.message||String(e))),retryable:true})
  }
}
