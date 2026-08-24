export const config={maxDuration:30}

const BASE='https://polifan-sparrow-clean-docker.onrender.com'

async function fetchTimed(url,options={},timeoutMs=20000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
  finally{clearTimeout(timer)}
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'})
  const incoming=req.body||{}
  // Vercel sólo inicia el trabajo. Todo el cálculo pesado queda en Render.
  // Buscamos con 3,1 mm internos para que el resultado final conserve >=3,0 mm
  // reales aun después de rotaciones, simplificación y redondeos geométricos.
  const payload={...incoming,widthCm:122,heightCm:58,gapCm:.31,requiredGapMm:3.1,finalRequiredGapMm:3}
  delete payload.targetDensity
  try{
    const r=await fetchTimed(BASE+'/solve-start',{
      method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)
    },20000)
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    res.setHeader('cache-control','no-store')
    res.setHeader('x-solver-backend','clean-v4-gap31')
    if(r.ok){
      try{
        const body=JSON.parse(text)
        if(body?.jobId&&!String(body.jobId).includes(':'))body.jobId='clean:'+body.jobId
        body.backend='clean-v4-gap31'
        body.requestedGapMm=3.1
        body.finalRequiredGapMm=3
        return res.send(JSON.stringify(body))
      }catch{}
    }
    return res.send(text)
  }catch(e){
    return res.status(503).json({ok:false,backend:'clean-v4-gap31',retryable:true,error:'Render no respondió al iniciar el cálculo: '+(e?.name==='AbortError'?'timeout':(e?.message||String(e)))})
  }
}