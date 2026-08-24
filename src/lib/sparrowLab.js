const DEFAULT_LAB_URL='https://polifan-sparrow-clean-docker.onrender.com'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

export async function solveWithSparrowLab(payload,{signal,onStage}={}){
  const base=(import.meta.env.VITE_SPARROW_LAB_URL||DEFAULT_LAB_URL).replace(/\/$/,'')
  onStage?.('Sparrow limpio · iniciando cálculo…')

  const start=await fetch(`${base}/solve-start`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),
    signal
  })
  let startData=null
  try{startData=await start.json()}catch{}
  if(!start.ok||!startData?.jobId){
    const detail=startData?.error||`HTTP ${start.status}`
    throw new Error(`Sparrow limpio no pudo iniciar el cálculo: ${detail}`)
  }

  const jobId=startData.jobId
  let data=null
  for(let i=0;i<450;i++){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError')
    await sleep(2000)
    const poll=await fetch(`${base}/solve-status?id=${encodeURIComponent(jobId)}`,{cache:'no-store',signal})
    let status=null
    try{status=await poll.json()}catch{}
    if(!poll.ok){
      const detail=status?.error||`HTTP ${poll.status}`
      throw new Error(`Sparrow limpio perdió el cálculo: ${detail}`)
    }
    if(status?.status==='running'){
      onStage?.(`Sparrow limpio · calculando… ${Math.round(num(status.elapsedSeconds))} s`)
      continue
    }
    data=status?.result||status
    if(status?.status==='error'&&!data?.error)data={ok:false,error:'Sparrow terminó con error'}
    break
  }

  if(!data)throw new Error('Sparrow limpio excedió el tiempo máximo de cálculo.')
  if(!data?.ok){
    const detail=data?.error||'resultado inválido'
    throw new Error(`Sparrow limpio no pudo generar la placa: ${detail}`)
  }

  onStage?.('Sparrow limpio · validando resultado…')
  return {
    raw:data,
    engine:data.engine||'Sparrow clean area-first',
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
    selectionStrategy:data.selectionStrategy||''
  }
}
