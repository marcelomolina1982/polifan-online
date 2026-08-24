const DEFAULT_LAB_URL='https://polifan-sparrow-clean-docker.onrender.com'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const clone=v=>JSON.parse(JSON.stringify(v))

// V10: 3.8 mm resultó demasiado restrictivo y dejó la corrida sin placa base.
// Usamos escalones adaptativos: intentamos primero 3.4 mm y, si no hay base,
// 3.2 mm. La seguridad productiva NO se relaja: el certificador final sigue
// exigiendo >= 3.000 mm reales, 0 conflictos y 0 bordes.
const GAP_LEVELS_MM=[3.4,3.2]
const FINAL_REQUIRED_GAP_MM=3

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
const completeCount=r=>{const direct=num(r?.completeFigures,NaN);return Number.isFinite(direct)?direct:selectedIdsFromResult(r).size}
const better=(a,b)=>{
  if(!a)return b;if(!b)return a
  const A=[completeCount(a),num(a?.geometricOccupancyPct),-num(a?.stripWidthMm,1e9)]
  const B=[completeCount(b),num(b?.geometricOccupancyPct),-num(b?.stripWidthMm,1e9)]
  for(let i=0;i<A.length;i++){if(B[i]>A[i])return b;if(B[i]<A[i])return a}return a
}
const orderedRawKits=payload=>(payload?.kits||[]).slice().sort((a,b)=>(num(a?.priority,999999)-num(b?.priority,999999))||String(a?.date||'').localeCompare(String(b?.date||''))||String(a?.figure||'').localeCompare(String(b?.figure||'')))

const hardenGap=(payload,gapMm)=>{
  const p=clone(payload)
  p.gapCm=gapMm/10
  p.requiredGapMm=gapMm
  p.minimumGapMm=gapMm
  p.preferredGapMm=gapMm
  p.finalRequiredGapMm=FINAL_REQUIRED_GAP_MM
  return p
}
const makeVariant=(payload,ordered,urgent,name,budgetSeconds,gapMm)=>{
  const p=hardenGap(payload,gapMm)
  p.kits=[...urgent.map((k,i)=>({...clone(k),priority:i+1})),...ordered.map((k,i)=>({...clone(k),priority:100+i}))]
  p.budgetSeconds=budgetSeconds;p.urgentAnchorCount=Math.min(6,urgent.length||1);p._clientStrategy=name;return p
}
const buildBaseVariants=(payload,budgetSeconds,gapMm)=>{
  const raw=orderedRawKits(payload),urgent=raw.slice(0,6),rest=raw.slice(6)
  const small=rest.slice().sort((a,b)=>areaOfKit(a)-areaOfKit(b)),big=rest.slice().sort((a,b)=>areaOfKit(b)-areaOfKit(a)),zig=[]
  for(let i=0,j=big.length-1;i<=j;i++,j--){if(i<=j)zig.push(big[i]);if(j>i)zig.push(big[j])}
  return [makeVariant(payload,rest,urgent,'prioridad',budgetSeconds,gapMm),makeVariant(payload,small,urgent,'chicas',budgetSeconds,gapMm),makeVariant(payload,zig,urgent,'mezcla-grande-chica',budgetSeconds,gapMm)]
}

async function runJob(base,payload,{signal,onStage,label,maxMs=5*60*1000}={}){
  const requested=num(payload?.requiredGapMm,3.2)
  onStage?.(`${label||'Sparrow'} · GAP interno ${requested.toFixed(1)} mm · iniciando…`)
  const startResponse=await fetch(`${base}/solve-start`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal})
  let start=null;try{start=await startResponse.json()}catch{}
  if(!startResponse.ok||!start?.jobId)throw new Error(`${label||'Sparrow'} no pudo iniciar: ${start?.error||`HTTP ${startResponse.status}`}`)
  const jobId=String(start.jobId),startedAt=Date.now()
  for(;;){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');await sleep(2000)
    const statusResponse=await fetch(`${base}/solve-status?id=${encodeURIComponent(jobId)}`,{headers:{Accept:'application/json'},cache:'no-store',signal})
    let job=null;try{job=await statusResponse.json()}catch{}
    if(!statusResponse.ok)throw new Error(`${label||'Sparrow'} no pudo consultar: ${job?.error||`HTTP ${statusResponse.status}`}`)
    const elapsed=num(job?.elapsedSeconds,(Date.now()-startedAt)/1000)
    if(job?.status==='running'){onStage?.(`${label||'Sparrow'} · ${Math.round(elapsed)} s · GAP interno ${requested.toFixed(1)} mm`);if(Date.now()-startedAt>maxMs)throw new Error(`${label||'Sparrow'} superó el tiempo máximo.`);continue}
    if(job?.status==='error')throw new Error(`${label||'Sparrow'} terminó con error: ${job?.result?.error||job?.error||'sin detalle'}`)
    const data=job?.result||job
    if(job?.status!=='done'||!data?.ok)throw new Error(`${label||'Sparrow'} terminó sin placa válida: ${data?.error||'respuesta inválida'}`)
    data.requestedGapMm=requested;return data
  }
}

const chooseDropCandidates=(best,all,urgentIds)=>{const selected=selectedIdsFromResult(best);return all.filter(k=>selected.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))).sort((a,b)=>areaOfKit(b)-areaOfKit(a)).slice(0,4)}
const chooseOutside=(best,all,urgentIds)=>{const selected=selectedIdsFromResult(best);return all.filter(k=>!selected.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))).sort((a,b)=>areaOfKit(a)-areaOfKit(b)).slice(0,14)}
const pairCandidates=(outside,drop)=>{const target=areaOfKit(drop),pairs=[];for(let i=0;i<outside.length;i++)for(let j=i+1;j<outside.length;j++){const a=outside[i],b=outside[j],sum=areaOfKit(a)+areaOfKit(b),ratio=target>0?sum/target:1;if(ratio<.45||ratio>1.9)continue;pairs.push({a,b,delta:Math.abs(sum-target),sum})}return pairs.sort((x,y)=>x.delta-y.delta||y.sum-x.sum).slice(0,4)}
const makeSwapPayload=(payload,best,drop,pair,budgetSeconds,gapMm)=>{
  const all=orderedRawKits(payload),urgent=all.slice(0,6),urgentIds=new Set(urgent.map(k=>String(k?.kitId))),selectedIds=selectedIdsFromResult(best)
  const selectedOthers=all.filter(k=>selectedIds.has(String(k?.kitId))&&!urgentIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId)),pairIds=new Set([String(pair.a?.kitId),String(pair.b?.kitId)])
  const rest=all.filter(k=>!urgentIds.has(String(k?.kitId))&&!selectedIds.has(String(k?.kitId))&&!pairIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId))
  const p=hardenGap(payload,gapMm);p.kits=[...urgent.map((k,i)=>({...clone(k),priority:i+1})),...selectedOthers.map((k,i)=>({...clone(k),priority:100+i})),{...clone(pair.a),priority:500},{...clone(pair.b),priority:501},...rest.map((k,i)=>({...clone(k),priority:600+i})),{...clone(drop),priority:99999}];p.budgetSeconds=budgetSeconds;p.urgentAnchorCount=Math.min(6,urgent.length||1);p._clientStrategy=`swap:${drop?.kitId}->${pair.a?.kitId}+${pair.b?.kitId}`;return p
}

export async function solveWithSparrowLab(payload,{signal,onStage}={}){
  const base=(import.meta.env.VITE_SPARROW_LAB_URL||DEFAULT_LAB_URL).replace(/\/$/,'')
  const baseBudget=Math.max(90,Math.min(150,num(payload?.budgetSeconds,120))),swapBudget=Math.min(100,baseBudget),attempts=[]
  let best=null,usedGapMm=null

  // No repetimos 3 estrategias en un gap imposible durante 40 minutos: por cada
  // escalón probamos prioridad primero; sólo si entra, profundizamos las otras dos.
  for(const gapMm of GAP_LEVELS_MM){
    const variants=buildBaseVariants(payload,baseBudget,gapMm)
    try{
      const r=await runJob(base,variants[0],{signal,onStage,label:`V10 base · prueba GAP ${gapMm.toFixed(1)} mm`,maxMs:4*60*1000})
      r.clientStrategy=variants[0]._clientStrategy;attempts.push({phase:'base-probe',gapMm,ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct)});best=r;usedGapMm=gapMm
      for(let i=1;i<variants.length;i++){
        try{const x=await runJob(base,variants[i],{signal,onStage,label:`V10 base ${i+1}/3 · GAP ${gapMm.toFixed(1)} mm`,maxMs:4*60*1000});x.clientStrategy=variants[i]._clientStrategy;attempts.push({phase:'base',gapMm,strategy:variants[i]._clientStrategy,ok:true,completeFigures:completeCount(x),occupancy:num(x.geometricOccupancyPct)});best=better(best,x)}catch(e){attempts.push({phase:'base',gapMm,strategy:variants[i]._clientStrategy,ok:false,error:String(e?.message||e)})}
      }
      break
    }catch(e){attempts.push({phase:'base-probe',gapMm,ok:false,error:String(e?.message||e)});onStage?.(`V10 · ${gapMm.toFixed(1)} mm no encontró base; probando siguiente margen…`)}
  }
  if(!best)throw new Error('Sparrow V10 no consiguió base ni con 3.4 ni con 3.2 mm. No se generó una placa insegura.')

  const all=orderedRawKits(payload),urgentIds=new Set(all.slice(0,6).map(k=>String(k?.kitId))),drops=chooseDropCandidates(best,all,urgentIds),outside=chooseOutside(best,all,urgentIds)
  let tested=0
  for(const drop of drops){for(const pair of pairCandidates(outside,drop)){if(tested>=4)break;tested++;const p=makeSwapPayload(payload,best,drop,pair,swapBudget,usedGapMm);try{const r=await runJob(base,p,{signal,onStage,label:`V10 swap 1→2 · ${tested}/4 · GAP ${usedGapMm.toFixed(1)} mm`,maxMs:4*60*1000});r.clientStrategy=p._clientStrategy;attempts.push({phase:'swap-1x2',gapMm:usedGapMm,ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct)});best=better(best,r)}catch(e){attempts.push({phase:'swap-1x2',gapMm:usedGapMm,ok:false,error:String(e?.message||e)})}}if(tested>=4)break}

  onStage?.(`Sparrow V10 · mejor placa: ${completeCount(best)} figuras · ${num(best.geometricOccupancyPct).toFixed(1)}% · GAP interno ${usedGapMm.toFixed(1)} mm · certificación final >=3.0 mm`)
  best.clientOrchestratorAttempts=attempts;best.engine='Sparrow V10 adaptive-gap 1x2';best.build='client-v10-adaptive-gap-2026-08-24';best.requestedGapMm=usedGapMm
  return {raw:best,engine:best.engine,completeFigures:completeCount(best),placements:Array.isArray(best.placements)?best.placements:[],geometricOccupancyPct:num(best.geometricOccupancyPct),stripWidthUsagePct:num(best.stripWidthUsagePct),materialInsideUsedStripPct:num(best.materialInsideUsedStripPct),sparrowReportedDensityPct:num(best.sparrowReportedDensityPct),stripWidthMm:num(best.stripWidthMm),gapMm:num(best.gapMm,usedGapMm),requestedGapMm:usedGapMm,attempts,noArtificialMinimum:best.noArtificialMinimum===true,selectionStrategy:`V10: gap adaptativo ${usedGapMm.toFixed(1)} mm + urgentes + swap 1→2 + certificación final >=3.0 mm`}
}
