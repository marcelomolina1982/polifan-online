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
