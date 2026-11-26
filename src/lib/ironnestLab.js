const DEFAULT_IRONNEST_LAB_URL='https://polifan-ironnest-hardbound-lab.onrender.com'

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const STATUS_FETCH_TIMEOUT_MS=20000
async function fetchStatus(url,signal){
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),STATUS_FETCH_TIMEOUT_MS)
  const abort=()=>controller.abort()
  signal?.addEventListener('abort',abort,{once:true})
  try{return await fetch(url,{signal:controller.signal})}
  catch(error){if(controller.signal.aborted&&!signal?.aborted)throw new Error('IronNest no respondió al consultar el estado durante 20 segundos. El trabajo se conserva para recuperarlo.');throw error}
  finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort)}
}
export const isIronNestTransientError=error=>/no respondió|failed to fetch|networkerror|network error|load failed|fetch|respuesta transitoria \((?:408|425|429|500|502|503|504)\)/i.test(String(error?.message||error||''))

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
    const statusResponse=await fetchStatus(`${base}/ironnest/solve-status?id=${encodeURIComponent(jobId)}`,signal)
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
    const statusResponse=await fetchStatus(`${base}/ironnest/solve-status?id=${encodeURIComponent(jobId)}`,signal)
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
  onJobStarted,
  pollMs=1500
}={}){
  const ordered=[...(Array.isArray(kits)?kits:[])].sort((a,b)=>kitPriority(a)-kitPriority(b))
  if(!ordered.length)throw new Error('No hay kits completos para calcular.')

  const startedOverall=Date.now()
  const MAX_TOTAL_SOLVE_MS=8*60*1000
  const baseTarget=Math.min(Math.max(1,Number(targetComplete)||10),10,ordered.length)
  let best=null
  const solveBatch=async(batch,label,timeoutMs=150000)=>{
    onProgress?.({stage:`IronNest · ${label} (${batch.length} figuras)…`,percent:5,completeFigures:best?.selectedKits?.length||0})
    const result=await solveWithIronNestLab(batch,{
      optimizationMode,timeoutMs,signal,onProgress,pollMs,
      onJobStarted:j=>onJobStarted?.({...j,kitIds:batch.map(k=>k.kitId),fallbackResult:best?{...best,selectedKits:best.selectedKits.map(k=>({kitId:k.kitId}))}:null})
    })
    // Una figura sólo cuenta si se recibió CADA una de sus piezas.
    // Nunca convertir un resultado parcial en una placa certificada.
    const expected=new Set(batch.flatMap(k=>(k.parts||[]).map(p=>String(p.instanceId))))
    const received=(result.placements||[]).map(p=>String(p.instanceId||''))
    if(!result.ok||!result.layoutValidation?.ok||received.length!==expected.size||
       new Set(received).size!==expected.size||received.some(id=>!expected.has(id)))
      throw new Error(result.error||'IronNest devolvió piezas incompletas o sin certificar.')
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
    if(Date.now()-startedOverall>=MAX_TOTAL_SOLVE_MS)break
    try{
      best=await solveBatch(variant.kits,`base productiva · ${variant.label}`,360000)
      break
    }catch(error){
      if(isIronNestTransientError(error))throw error
      lastBaseError=error
    }
  }
  // Si las 10 figuras (20 piezas) no caben juntas, buscar otra placa
  // de 9 FIGURAS COMPLETAS. Nunca aceptar 19/20 piezas como si fueran 10.
  // Un error de red, cancelación, autenticación o geometría inválida no
  // habilita este camino: sólo un límite físico de distribución.
  const incompletePlacement=error=>/IronNest acomodo \\d+ piezas, pero faltaron \\d+|IronNest no devolvió el lote completo/i.test(String(error?.message||''))
  if(!best&&baseTarget===10&&lastBaseError&&incompletePlacement(lastBaseError)){
    const fallbackVariants=uniqueKitVariants(ordered,9)
    for(const variant of fallbackVariants){
      if(Date.now()-startedOverall>=MAX_TOTAL_SOLVE_MS)break
      try{
        best=await solveBatch(variant.kits,`base alternativa certificada de 9 · ${variant.label}`,Math.min(180000,MAX_TOTAL_SOLVE_MS-(Date.now()-startedOverall)))
        break
      }catch(error){
        if(isIronNestTransientError(error)||error?.name==='AbortError')throw error
        lastBaseError=error
      }
    }
  }
  if(!best)throw lastBaseError||new Error('IronNest no encontró una combinación válida de figuras completas.')

  // Crecer sin perder la base certificada. Un extra que no entra no significa
  // que ningún otro extra entre: probamos varios pendientes y aceptamos el primero
  // compatible. Así evitamos cortar el crecimiento por una sola figura grande.
  let selectedIds=new Set(best.selectedKits.map(k=>String(k.kitId)))
  const growthLimit=Math.min(Number(maxGrowth)||16,ordered.length)
  while(best.selectedKits.length<growthLimit&&Date.now()-startedOverall<MAX_TOTAL_SOLVE_MS){
    const extras=ordered.filter(k=>!selectedIds.has(String(k.kitId)))
    if(!extras.length)break
    const compactExtras=[...extras].sort((a,b)=>kitAreaScore(a)-kitAreaScore(b)||kitPriority(a)-kitPriority(b))
    const candidates=[],seen=new Set()
    // El solver es heurístico: una combinación que entró en una ejecución puede
    // fallar en otra si llegamos a ella por una base distinta. Antes de abandonar
    // el crecimiento, ampliamos de forma determinística la cartera de extras:
    // prioridad primero y luego compactos. Esto hace mucho menos probable caer de
    // 12 a 11 cuando existe una combinación certificable de 12.
    for(const extra of [...extras.slice(0,4),...compactExtras.slice(0,8)]){
      const id=String(extra.kitId); if(seen.has(id))continue
      seen.add(id); candidates.push(extra)
    }
    let grown=null
    for(const extra of candidates){
      if(Date.now()-startedOverall>=MAX_TOTAL_SOLVE_MS)break
      try{
        // El backend puede necesitar más de 60 s aun cuando termina correctamente.
        // Dejamos margen sobre su límite interno y, si este extra falla o agota
        // tiempo, conservamos la base certificada y probamos el siguiente.
        const remaining=MAX_TOTAL_SOLVE_MS-(Date.now()-startedOverall)
        if(remaining<15000)break
        grown=await solveBatch([...best.selectedKits,extra],`probando crecimiento a ${best.selectedKits.length+1}`,Math.min(180000,remaining))
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
  return {...best,requestedComplete:baseTarget,fallbackUsed:best.selectedKits.length<baseTarget}
}
