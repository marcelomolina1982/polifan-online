const DEFAULT_IRONNEST_LAB_URL='https://polifan-ironnest-hardbound-lab.onrender.com'

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export const isIronNestTransientError=error=>/supero \d+ segundos|timeout|timed out|failed to fetch|networkerror|network error|load failed|fetch|respuesta transitoria \((?:408|425|429|500|502|503|504)\)/i.test(String(error?.message||error||''))

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
  try{return JSON.parse(text)}catch{
    if([408,425,429,500,502,503,504].includes(Number(response.status)))throw new Error(`IronNest devolvio una respuesta transitoria (${response.status})`)
    throw new Error(`IronNest devolvio una respuesta invalida (${response.status})`)
  }
}

export async function resumeIronNestLabJob(jobId,{pollMs=1500,timeoutMs=900000,startedAt=Date.now(),signal,onProgress}={}){
  if(!jobId)throw new Error('Falta el identificador del trabajo IronNest.')
  const base=ironNestLabUrl(),start=Number(startedAt||Date.now())
  while(Date.now()-start<timeoutMs){
    if(signal?.aborted)throw new DOMException('Operacion cancelada','AbortError')
    const statusResponse=await fetch(`${base}/ironnest/solve-status?id=${encodeURIComponent(jobId)}`,{signal})
    const status=await readJson(statusResponse),elapsed=(Date.now()-start)/1000
    if(statusResponse.status===202){onProgress?.({stage:`Recuperando trabajo IronNest · ${status.status||'calculando'}…`,elapsed});await sleep(pollMs);continue}
    if(!statusResponse.ok||!status?.ok||!status?.result?.ok)throw new Error(status?.result?.error||status?.error||`IronNest rechazo el lote (${statusResponse.status}).`)
    return {...status.result,jobId,labUrl:base}
  }
  throw new Error(`IronNest supero ${Math.round(timeoutMs/1000)} segundos.`)
}

export async function solveWithIronNestLab(kits,{
  optimizationMode='fast',
  pollMs=1500,
  timeoutMs=900000,
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
  return (kit.parts||[]).reduce((sum,p)=>sum+Number(p.sourceWidthCm??p.sourceWidth??p.widthCm??p.width??0)*Number(p.sourceHeightCm??p.sourceHeight??p.heightCm??p.height??0),0)
}

function kitPriority(k){return Number(k?.priority??999999)}

function uniqueKitVariants(kits,target){
  const ordered=[...(kits||[])].sort((a,b)=>kitPriority(a)-kitPriority(b))
  const variants=[],seen=new Set()
  const push=(label,list)=>{
    const picked=list.slice(0,target)
    if(picked.length!==target||completeKitPieceCount(picked)>60)return
    const key=picked.map(k=>k.kitId).sort().join('|')
    if(seen.has(key))return
    seen.add(key);variants.push({key,label,kits:picked})
  }
  push('prioridad',ordered)
  const urgent=ordered.slice(0,Math.max(target,Math.ceil(target*2.2)))
  push('urgentes compactos',[...urgent].sort((a,b)=>kitAreaScore(a)-kitAreaScore(b)||kitPriority(a)-kitPriority(b)))
  push('compactos globales',[...ordered].sort((a,b)=>kitAreaScore(a)-kitAreaScore(b)||kitPriority(a)-kitPriority(b)))
  const keep=Math.min(Math.max(2,Math.floor(target/3)),target)
  const first=ordered.slice(0,keep),firstIds=new Set(first.map(k=>String(k.kitId)))
  const compactRest=ordered.filter(k=>!firstIds.has(String(k.kitId))).sort((a,b)=>kitAreaScore(a)-kitAreaScore(b)||kitPriority(a)-kitPriority(b))
  push('prioridad + compactos',[...first,...compactRest])
  return variants
}

export async function solveCompleteKitsWithIronNestLab(kits,{
  targetComplete=10,
  maxGrowth=16,
  optimizationMode='fast',
  signal,
  onProgress,
  onJobStarted
}={}){
  const ordered=[...(Array.isArray(kits)?kits:[])].sort((a,b)=>kitPriority(a)-kitPriority(b))
  if(!ordered.length)throw new Error('No hay kits completos para calcular.')

  const baseTarget=Math.min(Math.max(1,Number(targetComplete)||10),10,ordered.length)
  let best=null
  const solveBatch=async(batch,label,timeoutMs=150000)=>{
    onProgress?.({stage:`IronNest · ${label} (${batch.length} figuras)…`,percent:5,completeFigures:best?.selectedKits?.length||0})
    const result=await solveWithIronNestLab(batch,{
      optimizationMode,timeoutMs,signal,onProgress,
      onJobStarted:j=>onJobStarted?.({...j,kitIds:batch.map(k=>k.kitId),fallbackResult:best?{...best,selectedKits:best.selectedKits.map(k=>({kitId:k.kitId}))}:null})
    })
    const ids=new Set((result.placements||[]).map(p=>String(p.kitId||'')).filter(Boolean))
    const selected=batch.filter(k=>ids.has(String(k.kitId)))
    if(selected.length!==batch.length)throw new Error(result.error||'IronNest no devolvió el lote completo.')
    return {...result,selectedKits:selected,kitCount:selected.length}
  }

  // La prioridad define qué figuras deben intentarse primero, pero no obliga a
  // que las primeras 10 sean geométricamente compatibles. Probamos unas pocas
  // variantes determinísticas de 10 y conservamos la primera certificada.
  const baseVariants=uniqueKitVariants(ordered,baseTarget)
  let lastBaseError=null
  for(const variant of baseVariants){
    try{
      best=await solveBatch(variant.kits,`base productiva · ${variant.label}`,90000)
      break
    }catch(error){
      if(isIronNestTransientError(error))throw error
      lastBaseError=error
    }
  }
  if(!best)throw lastBaseError||new Error('IronNest no encontró una combinación válida de 10 figuras completas.')

  // Crecer sin perder la base certificada. Un extra que no entra no significa
  // que ningún otro extra entre: probamos varios pendientes y aceptamos el primero
  // compatible. Así evitamos cortar el crecimiento por una sola figura grande.
  let selectedIds=new Set(best.selectedKits.map(k=>String(k.kitId)))
  const growthLimit=Math.min(Number(maxGrowth)||16,ordered.length)
  while(best.selectedKits.length<growthLimit){
    const extras=ordered.filter(k=>!selectedIds.has(String(k.kitId)))
    if(!extras.length)break
    const compactExtras=[...extras].sort((a,b)=>kitAreaScore(a)-kitAreaScore(b)||kitPriority(a)-kitPriority(b))
    const candidates=[],seen=new Set()
    for(const extra of [...extras.slice(0,2),...compactExtras.slice(0,4)]){
      const id=String(extra.kitId); if(seen.has(id))continue
      seen.add(id); candidates.push(extra)
    }
    let grown=null
    for(const extra of candidates){
      try{
        // El backend puede necesitar más de 60 s aun cuando termina correctamente.
        // Dejamos margen sobre su límite interno y, si este extra falla o agota
        // tiempo, conservamos la base certificada y probamos el siguiente.
        grown=await solveBatch([...best.selectedKits,extra],`probando crecimiento a ${best.selectedKits.length+1}`,165000)
        break
      }catch(error){
        // Si se perdió la comunicación, NO arrancar otro job: ese cálculo puede
        // seguir vivo en el backend. El frontend lo reanudará por su mismo id.
        if(isIronNestTransientError(error)||error?.name==='AbortError')throw error
      }
    }
    if(!grown)break
    best=grown
    selectedIds=new Set(best.selectedKits.map(k=>String(k.kitId)))
  }
  return best
}
