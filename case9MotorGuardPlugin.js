// Case 9 guard for the active Sparrow production screen (MotorDefinitivo).
// A kit is complete only when every original physical part is present exactly once.
export default function case9MotorGuardPlugin(){
  return {
    name:'case9-motor-complete-kit-guard',
    enforce:'pre',
    transform(code,id){
      const cleanId=String(id||'').replace(/\\/g,'/')
      if(!cleanId.endsWith('/src/pages/MotorDefinitivo.jsx'))return null

      const from=`    const completeIds=[...new Set((data.placements||[]).filter(p=>!p.partialExtra).map(p=>String(p.kitId||'')).filter(Boolean))]\n    const selectedUnits=completeIds.map(id=>industrial.unitMap.get(id)).filter(Boolean)\n    if(!selectedUnits.length)throw new Error('El resultado de Sparrow no coincide con los pendientes actuales. Generá nuevamente una vez.')`

      const to=`    const placements=data.placements||[]\n    const expectedByKit=new Map((industrial.kits||[]).map(k=>[\n      String(k.kitId||''),\n      new Set((k.parts||[]).map(p=>String(p.instanceId||'')).filter(Boolean))\n    ]))\n    const actualByKit=new Map()\n    placements.forEach(p=>{\n      const kitId=String(p.kitId||'')\n      if(!kitId)return\n      if(!actualByKit.has(kitId))actualByKit.set(kitId,[])\n      actualByKit.get(kitId).push(p)\n    })\n    const completeIds=[],incomplete=[]\n    actualByKit.forEach((rows,kitId)=>{\n      const expected=expectedByKit.get(kitId)\n      const actualIds=rows.map(p=>String(p.instanceId||'')).filter(Boolean)\n      const actual=new Set(actualIds)\n      const missing=expected?[...expected].filter(partId=>!actual.has(partId)):[]\n      const unexpected=expected?[...actual].filter(partId=>!expected.has(partId)):actualIds\n      const duplicate=actualIds.length!==actual.size\n      if(!expected||!expected.size||missing.length||unexpected.length||duplicate){\n        incomplete.push({kitId,figure:industrial.unitMap.get(kitId)?.figure||rows[0]?.figure||kitId,missing,unexpected,duplicate})\n      }else completeIds.push(kitId)\n    })\n    if(incomplete.length){\n      const detail=incomplete.slice(0,4).map(x=>x.figure+(x.missing.length?' (faltan '+x.missing.length+' pieza(s))':'')).join(', ')\n      throw new Error('Seguridad Caso 9: Sparrow devolvió juegos incompletos'+(detail?': '+detail:'')+'. La placa fue descartada: no se certifica, no se descarga y no se registra.')\n    }\n    if(completeIds.length<10)throw new Error('Seguridad Caso 9: sólo hay '+completeIds.length+' juego(s) completos. Se requieren al menos 10 antes de certificar.')\n    const selectedUnits=completeIds.map(id=>industrial.unitMap.get(id)).filter(Boolean)\n    if(selectedUnits.length!==completeIds.length)throw new Error('Seguridad Caso 9: el resultado de Sparrow no coincide con los kits originales. Generá nuevamente.')`

      if(!code.includes(from))throw new Error('[Case9MotorGuard] No se encontró el conteo vulnerable de finishResult.')
      let out=code.replace(from,to)
      out=out.replace(' · V1.7 certificando…',' · V1.13 certificando…')
      return {code:out,map:null}
    }
  }
}
