const DEFAULT_LAB_URL='https://polifan-sparrow-clean-docker.onrender.com'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const clone=v=>JSON.parse(JSON.stringify(v))
const SAFETY_GAP_CM=.31
const SAFETY_GAP_MM=3.1

const areaOfKit=k=>{
  let total=0
  for(const p of (k?.parts||[])){
    const w=num(p?.sourceWidthCm??p?.widthCm)
    const h=num(p?.sourceHeightCm??p?.heightCm)
    total+=Math.max(0,w*h)
  }
  return total
}

const selectedIdsFromResult=r=>{
  const explicit=Array.isArray(r?.selectedKitIds)?r.selectedKitIds.filter(Boolean):[]
  if(explicit.length)return new Set(explicit.map(String))
  const ids=(Array.isArray(r?.placements)?r.placements:[]).map(p=>p?.kitId).filter(Boolean).map(String)
  return new Set(ids)
}

const completeCount=r=>{
  const direct=num(r?.completeFigures,NaN)
  if(Number.isFinite(direct))return direct
  return selectedIdsFromResult(r).size
}

const scoreTuple=r=>[
  completeCount(r),
  num(r?.geometricOccupancyPct),
  -num(r?.stripWidthMm,1e9)
]

const better=(a,b)=>{
  if(!a)return b
  if(!b)return a
  const x=scoreTuple(a),y=scoreTuple(b)
  for(let i=0;i<x.length;i++){
    if(y[i]>x[i])return b
    if(y[i]<x[i])return a
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
  const big=rest.slice().sort((a,b)=>areaOfKit(b)-areaOfKit(a))
  const small=rest.slice().sort((a,b)=>areaOfKit(a)-areaOfKit(b))
  const zig=[]
  for(let i=0,j=big.length-1;i<=j;i++,j--){
    if(i<=j)zig.push(big[i])
    if(j>i)zig.push(big[j])
  }
  return [
    makeVariant(payload,rest,urgent,'prioridad',budgetSeconds),
    makeVariant(payload,big,urgent,'grandes',budgetSeconds),
    makeVariant(payload,small,urgent,'chicas',budgetSeconds),
    makeVariant(payload,zig,urgent,'mezcla-grande-chica',budgetSeconds),
  ]
}

async function runJob(base,payload,{signal,onStage,label,maxMs=15*60*1000}={}){
  const safePayload=hardenGap(payload)
  onStage?.(`${label||'Sparrow'} · GAP interno ${SAFETY_GAP_MM.toFixed(1)} mm · iniciando…`)
  const startResponse=await fetch(`${base}/solve-start`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(safePayload),signal
  })
  let start=null
  try{start=await startResponse.json()}catch{}
  if(!startResponse.ok||!start?.jobId){
    throw new Error(`${label||'Sparrow'} no pudo iniciar: ${start?.error||`HTTP ${startResponse.status}`}`)
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
  return all.filter(k=>selected.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))).sort((a,b)=>areaOfKit(b)-areaOfKit(a)).slice(0,6)
}

const chooseOutside=(best,all,urgentIds,limit=18)=>{
  const selected=selectedIdsFromResult(best)
  return all.filter(k=>!selected.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))).sort((a,b)=>areaOfKit(a)-areaOfKit(b)).slice(0,limit)
}

const pairCandidates=(outside,drop)=>{
  const target=areaOfKit(drop),pairs=[]
  for(let i=0;i<outside.length;i++)for(let j=i+1;j<outside.length;j++){
    const a=outside[i],b=outside[j],sum=areaOfKit(a)+areaOfKit(b),ratio=target>0?sum/target:1
    if(ratio<.45||ratio>1.9)continue
    pairs.push({a,b,delta:Math.abs(sum-target),sum})
  }
  return pairs.sort((x,y)=>x.delta-y.delta||y.sum-x.sum).slice(0,10)
}

const makeSwapPayload=(payload,best,drop,pair,budgetSeconds)=>{
  const all=orderedRawKits(payload),urgent=all.slice(0,6),urgentIds=new Set(urgent.map(k=>String(k?.kitId))),selectedIds=selectedIdsFromResult(best),selectedOthers=all.filter(k=>selectedIds.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId)),pairIds=new Set([String(pair.a?.kitId),String(pair.b?.kitId)]),rest=all.filter(k=>!urgentIds.has(String(k?.kitId))&&!selectedIds.has(String(k?.kitId))&&!pairIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId)),ordered=[...selectedOthers,pair.a,pair.b,...rest,drop]
  const p=hardenGap(payload)
  p.kits=[...urgent.map((k,i)=>({...clone(k),priority:i+1})),...ordered.map((k,i)=>({...clone(k),priority:100+i}))]
  p.budgetSeconds=budgetSeconds
  p.urgentAnchorCount=Math.min(6,urgent.length||1)
  p._clientStrategy=`swap:${drop?.kitId}->${pair.a?.kitId}+${pair.b?.kitId}`
  return p
}

const dropPairCandidates=(best,all,urgentIds)=>{
  const selected=selectedIdsFromResult(best)
  const rows=all.filter(k=>selected.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))).sort((a,b)=>areaOfKit(b)-areaOfKit(a)).slice(0,7)
  const pairs=[]
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)pairs.push({a:rows[i],b:rows[j],area:areaOfKit(rows[i])+areaOfKit(rows[j])})
  return pairs.sort((x,y)=>y.area-x.area).slice(0,6)
}

const tripleCandidates=(outside,dropPair)=>{
  const target=num(dropPair?.area),triples=[]
  for(let i=0;i<outside.length;i++)for(let j=i+1;j<outside.length;j++)for(let k=j+1;k<outside.length;k++){
    const a=outside[i],b=outside[j],c=outside[k]
    const sum=areaOfKit(a)+areaOfKit(b)+areaOfKit(c)
    const ratio=target>0?sum/target:1
    if(ratio<.55||ratio>1.75)continue
    triples.push({a,b,c,sum,delta:Math.abs(sum-target)})
  }
  return triples.sort((x,y)=>x.delta-y.delta||y.sum-x.sum).slice(0,6)
}

const makeSwap2x3Payload=(payload,best,dropPair,triple,budgetSeconds)=>{
  const all=orderedRawKits(payload)
  const urgent=all.slice(0,6)
  const urgentIds=new Set(urgent.map(k=>String(k?.kitId)))
  const selectedIds=selectedIdsFromResult(best)
  const dropIds=new Set([String(dropPair.a?.kitId),String(dropPair.b?.kitId)])
  const addIds=new Set([String(triple.a?.kitId),String(triple.b?.kitId),String(triple.c?.kitId)])
  const selectedOthers=all.filter(k=>selectedIds.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))&&!dropIds.has(String(k?.kitId)))
  const rest=all.filter(k=>!urgentIds.has(String(k?.kitId))&&!selectedIds.has(String(k?.kitId))&&!addIds.has(String(k?.kitId))&&!dropIds.has(String(k?.kitId)))
  const ordered=[...selectedOthers,triple.a,triple.b,triple.c,...rest,dropPair.a,dropPair.b]
  const p=hardenGap(payload)
  p.kits=[...urgent.map((k,i)=>({...clone(k),priority:i+1})),...ordered.map((k,i)=>({...clone(k),priority:100+i}))]
  p.budgetSeconds=budgetSeconds
  p.urgentAnchorCount=Math.min(6,urgent.length||1)
  p._clientStrategy=`swap2x3:${dropPair.a?.kitId}+${dropPair.b?.kitId}->${triple.a?.kitId}+${triple.b?.kitId}+${triple.c?.kitId}`
  return p
}

export async function solveWithSparrowLab(payload,{signal,onStage}={}){
  const safeRoot=hardenGap(payload)
  const base=(import.meta.env.VITE_SPARROW_LAB_URL||DEFAULT_LAB_URL).replace(/\/$/,'')
  const baseBudget=Math.max(90,Math.min(240,num(safeRoot?.budgetSeconds,180)))
  const strategyBudget=Math.min(180,baseBudget)
  const swapBudget=Math.min(150,baseBudget)
  const swap2x3Budget=Math.min(120,baseBudget)
  const attempts=[]
  let best=null

  const variants=buildBaseVariants(safeRoot,strategyBudget)
  for(let i=0;i<variants.length;i++){
    const v=variants[i],label=`V8 base ${i+1}/${variants.length} · ${v._clientStrategy}`
    try{
      const r=await runJob(base,v,{signal,onStage,label,maxMs:7*60*1000})
      r.clientStrategy=v._clientStrategy
      attempts.push({phase:'base',strategy:v._clientStrategy,ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct),stripWidthMm:num(r.stripWidthMm),requestedGapMm:SAFETY_GAP_MM})
      best=better(best,r)
    }catch(e){attempts.push({phase:'base',strategy:v._clientStrategy,ok:false,error:String(e?.message||e),requestedGapMm:SAFETY_GAP_MM})}
  }
  if(!best)throw new Error('Sparrow V8 no consiguió ninguna placa base válida.')

  const all=orderedRawKits(safeRoot),urgentIds=new Set(all.slice(0,6).map(k=>String(k?.kitId)))
  let improved=true,round=0
  while(improved&&round<2){
    improved=false;round++
    const drops=chooseDropCandidates(best,all,urgentIds),outside=chooseOutside(best,all,urgentIds,18)
    let tested=0
    for(const drop of drops){
      for(const pair of pairCandidates(outside,drop)){
        if(tested>=10)break
        tested++
        const before=best,p=makeSwapPayload(safeRoot,best,drop,pair,swapBudget),label=`V8 swap 1→2 · ronda ${round} · ${tested}/10`
        try{
          const r=await runJob(base,p,{signal,onStage,label,maxMs:6*60*1000})
          r.clientStrategy=p._clientStrategy
          attempts.push({phase:'swap-1x2',round,drop:drop?.kitId,add:[pair.a?.kitId,pair.b?.kitId],ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct),stripWidthMm:num(r.stripWidthMm),requestedGapMm:SAFETY_GAP_MM})
          const chosen=better(best,r)
          if(chosen!==best){best=chosen;improved=true;break}
        }catch(e){attempts.push({phase:'swap-1x2',round,drop:drop?.kitId,add:[pair.a?.kitId,pair.b?.kitId],ok:false,error:String(e?.message||e),requestedGapMm:SAFETY_GAP_MM})}
        best=better(before,best)
      }
      if(improved)break
    }
  }

  // V8: una búsqueda más profunda, pero acotada. Sólo 6 intentos máximos de 2→3.
  // Busca ganar una figura completa adicional sin tocar los 6 urgentes protegidos.
  const outside23=chooseOutside(best,all,urgentIds,16)
  let tested23=0,improved23=false
  for(const dropPair of dropPairCandidates(best,all,urgentIds)){
    for(const triple of tripleCandidates(outside23,dropPair)){
      if(tested23>=6||improved23)break
      tested23++
      const p=makeSwap2x3Payload(safeRoot,best,dropPair,triple,swap2x3Budget)
      const label=`V8 swap 2→3 · ${tested23}/6`
      try{
        const beforeCount=completeCount(best)
        const r=await runJob(base,p,{signal,onStage,label,maxMs:5*60*1000})
        r.clientStrategy=p._clientStrategy
        attempts.push({phase:'swap-2x3',drop:[dropPair.a?.kitId,dropPair.b?.kitId],add:[triple.a?.kitId,triple.b?.kitId,triple.c?.kitId],ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct),stripWidthMm:num(r.stripWidthMm),requestedGapMm:SAFETY_GAP_MM})
        const chosen=better(best,r)
        if(chosen!==best&&completeCount(chosen)>=beforeCount){best=chosen;improved23=true}
      }catch(e){attempts.push({phase:'swap-2x3',drop:[dropPair.a?.kitId,dropPair.b?.kitId],add:[triple.a?.kitId,triple.b?.kitId,triple.c?.kitId],ok:false,error:String(e?.message||e),requestedGapMm:SAFETY_GAP_MM})}
    }
    if(tested23>=6||improved23)break
  }

  onStage?.(`Sparrow V8 · mejor placa: ${completeCount(best)} figuras · ${num(best.geometricOccupancyPct).toFixed(1)}% · GAP solicitado ${SAFETY_GAP_MM.toFixed(1)} mm`)
  best.clientOrchestratorAttempts=attempts
  best.engine='Sparrow V8 client local-search 1x2 + 2x3'
  best.build='client-v8-gap31-swap12-swap23-2026-08-24'
  best.requestedGapMm=SAFETY_GAP_MM

  return {raw:best,engine:best.engine,completeFigures:completeCount(best),placements:Array.isArray(best.placements)?best.placements:[],geometricOccupancyPct:num(best.geometricOccupancyPct),stripWidthUsagePct:num(best.stripWidthUsagePct),materialInsideUsedStripPct:num(best.materialInsideUsedStripPct),sparrowReportedDensityPct:num(best.sparrowReportedDensityPct),stripWidthMm:num(best.stripWidthMm),gapMm:num(best.gapMm,SAFETY_GAP_MM),requestedGapMm:SAFETY_GAP_MM,attempts,noArtificialMinimum:best.noArtificialMinimum===true,selectionStrategy:'V8: prioridad + 4 estrategias + swap 1→2 + swap 2→3 + GAP 3.1 mm'}
}
