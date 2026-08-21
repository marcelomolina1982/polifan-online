// Case 9 guard for the active Sparrow production screen (MotorDefinitivo).
// Complete-kit safety + resilient network + productive 70% target without blocking valid production.
// V1.14: send a wider candidate pool to Sparrow and never show CERTIFICADO below 3 mm real.
export default function case9MotorGuardPlugin(){
  return {
    name:'case9-motor-complete-kit-guard',
    enforce:'pre',
    transform(code,id){
      const cleanId=String(id||'').replace(/\\/g,'/')
      if(!cleanId.endsWith('/src/pages/MotorDefinitivo.jsx'))return null

      // El frontend original sólo enviaba los primeros 32 pendientes. El runtime inteligente
      // del solver ya admite hasta 72; ampliar el pool permite que Residual Fill / Global Repack
      // vea figuras compactas que antes ni siquiera llegaban al servidor.
      let out=code.replace('units.slice(0,32).forEach((unit,kitIndex)=>{','units.slice(0,72).forEach((unit,kitIndex)=>{')

      const finishFrom=`    const completeIds=[...new Set((data.placements||[]).filter(p=>!p.partialExtra).map(p=>String(p.kitId||'')).filter(Boolean))]\n    const selectedUnits=completeIds.map(id=>industrial.unitMap.get(id)).filter(Boolean)\n    if(!selectedUnits.length)throw new Error('El resultado de Sparrow no coincide con los pendientes actuales. Generá nuevamente una vez.')`
      const finishTo=`    const placements=data.placements||[]\n    const expectedByKit=new Map((industrial.kits||[]).map(k=>[String(k.kitId||''),new Set((k.parts||[]).map(p=>String(p.instanceId||'')).filter(Boolean))]))\n    const actualByKit=new Map()\n    placements.forEach(p=>{const kitId=String(p.kitId||'');if(!kitId)return;if(!actualByKit.has(kitId))actualByKit.set(kitId,[]);actualByKit.get(kitId).push(p)})\n    const completeIds=[],incomplete=[]\n    actualByKit.forEach((rows,kitId)=>{const expected=expectedByKit.get(kitId);const actualIds=rows.map(p=>String(p.instanceId||'')).filter(Boolean);const actual=new Set(actualIds);const missing=expected?[...expected].filter(x=>!actual.has(x)):[];const unexpected=expected?[...actual].filter(x=>!expected.has(x)):actualIds;const duplicate=actualIds.length!==actual.size;if(!expected||!expected.size||missing.length||unexpected.length||duplicate)incomplete.push({kitId,figure:industrial.unitMap.get(kitId)?.figure||rows[0]?.figure||kitId,missing});else completeIds.push(kitId)})\n    if(incomplete.length){const ids=incomplete.map(x=>x.kitId).filter(Boolean);const detail=incomplete.slice(0,4).map(x=>x.figure+(x.missing.length?' (faltan '+x.missing.length+' pieza(s))':'')).join(', ');const e=new Error('CASE9_RETRY:'+ids.join('|')+'::'+detail);e.case9RetryIds=ids;e.case9Detail=detail;throw e}\n    if(completeIds.length<10)throw new Error('Seguridad Caso 9: sólo hay '+completeIds.length+' juego(s) completos. Se requieren al menos 10 antes de certificar.')\n    const selectedUnits=completeIds.map(id=>industrial.unitMap.get(id)).filter(Boolean)\n    if(selectedUnits.length!==completeIds.length)throw new Error('Seguridad Caso 9: el resultado de Sparrow no coincide con los kits originales. Generá nuevamente.')`
      if(!out.includes(finishFrom))throw new Error('[Case9MotorGuard] No se encontró finishResult.')
      out=out.replace(finishFrom,finishTo)

      const helperAnchor=`  async function startJob(payload,multiplier){`
      const helper=`  async function resilientFetch(url,options={},attempts=4){\n    let lastError=null\n    for(let attempt=1;attempt<=attempts;attempt++){try{return await fetch(url,options)}catch(error){lastError=error;if(attempt<attempts){setProgress('Conexión inestable · reintentando '+attempt+'/'+attempts+'…');await sleep(900*attempt)}}}\n    const err=new Error('No se pudo conectar con Sparrow después de '+attempts+' intentos. Revisá la conexión y tocá Generar una placa nuevamente.');err.cause=lastError;throw err\n  }\n  async function startJob(payload,multiplier){`
      if(!out.includes(helperAnchor))throw new Error('[Case9MotorGuard] No se encontró startJob.')
      out=out.replace(helperAnchor,helper)
      out=out.replace(`const response=await fetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})`,`const response=await resilientFetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},4)`)
      out=out.replace(`const response=await fetch('/api/nest-status?id='+encodeURIComponent(jobId),{cache:'no-store'})`,`const response=await resilientFetch('/api/nest-status?id='+encodeURIComponent(jobId),{cache:'no-store'},5)`)
      out=out.replace(`const response=await fetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'placa-sparrow.svg',svgText})})`,`const response=await resilientFetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'placa-sparrow.svg',svgText})},4)`)

      // Segunda barrera de seguridad: el certificador histórico aún puede devolver CERTIFICADO
      // a 2.5 mm. La pantalla productiva sólo acepta el resultado si el gap medido final es >=3 mm.
      out=out.replace(`const certified=okStatus(cert.status)&&Number(cert.conflicts)===0&&Number(cert.border)===0`,`const certified=okStatus(cert.status)&&Number(cert.conflicts)===0&&Number(cert.border)===0&&Number(cert.minGap)>=3\n    const finalStatus=certified?'CERTIFICADO':(okStatus(cert.status)&&Number(cert.minGap)<3?'RECHAZADO_GAP':cert.status||'NO_RESUELTO')`)
      out=out.replace(`status:certified?'CERTIFICADO':cert.status||'NO_RESUELTO'`,`status:finalStatus`)

      const generateFrom=`    try{\n      const data=await runPayload(payload,multiplier)\n      await finishResult(data,multiplier,industrial)\n    }catch(error){\n      clearActiveJob()\n      setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:error.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])\n    }finally{setBusy(false);setProgress('')}`
      const generateTo=`    try{\n      let currentPayload={...payload,targetDensity:70}\n      const excluded=new Set()\n      let solved=false\n      for(let case9Attempt=1;case9Attempt<=6&&!solved;case9Attempt++){\n        try{if(case9Attempt>1)setProgress('Sparrow · nueva combinación '+case9Attempt+'/6 · buscando 10+ completas y acercarse a 70%…');const data=await runPayload(currentPayload,multiplier);await finishResult(data,multiplier,industrial);solved=true}\n        catch(error){const ids=Array.isArray(error?.case9RetryIds)?error.case9RetryIds:[];if(!ids.length)throw error;ids.forEach(x=>excluded.add(String(x)));const remaining=industrial.kits.filter(k=>!excluded.has(String(k.kitId||'')));if(remaining.length<10)throw new Error('Seguridad Caso 9: no quedan 10 juegos completos candidatos.');clearActiveJob();setProgress('Caso 9 detectado · Sparrow buscará otra combinación automáticamente…');currentPayload={...payload,targetDensity:70,kits:remaining};if(case9Attempt===6)throw new Error('Seguridad Caso 9: Sparrow repitió juegos incompletos en 6 intentos.')}\n      }\n    }catch(error){clearActiveJob();setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:error.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])}\n    finally{setBusy(false);setProgress('')}`
      if(!out.includes(generateFrom))throw new Error('[Case9MotorGuard] No se encontró generateAutomatic.')
      out=out.replace(generateFrom,generateTo)
      out=out.replace(`const payload={widthCm:121.4,heightCm:58,gapCm:.3,targetDensity:75,kits:industrial.kits}`,`const payload={widthCm:121.4,heightCm:58,gapCm:.3,targetDensity:70,kits:industrial.kits}`)
      out=out.replace(/objetivo ≥75%/g,'objetivo ≥70%').replace(/plan\.density>=75/g,'plan.density>=70').replace(/Objetivo ≥75% alcanzado/g,'Objetivo ≥70% alcanzado')
      out=out.replace(' · V1.7 certificando…',' · V1.14 certificando…')
      return {code:out,map:null}
    }
  }
}
