const DEFAULT_IRONNEST_LAB_URL='https://polifan-ironnest-hardbound-lab.onrender.com'

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

export function ironNestLabUrl(){
  const configured=String(import.meta.env.VITE_IRONNEST_LAB_URL||'').trim()
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
        sourceWidthCm:Number(part.sourceWidth||part.width),
        sourceHeightCm:Number(part.sourceHeight||part.height),
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
  onProgress
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
  const startTarget=Math.min(Math.max(1,Number(targetComplete)||10),available)
  let best=null,lastError=null

  const tryTarget=async target=>{
    const variants=uniqueKitVariants(kits,target)
    for(let i=0;i<variants.length;i++){
      if(signal?.aborted)throw new DOMException('Operacion cancelada','AbortError')
      onProgress?.({stage:`IronNest LAB · probando ${target} figuras completas (${i+1}/${variants.length})…`,percent:5,completeFigures:best?.kitCount||0})
      try{
        const result=await solveWithIronNestLab(variants[i].kits,{optimizationMode,signal,onProgress})
        return {...result,selectedKits:variants[i].kits,kitCount:variants[i].kits.length}
      }catch(error){lastError=error}
    }
    return null
  }

  best=await tryTarget(startTarget)
  if(!best){
    for(let target=startTarget-1;target>=1&&!best;target--)best=await tryTarget(target)
  }
  if(!best)throw lastError||new Error('IronNest LAB no encontro un subconjunto completo valido.')

  const ceiling=Math.min(available,Math.max(best.kitCount,Number(maxGrowth)||16))
  for(let target=best.kitCount+1;target<=ceiling;target++){
    // Crecimiento útil: conservar los kits completos ya certificados y probar
    // qué kit pendiente cabe entero en los huecos. Nunca agrega base/tapa suelta.
    const selectedIds=new Set((best.selectedKits||[]).map(k=>k.kitId))
    const pending=(kits||[])
      .filter(k=>!selectedIds.has(k.kitId))
      .sort((a,b)=>kitAreaScore(a)-kitAreaScore(b)||Number(a.priority||0)-Number(b.priority||0))
      .slice(0,6)
    let grown=null
    for(let i=0;i<pending.length&&!grown;i++){
      const candidate=[...(best.selectedKits||[]),pending[i]]
      if(candidate.length!==target||completeKitPieceCount(candidate)>60)continue
      onProgress?.({stage:`IronNest LAB · buscando figura completa ${target} (${i+1}/${pending.length})…`,percent:8,completeFigures:best.kitCount})
      try{
        const result=await solveWithIronNestLab(candidate,{optimizationMode,signal,onProgress})
        grown={...result,selectedKits:candidate,kitCount:candidate.length}
      }catch(error){lastError=error}
    }
    // Si ningún kit individual encaja con la base certificada, permitimos unas
    // pocas recombinaciones completas antes de declarar que no mejoró.
    if(!grown)grown=await tryTarget(target)
    if(!grown)break
    best=grown
  }
  onProgress?.({stage:`IronNest LAB · ${best.kitCount} figuras completas validadas`,percent:100,completeFigures:best.kitCount,minimumGapMm:best.layoutValidation?.minimumMeasuredGapMm})
  return best
}
