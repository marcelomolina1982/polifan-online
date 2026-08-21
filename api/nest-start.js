export const config={maxDuration:60}

const BASE='https://polifan-cnc-solver-test.onrender.com'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))

async function fetchTimed(url,options={},timeoutMs=10000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal})}
  finally{clearTimeout(timer)}
}

async function startJob(payload,timeoutMs){
  return fetchTimed(BASE+'/nest-jobs',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify(payload)
  },timeoutMs)
}

async function wakeTest(){
  try{await fetchTimed(BASE+'/health',{headers:{accept:'application/json'},cache:'no-store'},18000)}catch(_e){}
}

function send(res,r,text){
  const ct=r.headers.get('content-type')||'application/json'
  res.status(r.status)
  res.setHeader('content-type',ct)
  res.setHeader('cache-control','no-store')
  res.setHeader('x-solver-backend','test')
  if(r.status===202 && ct.includes('application/json')){
    try{
      const body=JSON.parse(text)
      if(body?.jobId && !String(body.jobId).includes(':')) body.jobId='test:'+body.jobId
      body.backend='test'
      return res.send(JSON.stringify(body))
    }catch(_e){}
  }
  return res.send(text)
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})

  const incoming=req.body||{}
  const payload={...incoming,gapCm:.25,targetDensity:70,widthCm:122,heightCm:58,
    clientEngineVersion:'Sparrow motor definitivo TEST',clientBuild:'test-connection-v2',
    requiredGapMm:2.5,edgeMarginMm:3,maxGrowthTarget:16}

  const failures=[]

  // Intento rápido. Si el servicio está despierto, la placa empieza sin demora.
  try{
    const r=await startJob(payload,8000)
    const text=await r.text()
    if(![429,502,503,504].includes(r.status)) return send(res,r,text)
    failures.push({phase:'direct',status:r.status,response:text.slice(0,240)})
  }catch(e){
    failures.push({phase:'direct',error:e?.name==='AbortError'?'timeout':(e?.message||String(e))})
  }

  // Render Free puede estar dormido. Una sola secuencia de wake + retry mantiene
  // toda la función por debajo del límite de Vercel y evita el antiguo bucle TEST/LAB/PROD.
  await wakeTest()
  await sleep(1200)

  try{
    const r=await startJob(payload,10000)
    const text=await r.text()
    if(![429,502,503,504].includes(r.status)) return send(res,r,text)
    failures.push({phase:'after-wake',status:r.status,response:text.slice(0,240)})
  }catch(e){
    failures.push({phase:'after-wake',error:e?.name==='AbortError'?'timeout':(e?.message||String(e))})
  }

  res.setHeader('cache-control','no-store')
  res.setHeader('x-solver-backend','test')
  return res.status(503).json({
    ok:false,
    backend:'test',
    error:'El motor TEST no respondió después de despertarlo. No se generó ninguna placa ni se modificó el inventario.',
    failures,
    retryable:true
  })
}
