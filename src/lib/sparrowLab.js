const DEFAULT_LAB_URL='https://polifan-sparrow-clean-docker.onrender.com'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const clone=v=>JSON.parse(JSON.stringify(v))

// V9 fallback de producción: el backend actual reportó 2.5 mm al pedir 3.1 mm.
// Para no volver a perder 40 min en una placa rechazada, pedimos 3.8 mm internos
// y mantenemos el certificador duro en >=3.0 mm reales.
const SAFETY_GAP_CM=.38
const SAFETY_GAP_MM=3.8

const areaOfKit=k=>(k?.parts||[]).reduce((acc,p)=>{
  const w=num(p?.sourceWidthCm??p?.widthCm)
  const h=num(p?.sourceHeightCm??p?.heightCm)
  return acc+Math.max(0,w*h)
},0)

const selectedIdsFromResult=r=>{
  const explicit=Array.isArray(r?.selectedKitIds)?r.selectedKitIds.filter(Boolean):[]
  if(explicit.length)return new Set(explicit.map(String))
  return new Set((Array.isArray(r?.placements)?r.placements:[]).map(p=>p?.kitId).filter(Boolean).map(String))
}

const completeCount=r=>{
  const direct=num(r?.completeFigures,NaN)
  return Number.isFinite(direct)?direct:selectedIdsFromResult(r).size
}

const better=(a,b)=>{
  if(!a)return b
  if(!b)return a
  const A=[completeCount(a),num(a?.geometricOccupancyPct),-num(a?.stripWidthMm,1e9)]
  const B=[completeCount(b),num(b?.geometricOccupancyPct),-num(b?.stripWidthMm,1e9)]
  for(let i=0;i<A.length;i++){
    if(B[i]>A[i])return b
    if(B[i]<A[i])return a
  }
  return a
}

const orderedRawKits=payload=>(payload?.kits||[]).slice().sort((a,b)=>
  (num(a?.priority,999999)-num(b?.priority,999999)) ||
  String(a?.date||'').localeCompare(String(b?.date||'')) ||
  String(a?.figure||'').localeCompare(String(b?.figure||''))
)

const hardenGap=payload=>{
  const p=clone(payload)
  p.gapCm=SAFETY_GAP_CM
  p.requiredGapMm=SAFETY_GAP_MM
  p.minimumGapMm=SAFETY_GAP_MM
  p.finalRequiredGapMm=3
  return p
}

const makeVariant=(payload,ordered,urgent,name,budgetSeconds)=>{
  const p=hardenGap(payload)
  p.kits=[
    ...urgent.map((k,i)=>({...clone(k),priority:i+1})),
    ...ordered.map((k,i)=>({...clone(k),priority:100+i}))
  ]
  p.budgetSeconds=budgetSeconds
  p.urgentAnchorCount=Math.min(6,urgent.length||1)
  p._clientStrategy=name
  return p
}

const buildBaseVariants=(payload,budgetSeconds)=>{
  const raw=orderedRawKits(payload)
  const urgent=raw.slice(0,6)
  const rest=raw.slice(6)
  const small=rest.slice().sort((a,b)=>areaOfKit(a)-areaOfKit(b))
  const big=rest.slice().sort((a,b)=>areaOfKit(b)-areaOfKit(a))
  const zig=[]
  for(let i=0,j=big.length-1;i<=j;i++,j--){
    if(i<=j)zig.push(big[i])
    if(j>i)zig.push(big[j])
  }
  return [
    makeVariant(payload,rest,urgent,'prioridad',budgetSeconds),
    makeVariant(payload,small,urgent,'chicas',budgetSeconds),
    makeVariant(payload,zig,urgent,'mezcla-grande-chica',budgetSeconds),
  ]
}

async function runJob(base,payload,{signal,onStage,label,maxMs=7*60*1000}={}){
  const safePayload=hardenGap(payload)
  onStage?.(`${label||'Sparrow'} · GAP interno ${SAFETY_GAP_MM.toFixed(1)} mm · iniciando…`)
  const startResponse=await fetch(`${base}/solve-start`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(safePayload),signal
  })
  let start=null
  try{start=await startResponse.json()}catch{}
  if(!startResponse.ok||!start?.jobId)throw new Error(`${label||'Sparrow'} no pudo iniciar: ${start?.error||`HTTP ${startResponse.status}`}`)
  const jobId=String(start.jobId)
  const startedAt=Date.now()
  for(;;){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError')
    await sleep(2000)
    const statusResponse=await fetch(`${base}/solve-status?id=${encodeURIComponent(jobId)}`,{headers:{Accept:'application/json'},cache:'no-store',signal})
    let job=null
    try{job=await statusResponse.json()}catch{}
    if(!statusResponse.ok)throw new Error(`${label||'Sparrow'} no pudo consultar: ${job?.error||`HTTP ${statusResponse.status}`}`)
    const elapsed=num(job?.elapsedSeconds,(Date.now()-startedAt)/1000)
    if(job?.status==='running'){
      onStage?.(`${label||'Sparrow'} · ${Math.round(elapsed)} s · GAP interno ${SAFETY_GAP_MM.toFixed(1)} mm`)
      if(Date.now()-startedAt>maxMs)throw new Error(`${label||'Sparrow'} superó el tiempo máximo.`)
      continue
    }
    if(job?.status==='error')throw new Error(`${label||'Sparrow'} terminó con error: ${job?.result?.error||job?.error||'sin detalle'}`)
    const data=job?.result||job
    if(job?.status!=='done'||!data?.ok)throw new Error(`${label||'Sparrow'} terminó sin placa válida: ${data?.error||'respuesta inválida'}`)
    return data
  }
}

const chooseDropCandidates=(best,all,urgentIds)=>{
  const selected=selectedIdsFromResult(best)
  return all.filter(k=>selected.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))).sort((a,b)=>areaOfKit(b)-areaOfKit(a)).slice(0,5)
}

const chooseOutside=(best,all,urgentIds)=>{
  const selected=selectedIdsFromResult(best)
  return all.filter(k=>!selected.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))).sort((a,b)=>areaOfKit(a)-areaOfKit(b)).slice(0,16)
}

const pairCandidates=(outside,drop)=>{
  const target=areaOfKit(drop),pairs=[]
  for(let i=0;i<outside.length;i++)for(let j=i+1;j<outside.length;j++){
    const a=outside[i],b=outside[j],sum=areaOfKit(a)+areaOfKit(b),ratio=target>0?sum/target:1
    if(ratio<.45||ratio>1.9)continue
    pairs.push({a,b,delta:Math.abs(sum-target),sum})
  }
  return pairs.sort((x,y)=>x.delta-y.delta||y.sum-x.sum).slice(0,6)
}

const makeSwapPayload=(payload,best,drop,pair,budgetSeconds)=>{
  const all=orderedRawKits(payload)
  const urgent=all.slice(0,6)
  const urgentIds=new Set(urgent.map(k=>String(k?.kitId)))
  const selectedIds=selectedIdsFromResult(best)
  const selectedOthers=all.filter(k=>selectedIds.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId))
  const pairIds=new Set([String(pair.a?.kitId),String(pair.b?.kitId)])
  const rest=all.filter(k=>!urgentIds.has(String(k?.kitId))&&!selectedIds.has(String(k?.kitId))&&!pairIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId))
  const p=hardenGap(payload)
  p.kits=[...urgent.map((k,i)=>({...clone(k),priority:i+1})),...selectedOthers.map((k,i)=>({...clone(k),priority:100+i})),{...clone(pair.a),priority:500},{...clone(pair.b),priority:501},...rest.map((k,i)=>({...clone(k),priority:600+i})),{...clone(drop),priority:99999}]
  p.budgetSeconds=budgetSeconds
  p.urgentAnchorCount=Math.min(6,urgent.length||1)
  p._clientStrategy=`swap:${drop?.kitId}->${pair.a?.kitId}+${pair.b?.kitId}`
  return p
}

export async function solveWithSparrowLab(payload,{signal,onStage}={}){
  const safeRoot=hardenGap(payload)
  const base=(import.meta.env.VITE_SPARROW_LAB_URL||DEFAULT_LAB_URL).replace(/\/$/,'')
  const baseBudget=Math.max(90,Math.min(180,num(safeRoot?.budgetSeconds,150)))
  const swapBudget=Math.min(120,baseBudget)
  const attempts=[]
  let best=null

  const variants=buildBaseVariants(safeRoot,baseBudget)
  for(let i=0;i<variants.length;i++){
    const v=variants[i],label=`V9 base ${i+1}/${variants.length} · ${v._clientStrategy}`
    try{
      const r=await runJob(base,v,{signal,onStage,label,maxMs:6*60*1000})
      r.clientStrategy=v._clientStrategy
      attempts.push({phase:'base',strategy:v._clientStrategy,ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct),stripWidthMm:num(r.stripWidthMm),requestedGapMm:SAFETY_GAP_MM})
      best=better(best,r)
    }catch(e){attempts.push({phase:'base',strategy:v._clientStrategy,ok:false,error:String(e?.message||e),requestedGapMm:SAFETY_GAP_MM})}
  }
  if(!best)throw new Error('Sparrow V9 no consiguió ninguna placa base válida.')

  const all=orderedRawKits(safeRoot)
  const urgentIds=new Set(all.slice(0,6).map(k=>String(k?.kitId)))
  let round=0,keepGoing=true
  while(keepGoing&&round<2){
    round++
    keepGoing=false
    const drops=chooseDropCandidates(best,all,urgentIds)
    const outside=chooseOutside(best,all,urgentIds)
    let tested=0
    for(const drop of drops){
      for(const pair of pairCandidates(outside,drop)){
        if(tested>=6)break
        tested++
        const p=makeSwapPayload(safeRoot,best,drop,pair,swapBudget)
        const label=`V9 swap 1→2 · ronda ${round} · ${tested}/6`
        try{
          const r=await runJob(base,p,{signal,onStage,label,maxMs:5*60*1000})
          r.clientStrategy=p._clientStrategy
          attempts.push({phase:'swap-1x2',round,drop:drop?.kitId,add:[pair.a?.kitId,pair.b?.kitId],ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct),stripWidthMm:num(r.stripWidthMm),requestedGapMm:SAFETY_GAP_MM})
          const chosen=better(best,r)
          if(chosen!==best){best=chosen;keepGoing=true;break}
        }catch(e){attempts.push({phase:'swap-1x2',round,drop:drop?.kitId,add:[pair.a?.kitId,pair.b?.kitId],ok:false,error:String(e?.message||e),requestedGapMm:SAFETY_GAP_MM})}
      }
      if(keepGoing)break
    }
  }

  onStage?.(`Sparrow V9 · mejor placa: ${completeCount(best)} figuras · ${num(best.geometricOccupancyPct).toFixed(1)}% · GAP solicitado ${SAFETY_GAP_MM.toFixed(1)} mm`)
  best.clientOrchestratorAttempts=attempts
  best.engine='Sparrow V9 production fallback 1x2'
  best.build='client-v9-gap38-fast-swap12-2026-08-24'
  best.requestedGapMm=SAFETY_GAP_MM

  return {
    raw:best,
    engine:best.engine,
    completeFigures:completeCount(best),
    placements:Array.isArray(best.placements)?best.placements:[],
    geometricOccupancyPct:num(best.geometricOccupancyPct),
    stripWidthUsagePct:num(best.stripWidthUsagePct),
    materialInsideUsedStripPct:num(best.materialInsideUsedStripPct),
    sparrowReportedDensityPct:num(best.sparrowReportedDensityPct),
    stripWidthMm:num(best.stripWidthMm),
    gapMm:num(best.gapMm,SAFETY_GAP_MM),
    requestedGapMm:SAFETY_GAP_MM,
    attempts,
    noArtificialMinimum:best.noArtificialMinimum===true,
    selectionStrategy:'V9: urgentes + 3 estrategias + swap 1→2 + GAP interno 3.8 mm + certificación final >=3.0 mm'
  }
}
