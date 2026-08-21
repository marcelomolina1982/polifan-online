// Case 9 guard for the active Sparrow production screen (MotorDefinitivo).
// A kit is complete only when every original physical part is present exactly once.
// If Sparrow returns an incomplete kit, request a new layout without that kit instead of stopping production.
// Also retry transient mobile/network fetch failures before surfacing an error.
export default function case9MotorGuardPlugin(){
  return {
    name:'case9-motor-complete-kit-guard',
    enforce:'pre',
    transform(code,id){
      const cleanId=String(id||'').replace(/\\/g,'/')
      if(!cleanId.endsWith('/src/pages/MotorDefinitivo.jsx'))return null

      const finishFrom=`    const completeIds=[...new Set((data.placements||[]).filter(p=>!p.partialExtra).map(p=>String(p.kitId||'')).filter(Boolean))]\n    const selectedUnits=completeIds.map(id=>industrial.unitMap.get(id)).filter(Boolean)\n    if(!selectedUnits.length)throw new Error('El resultado de Sparrow no coincide con los pendientes actuales. Generá nuevamente una vez.')`

      const finishTo=`    const placements=data.placements||[]\n    const expectedByKit=new Map((industrial.kits||[]).map(k=>[String(k.kitId||''),new Set((k.parts||[]).map(p=>String(p.instanceId||'')).filter(Boolean))]))\n    const actualByKit=new Map()\n    placements.forEach(p=>{\n      const kitId=String(p.kitId||'')\n      if(!kitId)return\n      if(!actualByKit.has(kitId))actualByKit.set(kitId,[])\n      actualByKit.get(kitId).push(p)\n    })\n    const completeIds=[],incomplete=[]\n    actualByKit.forEach((rows,kitId)=>{\n      const expected=expectedByKit.get(kitId)\n      const actualIds=rows.map(p=>String(p.instanceId||'')).filter(Boolean)\n      const actual=new Set(actualIds)\n      const missing=expected?[...expected].filter(partId=>!actual.has(partId)):[]\n      const unexpected=expected?[...actual].filter(partId=>!expected.has(partId)):actualIds\n      const duplicate=actualIds.length!==actual.size\n      if(!expected||!expected.size||missing.length||unexpected.length||duplicate){\n        incomplete.push({kitId,figure:industrial.unitMap.get(kitId)?.figure||rows[0]?.figure||kitId,missing,unexpected,duplicate})\n      }else completeIds.push(kitId)\n    })\n    if(incomplete.length){\n      const ids=incomplete.map(x=>x.kitId).filter(Boolean)\n      const detail=incomplete.slice(0,4).map(x=>x.figure+(x.missing.length?' (faltan '+x.missing.length+' pieza(s))':'')).join(', ')\n      const retryError=new Error('CASE9_RETRY:'+ids.join('|')+'::'+detail)\n      retryError.case9RetryIds=ids\n      retryError.case9Detail=detail\n      throw retryError\n    }\n    if(completeIds.length<10)throw new Error('Seguridad Caso 9: sólo hay '+completeIds.length+' juego(s) completos. Se requieren al menos 10 antes de certificar.')\n    const selectedUnits=completeIds.map(id=>industrial.unitMap.get(id)).filter(Boolean)\n    if(selectedUnits.length!==completeIds.length)throw new Error('Seguridad Caso 9: el resultado de Sparrow no coincide con los kits originales. Generá nuevamente.')`

      if(!code.includes(finishFrom))throw new Error('[Case9MotorGuard] No se encontró el conteo vulnerable de finishResult.')
      let out=code.replace(finishFrom,finishTo)

      const helperAnchor=`  async function startJob(payload,multiplier){`
      const helper=`  async function resilientFetch(url,options={},attempts=4){\n    let lastError=null\n    for(let attempt=1;attempt<=attempts;attempt++){\n      try{return await fetch(url,options)}catch(error){\n        lastError=error\n        if(attempt<attempts){\n          setProgress('Conexión inestable · reintentando '+attempt+'/'+attempts+'…')\n          await sleep(900*attempt)\n        }\n      }\n    }\n    const err=new Error('No se pudo conectar con Sparrow después de '+attempts+' intentos. Revisá la conexión y tocá Generar una placa nuevamente.')\n    err.cause=lastError\n    throw err\n  }\n  async function startJob(payload,multiplier){`
      if(!out.includes(helperAnchor))throw new Error('[Case9MotorGuard] No se encontró startJob para instalar reintentos de red.')
      out=out.replace(helperAnchor,helper)
      out=out.replace(`const response=await fetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})`,`const response=await resilientFetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},4)`)
      out=out.replace(`const response=await fetch('/api/nest-status?id='+encodeURIComponent(jobId),{cache:'no-store'})`,`const response=await resilientFetch('/api/nest-status?id='+encodeURIComponent(jobId),{cache:'no-store'},5)`)
      out=out.replace(`const response=await fetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'placa-sparrow.svg',svgText})})`,`const response=await resilientFetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'placa-sparrow.svg',svgText})},4)`)

      const generateFrom=`    try{\n      const data=await runPayload(payload,multiplier)\n      await finishResult(data,multiplier,industrial)\n    }catch(error){\n      clearActiveJob()\n      setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:error.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])\n    }finally{setBusy(false);setProgress('')}`

      const generateTo=`    try{\n      let currentPayload=payload\n      const excluded=new Set()\n      let solved=false\n      for(let case9Attempt=1;case9Attempt<=6&&!solved;case9Attempt++){\n        try{\n          if(case9Attempt>1)setProgress('Seguridad Caso 9 · reintentando distribución '+case9Attempt+'/6 sin juegos incompletos…')\n          const data=await runPayload(currentPayload,multiplier)\n          await finishResult(data,multiplier,industrial)\n          solved=true\n        }catch(error){\n          const ids=Array.isArray(error?.case9RetryIds)?error.case9RetryIds:[]\n          if(!ids.length)throw error\n          ids.forEach(x=>excluded.add(String(x)))\n          const remaining=industrial.kits.filter(k=>!excluded.has(String(k.kitId||'')))\n          if(remaining.length<10)throw new Error('Seguridad Caso 9: no quedan 10 juegos completos candidatos después de retirar los defectuosos.')\n          clearActiveJob()\n          setProgress('Caso 9 detectado'+(error.case9Detail?' · '+error.case9Detail:'')+' · Sparrow buscará otra combinación automáticamente…')\n          currentPayload={...payload,kits:remaining}\n          if(case9Attempt===6)throw new Error('Seguridad Caso 9: Sparrow repitió juegos incompletos en 6 intentos. No se certificó ninguna placa.')\n        }\n      }\n    }catch(error){\n      clearActiveJob()\n      setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:error.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])\n    }finally{setBusy(false);setProgress('')}`

      if(!out.includes(generateFrom))throw new Error('[Case9MotorGuard] No se encontró generateAutomatic para instalar reintentos.')
      out=out.replace(generateFrom,generateTo)
      out=out.replace(' · V1.7 certificando…',' · V1.13 certificando…')
      return {code:out,map:null}
    }
  }
}
