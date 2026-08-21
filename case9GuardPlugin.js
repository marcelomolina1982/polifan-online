// Build-time safety guard for SheetPlanner.
// Case 9: a plate must never count or export a kit when one of its physical parts is missing.
export default function case9GuardPlugin(){
  return {
    name:'case9-complete-kit-guard',
    enforce:'pre',
    transform(code,id){
      if(!id.replace(/\\/g,'/').endsWith('/src/pages/SheetPlanner.jsx'))return null
      let out=code
      const patch=(from,to,label)=>{
        if(!out.includes(from))throw new Error(`[Case9Guard] No se encontró el bloque requerido: ${label}`)
        out=out.replace(from,to)
      }

      patch(
`function kitCountOnSheet(sheet){
  const ids=new Set()
  ;(sheet?.placed||[]).forEach(p=>p.kitId&&ids.add(p.kitId))
  return ids.size
}

function kitSummaryOnSheet(sheet){
  const byFigure={}
  const seen=new Set()
  ;(sheet?.placed||[]).forEach(p=>{
    if(!p.kitId||seen.has(p.kitId))return
    seen.add(p.kitId)
    byFigure[p.figure]=(byFigure[p.figure]||0)+1
  })
  return Object.entries(byFigure).map(([figure,qty])=>({figure,qty})).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'}))
}`,
`function kitIntegrityOnSheet(sheet){
  const groups=new Map()
  ;(sheet?.placed||[]).forEach(p=>{
    if(!p.kitId)return
    let g=groups.get(p.kitId)
    if(!g){
      g={kitId:p.kitId,figure:p.figure||p.name||'Figura',parts:[],expected:new Set(),actual:new Set(),declaredCount:0,strict:false}
      groups.set(p.kitId,g)
    }
    g.parts.push(p)
    g.declaredCount=Math.max(g.declaredCount,Math.max(0,Math.floor(num(p.kitPartCount))))
    if(Array.isArray(p.kitExpectedInstanceIds)&&p.kitExpectedInstanceIds.length){
      g.strict=true
      p.kitExpectedInstanceIds.forEach(x=>g.expected.add(String(x)))
    }
    if(p.instanceId)g.actual.add(String(p.instanceId))
  })
  const complete=[],incomplete=[]
  groups.forEach(g=>{
    const actualCount=g.actual.size||g.parts.length
    const expectedCount=g.expected.size||g.declaredCount
    const missing=g.expected.size?[...g.expected].filter(x=>!g.actual.has(x)):[]
    const duplicate=g.parts.length!==actualCount
    // Compatibilidad con diseños viejos sin metadatos. Todo kit nuevo entra en modo estricto.
    const ok=!g.strict||(expectedCount>0&&actualCount===expectedCount&&!missing.length&&!duplicate)
    const row={kitId:g.kitId,figure:g.figure,parts:g.parts,expectedCount,actualCount,missing,duplicate}
    ;(ok?complete:incomplete).push(row)
  })
  return {complete,incomplete,completeCount:complete.length,totalKits:groups.size}
}

function kitCountOnSheet(sheet){return kitIntegrityOnSheet(sheet).completeCount}

function kitSummaryOnSheet(sheet){
  const byFigure={}
  kitIntegrityOnSheet(sheet).complete.forEach(g=>{byFigure[g.figure]=(byFigure[g.figure]||0)+1})
  return Object.entries(byFigure).map(([figure,qty])=>({figure,qty})).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'}))
}`,
'contador de kits completos')

      patch(
`      if(parts.length)kits.push({kitId,figure:row.figure,priority,date:date||'',source,parts})`,
`      if(parts.length){
        const kitExpectedInstanceIds=parts.map(p=>p.instanceId)
        parts.forEach(p=>{p.kitPartCount=parts.length;p.kitExpectedInstanceIds=kitExpectedInstanceIds})
        kits.push({kitId,figure:row.figure,priority,date:date||'',source,parts})
      }`,
'metadatos de integridad del kit')

      patch(
`      const kitIds=new Set(placed.map(x=>x.kitId).filter(Boolean))
      const completeFigures=kitIds.size`,
`      const finalIntegrity=kitIntegrityOnSheet({placed})
      if(finalIntegrity.incomplete.length){
        const detail=finalIntegrity.incomplete.slice(0,4).map(x=>x.figure+(x.missing.length?\` (faltan \\${x.missing.length} pieza(s))\`:'' )).join(', ')
        throw new Error(\`Seguridad de producción: el motor devolvió juegos incompletos\${detail?\`: \\${detail}\`:''}. La placa fue descartada y no se puede exportar.\`)
      }
      const completeFigures=finalIntegrity.completeCount`,
'validación final del resultado automático')

      patch(
`  function download(){
    if(!sheet)return`,
`  function download(){
    if(!sheet)return
    if(result.automatic){
      const integrity=kitIntegrityOnSheet(sheet)
      if(integrity.incomplete.length){
        const detail=integrity.incomplete.slice(0,4).map(x=>x.figure).join(', ')
        return alert(\`No se puede exportar: hay juegos incompletos\${detail?\`: \\${detail}\`:''}. Volvé a generar la placa.\`)
      }
      if(!result.productionMinimumValidated)return alert('No se puede exportar: la placa automática todavía no alcanzó el mínimo productivo validado.')
    }`,
'barrera antes de descargar SVG')

      patch(
`  async function sendSheetToCut(){
    if(!sheet)return`,
`  async function sendSheetToCut(){
    if(!sheet)return
    if(result.automatic){
      const integrity=kitIntegrityOnSheet(sheet)
      if(integrity.incomplete.length){
        const detail=integrity.incomplete.slice(0,4).map(x=>x.figure).join(', ')
        return alert(\`No se puede enviar a corte: hay juegos incompletos\${detail?\`: \\${detail}\`:''}. Volvé a generar la placa.\`)
      }
    }`,
'barrera antes de enviar a corte')

      patch(
`<button className="primary" disabled={!sheet} onClick={download}>Descargar SVG</button>`,
`<button className="primary" disabled={!sheet||(result.automatic&&!result.productionMinimumValidated)} onClick={download}>Descargar SVG</button>`,
'bloqueo visual de exportación parcial')

      return {code:out,map:null}
    }
  }
}
