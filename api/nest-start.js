export const config={maxDuration:60}

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
const RETRYABLE=new Set([429,502,503,504])
const SOLVERS=[
  // Motor adaptativo nuevo: cambia candidatos y crece hasta base 10.
  {key:'test',base:'https://polifan-cnc-solver-test.onrender.com'},
  // Fallbacks estables: si TEST está levantando o falla, producción sigue operativa.
  {key:'lab',base:'https://polifan-cnc-solver-lab.onrender.com'},
  {key:'prod',base:'https://polifan-cnc-solver.onrender.com'},
]

async function fetchTimed(url,options={},timeoutMs=12000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal})}
  finally{clearTimeout(timer)}
}

async function wake(base){
  try{await fetchTimed(base+'/health',{cache:'no-store'},9000)}catch(_e){}
}

function sendBackendResponse(res,r,text,key){
  const ct=r.headers.get('content-type')||'application/json'
  if(r.status===202 && ct.includes('application/json')){
    try{
      const body=JSON.parse(text)
      if(body?.jobId && !String(body.jobId).includes(':')) body.jobId=key+':'+body.jobId
      res.status(r.status)
      res.setHeader('content-type','application/json')
      res.setHeader('cache-control','no-store')
      return res.send(JSON.stringify(body))
    }catch(_e){}
  }
  res.status(r.status)
  res.setHeader('content-type',ct)
  res.setHeader('cache-control','no-store')
  return res.send(text)
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})

  const incoming=req.body||{}
  const payload={...incoming,gapCm:.25,targetDensity:70,widthCm:122,heightCm:58,
    clientEngineVersion:'Sparrow V1.8 Final Growth',clientBuild:'v25.0.20-final-growth',
    requiredGapMm:2.5,edgeMarginMm:3,maxGrowthTarget:16}

  const failures=[]

  for(const solver of SOLVERS){
    try{
      const r=await fetchTimed(solver.base+'/nest-jobs',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
      },12000)
      const text=await r.text()
      if(!RETRYABLE.has(r.status)) return sendBackendResponse(res,r,text,solver.key)
      failures.push({backend:solver.key,status:r.status,response:text.slice(0,300)})
    }catch(e){
      failures.push({backend:solver.key,error:e?.message||String(e)})
    }

    await wake(solver.base)
    await sleep(900)
    try{
      const r=await fetchTimed(solver.base+'/nest-jobs',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
      },12000)
      const text=await r.text()
      if(!RETRYABLE.has(r.status)) return sendBackendResponse(res,r,text,solver.key)
      failures.push({backend:solver.key,status:r.status,response:text.slice(0,300),retry:true})
    }catch(e){
      failures.push({backend:solver.key,error:e?.message||String(e),retry:true})
    }
  }

  return res.status(503).json({
    ok:false,
    error:'Los motores de Render están temporalmente no disponibles. La placa no se perdió ni se modificó el inventario.',
    failures,
    retryable:true
  })
}
