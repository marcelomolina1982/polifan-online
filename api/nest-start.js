export const config={maxDuration:30}

const BASE='https://polifan-sparrow-clean-docker.onrender.com'

async function fetchTimed(url,options={},timeoutMs=20000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}finally{clearTimeout(timer)}
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'})
  const incoming=req.body||{}
  // V10: respetar el gap adaptativo elegido por el orquestador (3.4 -> 3.2).
  // Nunca permitimos pedir menos de 3.2 mm internos desde esta ruta.
  const requested=Math.max(3.2,Math.min(3.8,Number(incoming.requiredGapMm||incoming.minimumGapMm||((Number(incoming.gapCm)||.34)*10))))
  const payload={...incoming,widthCm:122,heightCm:58,gapCm:requested/10,requiredGapMm:requested,minimumGapMm:requested,preferredGapMm:requested,finalRequiredGapMm:3}
  delete payload.targetDensity
  try{
    const r=await fetchTimed(BASE+'/solve-start',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)},20000)
    const text=await r.text();res.status(r.status);res.setHeader('content-type',r.headers.get('content-type')||'application/json');res.setHeader('cache-control','no-store');res.setHeader('x-solver-backend','clean-v4-adaptive-gap');res.setHeader('x-requested-gap-mm',requested.toFixed(1));res.setHeader('x-final-required-gap-mm','3.0')
    if(r.ok){try{const body=JSON.parse(text);if(body?.jobId&&!String(body.jobId).includes(':'))body.jobId='clean:'+body.jobId;body.backend='clean-v4-adaptive-gap';body.requestedGapMm=requested;body.finalRequiredGapMm=3;return res.send(JSON.stringify(body))}catch{}}
    return res.send(text)
  }catch(e){return res.status(503).json({ok:false,backend:'clean-v4-adaptive-gap',retryable:true,error:'Render no respondió al iniciar el cálculo: '+(e?.name==='AbortError'?'timeout':(e?.message||String(e)))})}
}
