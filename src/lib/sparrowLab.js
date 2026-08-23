const DEFAULT_LAB_URL='https://polifan-sparrow-clean-docker.onrender.com'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f

export async function solveWithSparrowLab(payload,{signal,onStage}={}){
  const base=(import.meta.env.VITE_SPARROW_LAB_URL||DEFAULT_LAB_URL).replace(/\/$/,'')
  onStage?.('Sparrow limpio · enviando geometrías…')
  const response=await fetch(`${base}/solve`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),
    signal
  })
  let data=null
  try{data=await response.json()}catch{}
  if(!response.ok||!data?.ok){
    const detail=data?.error||`HTTP ${response.status}`
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
