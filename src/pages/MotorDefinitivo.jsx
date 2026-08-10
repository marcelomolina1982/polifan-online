import React,{useMemo,useState} from 'react'
import {Title} from '../components/UI'
import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'
import {today} from '../lib/format'

const TARGET_COMPLETE=10
const INDUSTRIAL_URL='/api/nest'

function downloadSvg(name,text){
  if(!text)return
  const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}))
  const a=document.createElement('a')
  a.href=url
  a.download=String(name||'placa.svg').replace(/\.svg$/i,'')+'__SPARROW_CERTIFICADO.svg'
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
}
function okStatus(status){return String(status||'').startsWith('CERTIFICADO')}
function parseSvg(svg){
  try{
    const doc=new DOMParser().parseFromString(svg,'image/svg+xml')
    const root=doc.documentElement
    const raw=root.getAttribute('viewBox')||`0 0 ${parseFloat(root.getAttribute('width'))||100} ${parseFloat(root.getAttribute('height'))||100}`
    const nums=String(raw).trim().split(/[ ,]+/).map(Number)
    const viewBox=nums.length===4&&nums.every(Number.isFinite)?nums:[0,0,100,100]
    return {root,viewBox}
  }catch{return null}
}
function cleanInner(root){return [...root.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('')}
function cleanAlias(value){return String(value||'').replace(/\.svg$/i,'').replace(/\s*[·_–—-]\s*(tapa|base|figura|simple|capa.*)$/i,'').trim()}
function aliasesForItem(item){return [...new Set([item?.productName,item?.modelName,item?.name].map(cleanAlias).map(normalizeFigureKey).filter(Boolean))]}
function completeComponents(items){
  const simple=items.find(x=>(x.role||'simple')==='simple'&&x.svgText)
  if(simple)return [simple]
  const base=items.find(x=>x.role==='base'&&x.svgText)
  const tapa=items.find(x=>x.role==='tapa'&&x.svgText)
  return base&&tapa?[base,tapa]:null
}
function libraryIndex(db){
  const groups=new Map()
  ;(db.svgLibrary||[]).forEach(item=>{
    const aliases=aliasesForItem(item)
    const key=String(item?.modelId||item?.productId||aliases[0]||item?.id||'')
    if(!key)return
    if(!groups.has(key))groups.set(key,{key,items:[],aliases:new Set()})
    const group=groups.get(key)
    group.items.push(item)
    aliases.forEach(a=>group.aliases.add(a))
  })
  const list=[...groups.values()].map(g=>({...g,aliases:[...g.aliases]}))
  const exact=new Map()
  list.forEach(group=>group.aliases.forEach(alias=>{
    if(!exact.has(alias))exact.set(alias,[])
    exact.get(alias).push(group)
  }))
  return {groups:list,exact}
}
function uniqueComplete(groups){
  const rows=[]
  groups.forEach(group=>{
    const comps=completeComponents(group.items)
    if(comps)rows.push({key:group.key,comps})
  })
  const unique=[...new Map(rows.map(x=>[x.key,x])).values()]
  return unique.length===1?unique[0].comps:null
}
function componentsForFigure(index,figure){
  const target=normalizeFigureKey(figure)
  if(!target)return null
  const exact=uniqueComplete(index.exact.get(target)||[])
  if(exact)return exact
  const flexible=index.groups.filter(group=>group.aliases.some(alias=>alias===target||alias.includes(target)||target.includes(alias)))
  return uniqueComplete(flexible)
}
function pendingUnits(db,index){
  const units=[],missing=new Map()
  pendingCutByDelivery(db).forEach(group=>group.rows.forEach(row=>{
    const comps=componentsForFigure(index,row.figure)
    if(!comps){
      missing.set(row.figure,(missing.get(row.figure)||0)+Number(row.qty||0))
      return
    }
    for(let i=0;i<Number(row.qty||0);i++)units.push({figure:row.figure,date:group.date||'',orders:group.orders||[],components:comps})
  }))
  return {units,missing:[...missing.entries()].map(([figure,qty])=>({figure,qty}))}
}
function summarizeUnits(units){
  const m=new Map()
  units.forEach(u=>m.set(u.figure,(m.get(u.figure)||0)+1))
  return [...m.entries()].map(([figure,qty])=>({figure,qty}))
}
function buildIndustrialKits(units){
  const kits=[]
  const partMap=new Map()
  const unitMap=new Map()
  units.slice(0,32).forEach((unit,kitIndex)=>{
    const kitId=`auto-${kitIndex}-${normalizeFigureKey(unit.figure)}`
    unitMap.set(kitId,unit)
    const parts=unit.components.map((comp,partIndex)=>{
      const instanceId=`${kitId}-p${partIndex}`
      const row={
        instanceId,kitId,figure:unit.figure,
        name:comp.name||`${unit.figure} ${comp.role||'pieza'}`,
        role:comp.role||'simple',svgText:comp.svgText,
        sourceWidthCm:Number(comp.sourceWidthCm||comp.widthCm),
        sourceHeightCm:Number(comp.sourceHeightCm||comp.heightCm),
        widthCm:Number(comp.sourceWidthCm||comp.widthCm),
        heightCm:Number(comp.sourceHeightCm||comp.heightCm),allowRotate:true,
      }
      partMap.set(instanceId,{...row,original:comp})
      return row
    })
    kits.push({kitId,figure:unit.figure,date:unit.date||'',priority:kitIndex,parts})
  })
  return {kits,partMap,unitMap}
}

// IMPORTANTE: el archivo de corte queda en UN SOLO sistema de coordenadas (mm).
// No usamos <svg> anidados: la matriz escrita aquí es exactamente la misma
// geometría física que recibió Sparrow y que luego vuelve a leer V1.7.
function composeIndustrialSvg(placements,partMap){
  const pieces=[]
  placements.forEach((p,n)=>{
    const meta=partMap.get(String(p.instanceId||''))
    if(!meta)return
    const parsed=parseSvg(meta.svgText)
    if(!parsed)return
    const [vx,vy,vw0,vh0]=parsed.viewBox
    const vw=Math.max(1e-9,Number(vw0)||1),vh=Math.max(1e-9,Number(vh0)||1)
    const wmm=Math.max(1,Number(meta.sourceWidthCm||meta.widthCm||1)*10)
    const hmm=Math.max(1,Number(meta.sourceHeightCm||meta.heightCm||1)*10)
    const sx=wmm/vw,sy=hmm/vh
    const x=Number(p.xCm||0)*10,y=Number(p.yCm||0)*10,angle=Number(p.angle||0)
    const trimX=Number(p.trimXCm||0)*10,trimY=Number(p.trimYCm||0)*10
    const transform=`translate(${x} ${y}) rotate(${angle}) translate(${-trimX} ${-trimY}) scale(${sx} ${sy}) translate(${-vx} ${-vy})`
    pieces.push(`<g data-industrial-piece="${n}" data-kit="${String(p.kitId||'')}" data-instance="${String(p.instanceId||'')}" transform="${transform}">${cleanInner(parsed.root)}</g>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1220mm" height="580mm" viewBox="0 0 1220 580" overflow="visible">${pieces.join('')}</svg>`
}

export default function MotorDefinitivo({db,onSave}){
  const index=useMemo(()=>libraryIndex(db),[db.svgLibrary])
  const pending=useMemo(()=>pendingUnits(db,index),[db,index])
  const [plans,setPlans]=useState([])
  const [busy,setBusy]=useState(false)
  const [progress,setProgress]=useState('')

  async function certify(svgText){
    const response=await fetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'placa-sparrow.svg',svgText})})
    let data={};try{data=await response.json()}catch{}
    return {status:data.status||`HTTP ${response.status}`,minGap:data.validation?.min_gap_mm??data.min_gap_mm??'-',conflicts:data.validation?.conflicts??data.conflicts??'-',border:data.validation?.border_conflicts??data.border_conflicts??'-',seconds:data.seconds??'-',svgText:data.svgText||svgText,error:data.error||''}
  }

  async function generateAutomatic(){
    if(!pending.units.length)return alert(pending.missing.length?'No hay piezas generables. Revisá los SVG faltantes en Biblioteca SVG.':'No hay piezas pendientes para cortar.')
    const industrial=buildIndustrialKits(pending.units)
    setBusy(true);setPlans([]);setProgress('Sparrow · optimizando 10 figuras completas por contorno real')
    try{
      const r=await fetch(INDUSTRIAL_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({widthCm:122,heightCm:58,gapCm:.3,targetDensity:80,kits:industrial.kits})})
      const data=await r.json().catch(()=>({}))
      if(!r.ok||!data.ok){
        const rejected=Array.isArray(data.rejected)&&data.rejected.length?` · descartadas: ${data.rejected.map(x=>`${x.figure||'figura'} (${x.reason||'inválida'})`).slice(0,3).join(', ')}`:''
        const diagnostic=data.bestDiagnosticComplete?` · mejor intento: ${data.bestDiagnosticComplete} completas (${Number(data.bestDiagnosticDensity||0).toFixed(1)}%)`:''
        throw new Error((data.error||`Sparrow HTTP ${r.status}`)+diagnostic+rejected)
      }
      const selectedIds=[...new Set((data.placements||[]).map(p=>String(p.kitId||'')).filter(Boolean))]
      const selectedUnits=selectedIds.map(id=>industrial.unitMap.get(id)).filter(Boolean)
      if(!selectedUnits.length)throw new Error('Sparrow no devolvió figuras completas utilizables.')
      const composed=composeIndustrialSvg(data.placements||[],industrial.partMap)
      setProgress(`Sparrow encontró ${selectedUnits.length} completas · V1.7 está certificando EL MISMO SVG que se descargará…`)
      const cert=await certify(composed)
      const certified=okStatus(cert.status)&&Number(cert.conflicts)===0&&Number(cert.border)===0
      setPlans([{id:crypto.randomUUID(),number:1,units:selectedUnits,summary:summarizeUnits(selectedUnits),date:selectedUnits.map(u=>u.date).filter(Boolean).sort()[0]||today(),registered:false,deferred:Math.max(0,pending.units.length-selectedUnits.length),status:certified?'CERTIFICADO':cert.status||'NO_RESUELTO',minGap:cert.minGap,conflicts:cert.conflicts,border:cert.border,seconds:cert.seconds,svgText:cert.svgText||composed,error:cert.error||'',density:Number(data.density||0),industrialSeconds:Number(data.elapsedSeconds||0),rotationStep:data.rotationStep??'-',reachedMinimum:Boolean(data.reachedMinimum),candidatePool:Number(data.candidatePool||industrial.kits.length),rejectedCount:Number(data.rejectedCount||0),source:data.selectionStrategy||data.source||'sparrow-jagua-rs'}])
    }catch(error){
      setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:error.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null}])
    }finally{setBusy(false);setProgress('')}
  }

  async function registerPlan(plan){
    if(!okStatus(plan.status)||!plan.svgText||plan.registered)return
    if(!confirm(`¿Pasar esta placa a En corte? Recién ahora se descontarán ${plan.units.length} figuras de Para cortar.`))return
    const number=String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0')
    const batch={id:crypto.randomUUID(),number,date:plan.date||today(),name:`Placa automática Sparrow ${plan.date||today()}`,status:'En corte',notes:`Sparrow + certificador V1.7 · ${plan.units.length} completas · separación ${plan.minGap} mm · conflictos 0 · borde 0`,multiplier:1,items:plan.summary.map(x=>({figure:x.figure,component:'complete',qty:x.qty})),createdAt:new Date().toISOString()}
    const result=await onSave({...db,cutBatches:[...(db.cutBatches||[]),batch]})
    if(result?.ok!==false)setPlans(list=>list.map(x=>x.id===plan.id?{...x,registered:true,batchNumber:number}:x))
  }

  return <>
    <Title title="Generar placas · Motor Sparrow + Certificador V1.7" sub="Sparrow optimiza las siluetas irregulares. V1.7 certifica exactamente el mismo SVG plano que después se descarga para corte." actions={<button className="primary" disabled={busy||!pending.units.length} onClick={generateAutomatic}>{busy?'Generando…':'Generar una placa'}</button>}/>
    <div className="notice"><b>Modo producción Sparrow</b><span>Un clic genera una sola propuesta. Nada se descuenta hasta “Pasar a corte”. Base y tapa se mantienen como figura completa.</span></div>
    <div className="panel"><div className="form-grid">
      <div><small>Figuras pendientes con SVG</small><b className="block big">{pending.units.length}</b></div>
      <div><small>Figuras sin SVG completo</small><b className={'block big '+(pending.missing.length?'red-text':'green-text')}>{pending.missing.reduce((a,x)=>a+x.qty,0)}</b></div>
      <div><small>Criterio productivo</small><b className="block big">10+ · o 9 con ≥72%</b></div>
      <div><small>Arquitectura</small><b className="block big">Sparrow / jagua-rs · V1.7 certifica</b></div>
    </div>
    {pending.missing.length>0&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>Faltan SVG en Biblioteca</b><span>{pending.missing.map(x=>`${x.figure} × ${x.qty}`).join(' · ')}</span></div>}
    {progress&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>{progress}</b><span>El archivo final queda aplanado en coordenadas físicas de 1220×580 mm, sin SVG anidados.</span></div>}
    </div>
    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Contenido</th><th>Estado</th><th>Gap certificado</th><th>Conflictos</th><th>Borde</th><th>Ocupación</th><th>Acciones</th></tr></thead><tbody>
      {plans.map(plan=>{const ok=okStatus(plan.status);return <tr key={plan.id}>
        <td><b>Placa {plan.number}</b><small className="block">Entrega prioritaria: {plan.date}</small><small className="block">{plan.units.length} figuras completas</small>{plan.units.length<TARGET_COMPLETE&&plan.units.length>0&&<small className="block red-text"><b>{plan.units.length===9&&plan.density>=72?'9 de alta ocupación':'Bajo objetivo de 10'}</b></small>}<small className="block">{plan.deferred} quedan pendientes</small></td>
        <td>{plan.summary.map(x=>`${x.figure} × ${x.qty}`).join(', ')||'-'}</td>
        <td><b className={ok?'green-text':'red-text'}>{plan.status}</b>{plan.error&&<small className="block red-text">{plan.error}</small>}{plan.rejectedCount>0&&<small className="block">{plan.rejectedCount} candidata(s) descartadas por geometría/medidas</small>}</td>
        <td><b>{plan.minGap} mm</b></td><td className={Number(plan.conflicts)===0?'green-text':'red-text'}>{plan.conflicts}</td><td className={Number(plan.border)===0?'green-text':'red-text'}>{plan.border}</td>
        <td>{Number.isFinite(plan.density)?`${plan.density.toFixed(1)}%`:'-'}{plan.rotationStep!=='-'&&<small className="block">rotación {plan.rotationStep}°</small>}{plan.source&&<small className="block">{plan.source}</small>}</td>
        <td className="row-actions">{ok&&plan.svgText&&<button className="ghost" onClick={()=>downloadSvg('placa-sparrow-1',plan.svgText)}>Descargar SVG</button>}{ok&&!plan.registered&&<button className="primary" onClick={()=>registerPlan(plan)}>Pasar a corte</button>}{plan.registered&&<span className="green-text"><b>En corte #{plan.batchNumber}</b></span>}</td>
      </tr>})}
      {!plans.length&&<tr><td colSpan="8">Tocá “Generar una placa”. Sparrow optimizará la placa y V1.7 certificará exactamente el SVG que se descargará.</td></tr>}
    </tbody></table></div>
  </>
}