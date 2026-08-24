const DEFAULT_LAB_URL='https://polifan-sparrow-clean-docker.onrender.com'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const clone=v=>JSON.parse(JSON.stringify(v))

// V11: el problema no era sólo el gap. La cola cambió y exigir 6 urgentes como
// anclas puede volver imposible cualquier placa base. Bajamos anclas de forma
// adaptativa sin perder prioridad, y mantenemos certificación final >=3.000 mm.
const GAP_LEVELS_MM=[3.2,3.1]
const ANCHOR_LEVELS=[6,4,2,1]
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

const makeVariant=(payload,ordered,anchorCount,name,budgetSeconds,gapMm)=>{
  const raw=orderedRawKits(payload)
  const anchors=raw.slice(0,anchorCount)
  const anchorIds=new Set(anchors.map(k=>String(k?.kitId)))
  const restOrdered=ordered.filter(k=>!anchorIds.has(String(k?.kitId)))
  const p=hardenGap(payload,gapMm)
  p.kits=[...anchors.map((k,i)=>({...clone(k),priority:i+1})),...restOrdered.map((k,i)=>({...clone(k),priority:100+i}))]
  p.budgetSeconds=budgetSeconds
  p.urgentAnchorCount=Math.max(1,Math.min(anchorCount,anchors.length||1))
  p._clientStrategy=name
  return p
}

const buildOrders=(payload)=>{
  const raw=orderedRawKits(payload)
  const byPriority=raw.slice()
  const bySmall=raw.slice().sort((a,b)=>areaOfKit(a)-areaOfKit(b))
  const byBig=raw.slice().sort((a,b)=>areaOfKit(b)-areaOfKit(a))
  const zig=[]
  for(let i=0,j=byBig.length-1;i<=j;i++,j--){if(i<=j)zig.push(byBig[i]);if(j>i)zig.push(byBig[j])}
  return {byPriority,bySmall,zig}
}

async function runJob(base,payload,{signal,onStage,label,maxMs=4*60*1000}={}){
  const requested=num(payload?.requiredGapMm,3.1)
  const anchors=num(payload?.urgentAnchorCount,1)
  onStage?.(`${label||'Sparrow'} · GAP ${requested.toFixed(1)} mm · anclas urgentes ${anchors} · iniciando…`)
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
    if(job?.status==='running'){onStage?.(`${label||'Sparrow'} · ${Math.round(elapsed)} s · GAP ${requested.toFixed(1)} mm · anclas ${anchors}`);if(Date.now()-startedAt>maxMs)throw new Error(`${label||'Sparrow'} superó el tiempo máximo.`);continue}
    if(job?.status==='error')throw new Error(`${label||'Sparrow'} terminó con error: ${job?.result?.error||job?.error||'sin detalle'}`)
    const data=job?.result||job
    if(job?.status!=='done'||!data?.ok)throw new Error(`${label||'Sparrow'} terminó sin placa válida: ${data?.error||'respuesta inválida'}`)
    data.requestedGapMm=requested;data.usedUrgentAnchors=anchors;return data
  }
}

const chooseDropCandidates=(best,all,protectedIds)=>{const selected=selectedIdsFromResult(best);return all.filter(k=>selected.has(String(k?.kitId))&&!protectedIds.has(String(k?.kitId))).sort((a,b)=>areaOfKit(b)-areaOfKit(a)).slice(0,4)}
const chooseOutside=(best,all,protectedIds)=>{const selected=selectedIdsFromResult(best);return all.filter(k=>!selected.has(String(k?.kitId))&&!protectedIds.has(String(k?.kitId))).sort((a,b)=>areaOfKit(a)-areaOfKit(b)).slice(0,14)}
const pairCandidates=(outside,drop)=>{const target=areaOfKit(drop),pairs=[];for(let i=0;i<outside.length;i++)for(let j=i+1;j<outside.length;j++){const a=outside[i],b=outside[j],sum=areaOfKit(a)+areaOfKit(b),ratio=target>0?sum/target:1;if(ratio<.45||ratio>1.9)continue;pairs.push({a,b,delta:Math.abs(sum-target),sum})}return pairs.sort((x,y)=>x.delta-y.delta||y.sum-x.sum).slice(0,4)}

const makeSwapPayload=(payload,best,drop,pair,budgetSeconds,gapMm,anchorCount)=>{
  const all=orderedRawKits(payload),anchors=all.slice(0,anchorCount),protectedIds=new Set(anchors.map(k=>String(k?.kitId))),selectedIds=selectedIdsFromResult(best)
  const selectedOthers=all.filter(k=>selectedIds.has(String(k?.kitId))&&!protectedIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId))
  const pairIds=new Set([String(pair.a?.kitId),String(pair.b?.kitId)])
  const rest=all.filter(k=>!protectedIds.has(String(k?.kitId))&&!selectedIds.has(String(k?.kitId))&&!pairIds.has(String(k?.kitId))&&String(k?.kitId)!==String(drop?.kitId))
  const p=hardenGap(payload,gapMm)
  p.kits=[...anchors.map((k,i)=>({...clone(k),priority:i+1})),...selectedOthers.map((k,i)=>({...clone(k),priority:100+i})),{...clone(pair.a),priority:500},{...clone(pair.b),priority:501},...rest.map((k,i)=>({...clone(k),priority:600+i})),{...clone(drop),priority:99999}]
  p.budgetSeconds=budgetSeconds;p.urgentAnchorCount=Math.max(1,anchorCount);p._clientStrategy=`swap:${drop?.kitId}->${pair.a?.kitId}+${pair.b?.kitId}`;return p
}

export async function solveWithSparrowLab(payload,{signal,onStage}={}){
  const base=(import.meta.env.VITE_SPARROW_LAB_URL||DEFAULT_LAB_URL).replace(/\/$/,'')
  const baseBudget=Math.max(75,Math.min(120,num(payload?.budgetSeconds,100))),swapBudget=Math.min(90,baseBudget),attempts=[]
  const orders=buildOrders(payload)
  let best=null,usedGapMm=null,usedAnchors=null

  // Primero buscamos UNA base válida. Si 6 urgentes no entran juntas, no abortamos:
  // bajamos a 4, 2 y 1, manteniendo siempre la prioridad cronológica.
  outer: for(const gapMm of GAP_LEVELS_MM){
    for(const anchorCount of ANCHOR_LEVELS){
      const probe=makeVariant(payload,orders.byPriority,anchorCount,'prioridad',baseBudget,gapMm)
      try{
        const r=await runJob(base,probe,{signal,onStage,label:`V11 base · GAP ${gapMm.toFixed(1)} · anclas ${anchorCount}`,maxMs:3*60*1000})
        r.clientStrategy='prioridad';attempts.push({phase:'base-probe',gapMm,anchorCount,ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct)});best=r;usedGapMm=gapMm;usedAnchors=anchorCount;break outer
      }catch(e){attempts.push({phase:'base-probe',gapMm,anchorCount,ok:false,error:String(e?.message||e)})}
    }
  }
  if(!best)throw new Error('Sparrow V11 no consiguió una base válida ni reduciendo las anclas urgentes. No se generó una placa insegura.')

  // Con una base ya encontrada, probamos sólo dos ordenamientos extra y luego swaps 1→2.
  for(const [name,order] of [['chicas',orders.bySmall],['mezcla',orders.zig]]){
    try{const p=makeVariant(payload,order,usedAnchors,name,baseBudget,usedGapMm),r=await runJob(base,p,{signal,onStage,label:`V11 base extra · ${name}`,maxMs:3*60*1000});r.clientStrategy=name;attempts.push({phase:'base-extra',gapMm:usedGapMm,anchorCount:usedAnchors,strategy:name,ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct)});best=better(best,r)}catch(e){attempts.push({phase:'base-extra',strategy:name,ok:false,error:String(e?.message||e)})}
  }

  const all=orderedRawKits(payload),protectedIds=new Set(all.slice(0,usedAnchors).map(k=>String(k?.kitId))),drops=chooseDropCandidates(best,all,protectedIds),outside=chooseOutside(best,all,protectedIds)
  let tested=0
  for(const drop of drops){for(const pair of pairCandidates(outside,drop)){if(tested>=4)break;tested++;const p=makeSwapPayload(payload,best,drop,pair,swapBudget,usedGapMm,usedAnchors);try{const r=await runJob(base,p,{signal,onStage,label:`V11 swap 1→2 · ${tested}/4`,maxMs:3*60*1000});r.clientStrategy=p._clientStrategy;attempts.push({phase:'swap-1x2',ok:true,completeFigures:completeCount(r),occupancy:num(r.geometricOccupancyPct)});best=better(best,r)}catch(e){attempts.push({phase:'swap-1x2',ok:false,error:String(e?.message||e)})}}if(tested>=4)break}

  onStage?.(`Sparrow V11 · mejor placa: ${completeCount(best)} figuras · ${num(best.geometricOccupancyPct).toFixed(1)}% · GAP interno ${usedGapMm.toFixed(1)} mm · anclas urgentes ${usedAnchors} · certificación final >=3.0 mm`)
  best.clientOrchestratorAttempts=attempts;best.engine='Sparrow V11 adaptive anchors + safe gap';best.build='client-v11-adaptive-anchors-2026-08-24';best.requestedGapMm=usedGapMm;best.usedUrgentAnchors=usedAnchors
  return {raw:best,engine:best.engine,completeFigures:completeCount(best),placements:Array.isArray(best.placements)?best.placements:[],geometricOccupancyPct:num(best.geometricOccupancyPct),stripWidthUsagePct:num(best.stripWidthUsagePct),materialInsideUsedStripPct:num(best.materialInsideUsedStripPct),sparrowReportedDensityPct:num(best.sparrowReportedDensityPct),stripWidthMm:num(best.stripWidthMm),gapMm:num(best.gapMm,usedGapMm),requestedGapMm:usedGapMm,usedUrgentAnchors:usedAnchors,attempts,noArtificialMinimum:best.noArtificialMinimum===true,selectionStrategy:`V11: gap ${usedGapMm.toFixed(1)} mm + anclas urgentes adaptativas ${usedAnchors} + swap 1→2 + certificación final >=3.0 mm`}
}
