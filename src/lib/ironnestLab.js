const DEFAULT_IRONNEST_LAB_URL='https://polifan-ironnest-hardbound-lab.onrender.com'

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

export function ironNestLabUrl(){
  const configured=String((import.meta.env.VITE_IRONNEST_LAB_URL)||'').trim()
  return (configured||DEFAULT_IRONNEST_LAB_URL).replace(/\/$/,'')
}

export function buildIronNestPayload(kits,{optimizationMode='fast'}={}){
  return {
    optimizationMode,
    kits:(kits||[]).map(k=>({
      kitId:k.kitId,
      figure:k.figure,
      priority:k.priority,
      date:k.date||'',
      source:k.source||'pedido',
      parts:(k.parts||[]).map(part=>({
        instanceId:part.instanceId,
        id:part.id,
        kitId:part.kitId,
        figure:part.figure,
        name:part.name,
        role:part.role||'simple',
        sourceWidthCm:Number(part.sourceWidthCm??part.sourceWidth??part.widthCm??part.width),
        sourceHeightCm:Number(part.sourceHeightCm??part.sourceHeight??part.heightCm??part.height),
        allowRotate:part.allowRotate!==false,
        svgText:part.svgText
      }))
    }))
  }
}

async function readJson(response){
  const text=await response.text()
  try{return JSON.parse(text)}catch{throw new Error(`IronNest devolvio una respuesta invalida (${response.status})`)}
}

export async function solveWithIronNestLab(kits,{
  optimizationMode='fast',
  pollMs=1500,
  timeoutMs=210000,
  signal,
  onProgress,
  onJobStarted
}={}){
  if(!Array.isArray(kits)||!kits.length)throw new Error('No hay kits completos para enviar a IronNest.')
  const pieceCount=kits.reduce((sum,k)=>sum+(k.parts?.length||0),0)
  if(pieceCount>60)throw new Error(`IronNest laboratorio admite hasta 60 piezas por intento; este lote tiene ${pieceCount}.`)
  const base=ironNestLabUrl()
  const payload=buildIronNestPayload(kits,{optimizationMode})
  onProgress?.({stage:'IronNest laboratorio · enviando kits completos…',percent:5})
  const startResponse=await fetch(`${base}/ironnest/solve-start`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal
  })
  const started=await readJson(startResponse)
  if(!startResponse.ok||!started?.ok||!started?.jobId)throw new Error(started?.error||`No se pudo iniciar IronNest (${startResponse.status}).`)
  const jobId=started.jobId,start=Date.now()
  onJobStarted?.({jobId,labUrl:base,startedAt:start})
  while(Date.now()-start<timeoutMs){
    if(signal?.aborted)throw new DOMException('Operacion cancelada','AbortError')
    await sleep(pollMs)
    const statusResponse=await fetch(`${base}/ironnest/solve-status?id=${encodeURIComponent(jobId)}`,{signal})
    const status=await readJson(statusResponse)
    const elapsed=(Date.now()-start)/1000
    if(statusResponse.status===202){
      onProgress?.({stage:`IronNest laboratorio · ${status.status||'calculando'}…`,percent:Math.min(92,8+elapsed/2),elapsed})
      continue
    }
    if(!statusResponse.ok||!status?.ok||!status?.result?.ok){
      throw new Error(status?.result?.error||status?.error||`IronNest rechazo el lote (${statusResponse.status}).`)
    }
    const result=status.result
    const minimumGap=result.layoutValidation?.minimumMeasuredGapMm
    onProgress?.({stage:'IronNest laboratorio · geometria validada',percent:100,elapsed,minimumGapMm:minimumGap})
    return {...result,jobId,labUrl:base}
  }
  throw new Error(`IronNest laboratorio supero ${Math.round(timeoutMs/1000)} segundos.`)
}


function completeKitPieceCount(kits){
  return (kits||[]).reduce((sum,k)=>sum+(k.parts?.length||0),0)
}

function kitAreaScore(kit){
  return (kit.parts||[]).reduce((sum,p)=>sum+Number(p.sourceWidth||p.width||0)*Number(p.sourceHeight||p.height||0),0)
}

function uniqueKitVariants(kits,target){
  const ordered=[...(kits||[])].sort((a,b)=>Number(a.priority||0)-Number(b.priority||0))
  const variants=[]
  const push=list=>{
    const picked=list.slice(0,target)
    if(picked.length!==target||completeKitPieceCount(picked)>60)return
    const key=picked.map(k=>k.kitId).join('|')
    if(!variants.some(v=>v.key===key))variants.push({key,kits:picked})
  }
  push(ordered)
  push([...ordered].sort((a,b)=>Number(a.priority||0)-Number(b.priority||0)||kitAreaScore(a)-kitAreaScore(b)))
  const urgent=ordered.slice(0,Math.max(target,Math.ceil(target*1.6)))
  push([...urgent].sort((a,b)=>kitAreaScore(a)-kitAreaScore(b)))
  return variants
}

export async function solveCompleteKitsWithIronNestLab(kits,{
  targetComplete=10,
  maxGrowth=16,
  optimizationMode='fast',
  signal,
  onProgress
}={}){
  const available=Array.isArray(kits)?kits.length:0
  if(!available)throw new Error('No hay kits completos para calcular.')
  // PRODUCCIÓN: resolver la base y luego crecer de a UN kit. Así 11/12/etc.
  // sólo se intentan si la placa anterior ya fue válida, sin disparar una cartera de trabajos.
  const target=Math.min(Math.max(1,Number(targetComplete)||10),available,10)
  const variants=uniqueKitVariants(kits,target)
  let lastError=null
  for(let i=0;i<variants.length;i++){
    if(signal?.aborted)throw new DOMException('Operacion cancelada','AbortError')
    onProgress?.({stage:`IronNest · calculando placa de ${target} figuras completas…`,percent:5,completeFigures:0})
    try{
      const result=await solveWithIronNestLab(variants[i].kits,{optimizationMode,signal,onProgress})
      let best={...result,selectedKits:variants[i].kits,kitCount:variants[i].kits.length}
      const ordered=[...(kits||[])].sort((a,b)=>Number(a.priority||0)-Number(b.priority||0))
      const limit=Math.min(available,Math.max(target,Number(maxGrowth)||target))
      for(let grow=target+1;grow<=limit;grow++){
        const candidate=ordered.slice(0,grow)
        if(candidate.length!==grow||completeKitPieceCount(candidate)>60)break
        onProgress?.({stage:`IronNest · ${best.kitCount} entraron; probando ${grow}…`,percent:92,completeFigures:best.kitCount})
        try{
          const grown=await solveWithIronNestLab(candidate,{optimizationMode,signal,onProgress})
          best={...grown,selectedKits:candidate,kitCount:candidate.length}
        }catch{break}
      }
      onProgress?.({stage:`IronNest · ${best.kitCount} figuras completas validadas`,percent:100,completeFigures:best.kitCount,minimumGapMm:best.layoutValidation?.minimumMeasuredGapMm})
      return best
    }catch(error){lastError=error}
  }
  // Si 10 no entran, reducir de a un kit, sin crecimiento posterior.
  for(let t=target-1;t>=1;t--){
    const smaller=uniqueKitVariants(kits,t)
    for(let i=0;i<smaller.length;i++){
      if(signal?.aborted)throw new DOMException('Operacion cancelada','AbortError')
      onProgress?.({stage:`IronNest · buscando placa válida de ${t} figuras completas…`,percent:5,completeFigures:0})
      try{
        const result=await solveWithIronNestLab(smaller[i].kits,{optimizationMode,signal,onProgress})
        return {...result,selectedKits:smaller[i].kits,kitCount:smaller[i].kits.length}
      }catch(error){lastError=error}
    }
  }
  throw lastError||new Error('IronNest no encontró una placa completa válida.')
}

