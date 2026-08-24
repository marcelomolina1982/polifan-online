const DEFAULT_LAB_URL='https://polifan-sparrow-clean-docker.onrender.com'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const clone=v=>JSON.parse(JSON.stringify(v))

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

const makeVariant=(payload,ordered,urgent,name,budgetSeconds)=>{
  const p=clone(payload)
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
  onStage?.(`${label||'Sparrow'} · iniciando…`)
  const startResponse=await fetch(`${base}/solve-start`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal
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
      onStage?.(`${label||'Sparrow'} · ${Math.round(elapsed)} s`)
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
  return all
    .filter(k=>selected.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId)))
    .sort((a,b)=>areaOfKit(b)-areaOfKit(a))
    .slice(0,6)
}

const chooseOutside=(best,all,urgentIds)=>{
  const selected=selectedIdsFromResult(best)
  return all
    .filter(k=>!selected.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId)))
    .sort((a,b)=>areaOfKit(a)-areaOfKit(b))
    .slice(0,18)
}

const pairCandidates=(outside,drop)=>{
  const target=areaOfKit(drop)
  const pairs=[]
  for(let i=0;i<outside.length;i++)for(let j=i+1;j<outside.length;j++){
    const a=outside[i],b=outside[j]
    const sum=areaOfKit(a)+areaOfKit(b)
    const ratio=target>0?sum/target:1
    if(ratio<0.45||ratio>1.9)continue
    pairs.push({a,b,delta:Math.abs(sum-target),sum})
  }
  return pairs.sort((x,y)=>x.delta-y.delta||y.sum-x.sum).slice(0,10)
}

const makeSwapPayload=(payload,best,drop,pair,budgetSeconds)=>{
  const all=orderedRawKits(payload)
  const urgent=all.slice(0,6)
  const urgentIds=new Set(urgent.map(k=>String(k?.kitId)))
  const selectedIds=selectedIdsFromResult(best)
  const selectedOthers=all.filter(k=>selectedIds.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId))
  const pairIds=new Set([String(pair.a?.kitId),String(pair.b?.kitId)])
  const rest=all.filter(k=>!urgentIds.has(String(k?.kitId))&&!selectedIds.has(String(k?.kitId))&&!pairIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId))
  const ordered=[...selectedOthers,pair.a,pair.b,...rest,drop]
  const p=clone(payload)
  p.kits=[
    ...urgent.map((k,i)=>({...clone(k),priority:i+1})),
    ...ordered.map((k,i)=>({...clone(k),priority:100+i}))
  ]
  p.budgetSeconds=budgetSeconds
  p.urgentAnchorCount=Math.min(6,urgent.length||1)
  p._clientStrategy=`swap:${drop?.kitId}->${pair.a?.kitId}+${pair.b?.kitId}`
  return p
}

export async function solveWithSparrowLab(payload,{signal,onStage}={}){
  const base=(import.meta.env.VITE_SPARROW_LAB_URL||DEFAULT_LAB_URL).replace(/\/$/,'')
  const baseBudget=Math.max(90,Math.min(240,num(payload?.budgetSeconds,180)))
  const strategyBudget=Math.min(180,baseBudget)
  const swapBudget=Math.min(150,baseBudget)
  const attempts=[]
  let best=null

  // V7 cliente: una sola estrategia a la vez. No carga Vercel ni dispara cálculos paralelos.
  const variants=buildBaseVariants(payload,strategyBudget)
  for(let i=0;i<variants.length;i++){
    const v=variants[i]
    const label=`V7 base ${i+1}/${variants.length} · ${v._clientStrategy}`
    try{
      const r=await runJob(base,v,{signal,onStage,label,maxMs:7*60*1000})
      r.clientStrategy=v._clientStrategy
      attempts.push({phase:'base',strategy:v._clientStrategy,ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct),stripWidthMm:num(r.stripWidthMm)})
      best=better(best,r)
    }catch(e){
      attempts.push({phase:'base',strategy:v._clientStrategy,ok:false,error:String(e?.message||e)})
    }
  }
  if(!best)throw new Error('Sparrow V7 no consiguió ninguna placa base válida.')

  // Búsqueda local real 1→2. Se reconstruyen los usados desde placements si selectedKitIds falta.
  const all=orderedRawKits(payload)
  const urgentIds=new Set(all.slice(0,6).map(k=>String(k?.kitId)))
  let improved=true
  let round=0
  while(improved&&round<2){
    improved=false
    round++
    const drops=chooseDropCandidates(best,all,urgentIds)
    const outside=chooseOutside(best,all,urgentIds)
    let tested=0
    for(const drop of drops){
      for(const pair of pairCandidates(outside,drop)){
        if(tested>=10)break
        tested++
        const before=best
        const p=makeSwapPayload(payload,best,drop,pair,swapBudget)
        const label=`V7 swap ${round} · ${tested}/10`
        try{
          const r=await runJob(base,p,{signal,onStage,label,maxMs:6*60*1000})
          r.clientStrategy=p._clientStrategy
          attempts.push({phase:'swap-1x2',round,drop:drop?.kitId,add:[pair.a?.kitId,pair.b?.kitId],ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct),stripWidthMm:num(r.stripWidthMm)})
          const chosen=better(best,r)
          if(chosen!==best){best=chosen;improved=true;break}
        }catch(e){
          attempts.push({phase:'swap-1x2',round,drop:drop?.kitId,add:[pair.a?.kitId,pair.b?.kitId],ok:false,error:String(e?.message||e)})
        }
        best=better(before,best)
      }
      if(improved)break
    }
  }

  onStage?.(`Sparrow V7 · mejor placa: ${completeCount(best)} figuras · ${num(best.geometricOccupancyPct).toFixed(1)}%`)
  best.clientOrchestratorAttempts=attempts
  best.engine='Sparrow V7 client local-search 1x2'
  best.build='client-v7-swap-fixed-2026-08-24'

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
    gapMm:num(best.gapMm,3),
    attempts,
    noArtificialMinimum:best.noArtificialMinimum===true,
    selectionStrategy:'V7 cliente: prioridad + 4 estrategias + swap 1→2'
  }
}
