export const config={maxDuration:60}

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))

async function postNest(base,payload,timeoutMs=18000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{
    return await fetch(base+'/nest-jobs',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),
      signal:controller.signal
    })
  }finally{
    clearTimeout(timer)
  }
}

async function wakeSolver(base){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),35000)
  try{
    await fetch(base+'/health',{cache:'no-store',signal:controller.signal})
  }catch(_e){
    // El objetivo es despertar Render. Aunque /health corte por timeout,
    // el siguiente POST puede encontrar el worker ya levantado.
  }finally{
    clearTimeout(timer)
  }
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})

  // Producción sigue usando exactamente el mismo solver LAB y el mismo payload.
  // Este parche sólo agrega tolerancia al cold-start/503 de Render.
  const base='https://polifan-cnc-solver-lab.onrender.com'
  const incoming=req.body||{}
  const payload={...incoming,gapCm:.25,targetDensity:70,widthCm:122,heightCm:58,
    clientEngineVersion:'Sparrow V1.8 Final Growth',clientBuild:'v25.0.20-final-growth',
    requiredGapMm:2.5,edgeMarginMm:3,maxGrowthTarget:16}

  let lastStatus=0
  let lastText=''
  let lastError=''

  try{
    // 1) Intento normal: si Render está despierto no agregamos demora.
    let r
    try{
      r=await postNest(base,payload,12000)
      lastStatus=r.status
      lastText=await r.text()
      if(![502,503,504].includes(r.status)){
        res.status(r.status)
        res.setHeader('content-type',r.headers.get('content-type')||'application/json')
        res.setHeader('cache-control','no-store')
        return res.send(lastText)
      }
    }catch(e){
      lastError=e?.message||String(e)
    }

    // 2) Si Render estaba dormido/no disponible, lo despertamos una vez.
    await wakeSolver(base)

    // 3) Reintentos cortos ya con el worker levantándose.
    for(let attempt=1;attempt<=2;attempt++){
      if(attempt>1) await sleep(1800)
      try{
        r=await postNest(base,payload,12000)
        lastStatus=r.status
        lastText=await r.text()
        if(![502,503,504].includes(r.status)){
          res.status(r.status)
          res.setHeader('content-type',r.headers.get('content-type')||'application/json')
          res.setHeader('cache-control','no-store')
          return res.send(lastText)
        }
      }catch(e){
        lastError=e?.message||String(e)
      }
    }

    return res.status(503).json({
      ok:false,
      error:'Sparrow no pudo iniciar porque Render no respondió después de despertar y reintentar.',
      renderStatus:lastStatus||null,
      renderResponse:lastText||null,
      detail:lastError||null,
      retryable:true
    })
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo iniciar Sparrow Lab en Render: '+(e?.message||String(e)),renderBase:base})
  }
}
