const DEFAULT_LAB_URL='https://polifan-sparrow-clean-docker.onrender.com'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

export async function solveWithSparrowLab(payload,{signal,onStage}={}){
  const base=(import.meta.env.VITE_SPARROW_LAB_URL||DEFAULT_LAB_URL).replace(/\/$/,'')
  onStage?.('Sparrow v4 · iniciando trabajo en Render…')

  // El navegador sólo inicia el trabajo y después consulta su estado. No queda una
  // conexión HTTP abierta durante 1-3 minutos y Vercel no hace ningún cálculo.
  const startResponse=await fetch(`${base}/solve-start`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...payload,budgetSeconds:num(payload?.budgetSeconds,180)}),
    signal
  })
  let start=null
  try{start=await startResponse.json()}catch{}
  if(!startResponse.ok||!start?.jobId){
    throw new Error(`Sparrow v4 no pudo iniciar: ${start?.error||`HTTP ${startResponse.status}`}`)
  }

  const jobId=String(start.jobId)
  const startedAt=Date.now()
  for(;;){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError')
    await sleep(2000)
    const statusResponse=await fetch(`${base}/solve-status?id=${encodeURIComponent(jobId)}`,{
      headers:{Accept:'application/json'},cache:'no-store',signal
    })
    let job=null
    try{job=await statusResponse.json()}catch{}
    if(!statusResponse.ok){
      throw new Error(`Sparrow v4 no pudo consultar el trabajo: ${job?.error||`HTTP ${statusResponse.status}`}`)
    }
    const elapsed=num(job?.elapsedSeconds,(Date.now()-startedAt)/1000)
    if(job?.status==='running'){
      onStage?.(`Sparrow v4 · calculando y rellenando la placa · ${Math.round(elapsed)} s`)
      if(Date.now()-startedAt>12*60*1000)throw new Error('Sparrow v4 superó 12 minutos de cálculo.')
      continue
    }
    if(job?.status==='error'){
      throw new Error(`Sparrow v4 terminó con error: ${job?.result?.error||job?.error||'sin detalle'}`)
    }
    if(job?.status!=='done'||!job?.result?.ok){
      throw new Error(`Sparrow v4 terminó sin placa válida: ${job?.result?.error||'respuesta inválida'}`)
    }

    const data=job.result
    onStage?.('Sparrow v4 · validando resultado…')
    return {
      raw:data,
      engine:data.engine||'Sparrow best-effort v4 batch fill',
      completeFigures:num(data.completeFigures),
      placements:Array.isArray(data.placements)?data.placements:[],
      geometricOccupancyPct:num(data.geometricOccupancyPct),
      stripWidthUsagePct:num(data.stripWidthUsagePct),
      materialInsideUsedStripPct:num(data.materialInsideUsedStripPct),
      sparrowReportedDensityPct:num(data.sparrowReportedDensityPct),
      stripWidthMm:num(data.stripWidthMm),
      gapMm:num(data.gapMm,3),
      attempts:Array.isArray(data.attempts)?data.attempts:[],
      noArtificialMinimum:data.noArtificialMinimum===true,
      selectionStrategy:data.engine||'Sparrow v4 batch-fill'
    }
  }
}
