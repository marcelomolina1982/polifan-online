import React,{useMemo,useState} from 'react'
import {Title} from '../components/UI'
import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'
import {today} from '../lib/format'

const PLATE_W=1220,PLATE_H=580,MARGIN=8

function downloadSvg(name,text){
  if(!text)return
  const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}))
  const a=document.createElement('a')
  a.href=url
  a.download=String(name||'placa.svg').replace(/\.svg$/i,'')+'__CERTIFICADO_V1_7.svg'
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
}
function okStatus(status){return String(status||'').startsWith('CERTIFICADO')}
function parseViewBox(svg){
  try{
    const doc=new DOMParser().parseFromString(svg,'image/svg+xml')
    const root=doc.documentElement
    const viewBox=root.getAttribute('viewBox')||`0 0 ${parseFloat(root.getAttribute('width'))||100} ${parseFloat(root.getAttribute('height'))||100}`
    return {root,viewBox}
  }catch{return null}
}
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
  const out=[]
  groups.forEach(group=>{
    const comps=completeComponents(group.items)
    if(comps)out.push({key:group.key,comps})
  })
  const unique=[...new Map(out.map(x=>[x.key,x])).values()]
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
function cleanInner(root){return [...root.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('')}
function componentBox(comp){
  const parsed=parseViewBox(comp.svgText)
  if(!parsed)return null
  const vb=parsed.viewBox.trim().split(/[ ,]+/).map(Number)
  const vbW=Number.isFinite(vb[2])&&vb[2]>0?vb[2]:100
  const vbH=Number.isFinite(vb[3])&&vb[3]>0?vb[3]:100
  const widthCm=Number(comp.sourceWidthCm||comp.widthCm)
  const heightCm=Number(comp.sourceHeightCm||comp.heightCm)
  const w=Math.max(1,Number.isFinite(widthCm)&&widthCm>0?widthCm*10:vbW)
  const h=Math.max(1,Number.isFinite(heightCm)&&heightCm>0?heightCm*10:vbH)
  return {comp,parsed,w,h}
}
function tryPlaceUnit(unit,state){
  let x=state.x,y=state.y,rowH=state.rowH
  const placements=[]
  for(const comp of unit.components){
    const box=componentBox(comp)
    if(!box)return null
    if(box.w>PLATE_W-2*MARGIN||box.h>PLATE_H-2*MARGIN)return null
    if(x+box.w>PLATE_W-MARGIN){
      x=MARGIN
      y+=rowH+MARGIN
      rowH=0
    }
    if(y+box.h>PLATE_H-MARGIN)return null
    placements.push({...box,x,y})
    x+=box.w+MARGIN
    rowH=Math.max(rowH,box.h)
  }
  return {state:{x,y,rowH},placements}
}
function buildOneSafePlate(units){
  let state={x:MARGIN,y:MARGIN,rowH:0}
  const selected=[],placements=[],deferred=[]
  for(const unit of units){
    const trial=tryPlaceUnit(unit,state)
    if(!trial){deferred.push(unit);continue}
    selected.push(unit)
    placements.push(...trial.placements)
    state=trial.state
  }
  return {units:selected,placements,deferred}
}
function composePlacedSvg(placements){
  const parts=placements.map((p,n)=>`<svg data-auto-piece="${n}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" viewBox="${p.parsed.viewBox}" overflow="visible">${cleanInner(p.parsed.root)}</svg>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1220mm" height="580mm" viewBox="0 0 1220 580">${parts.join('')}</svg>`
}
function summarizeUnits(units){
  const m=new Map()
  units.forEach(u=>m.set(u.figure,(m.get(u.figure)||0)+1))
  return [...m.entries()].map(([figure,qty])=>({figure,qty}))
}

export default function MotorDefinitivo({db,onSave}){
  const index=useMemo(()=>libraryIndex(db),[db.svgLibrary])
  const pending=useMemo(()=>pendingUnits(db,index),[db,index])
  const [plans,setPlans]=useState([])
  const [busy,setBusy]=useState(false)
  const [progress,setProgress]=useState('')
  const [files,setFiles]=useState([])
  const [manualRows,setManualRows]=useState([])
  const [manualBusy,setManualBusy]=useState(false)

  async function solve(svgText,filename){
    const response=await fetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename,svgText})})
    let data={};try{data=await response.json()}catch{}
    return {status:data.status||`HTTP ${response.status}`,engine:data.engineVersion||data.engine||'V1.7',pieces:data.pieces??'-',searchGap:data.search_gap_used_mm??'-',rescueGap:data.rescue_search_gap_mm??null,minGap:data.validation?.min_gap_mm??data.min_gap_mm??'-',conflicts:data.validation?.conflicts??data.conflicts??'-',border:data.validation?.border_conflicts??data.border_conflicts??'-',seconds:data.seconds??'-',svgText:data.svgText||null,error:data.error||''}
  }

  async function generateAutomatic(){
    if(!pending.units.length)return alert(pending.missing.length?'No hay piezas generables. Revisá los SVG faltantes en Biblioteca SVG.':'No hay piezas pendientes para cortar.')
    const draft=buildOneSafePlate(pending.units)
    if(!draft.units.length)return alert('No pude prearmar una placa sin superposiciones. Revisá las medidas guardadas en Biblioteca SVG.')
    setBusy(true)
    setPlans([])
    setProgress(`Generando una sola placa · ${draft.units.length} figuras completas · ${draft.deferred.length} quedan pendientes`)
    try{
      const result=await solve(composePlacedSvg(draft.placements),'placa-automatica-01.svg')
      setPlans([{
        id:crypto.randomUUID(),number:1,units:draft.units,summary:summarizeUnits(draft.units),
        date:draft.units.map(u=>u.date).filter(Boolean).sort()[0]||today(),registered:false,deferred:draft.deferred.length,...result
      }])
    }catch(error){
      setPlans([{id:crypto.randomUUID(),number:1,units:draft.units,summary:summarizeUnits(draft.units),date:draft.units[0]?.date||today(),registered:false,deferred:draft.deferred.length,status:'ERROR',error:error.message,svgText:null,conflicts:'-',border:'-',minGap:'-',seconds:'-'}])
    }finally{
      setBusy(false)
      setProgress('')
    }
  }

  async function registerPlan(plan){
    if(!okStatus(plan.status)||!plan.svgText||plan.registered)return
    if(!confirm(`¿Pasar esta placa a En corte? Recién ahora se descontarán ${plan.units.length} figuras de Para cortar.`))return
    const number=String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0')
    const batch={id:crypto.randomUUID(),number,date:plan.date||today(),name:`Placa automática V1.7 ${plan.date||today()}`,status:'En corte',notes:`Generada y certificada automáticamente con Motor V1.7 · separación ${plan.minGap} mm · conflictos 0 · borde 0`,multiplier:1,items:plan.summary.map(x=>({figure:x.figure,component:'complete',qty:x.qty})),createdAt:new Date().toISOString()}
    const result=await onSave({...db,cutBatches:[...(db.cutBatches||[]),batch]})
    if(result?.ok!==false)setPlans(list=>list.map(x=>x.id===plan.id?{...x,registered:true,batchNumber:number}:x))
  }

  async function runManual(){
    if(!files.length)return alert('Elegí uno o más SVG.')
    setManualBusy(true);setManualRows([]);let next=[]
    try{
      for(let i=0;i<files.length;i++){
        const file=files[i]
        try{
          const result=await solve(await file.text(),file.name)
          next=[...next,{id:`${file.name}-${i}`,fileName:file.name,...result}]
        }catch(error){next=[...next,{id:`${file.name}-${i}`,fileName:file.name,status:'ERROR',error:error.message}]}
        setManualRows(next)
      }
    }finally{setManualBusy(false)}
  }

  return <>
    <Title title="Generar placas · Motor V1.7" sub="Genera una sola placa por vez. Usa primero las piezas más urgentes que entren sin superposición inicial." actions={<button className="primary" disabled={busy||!pending.units.length} onClick={generateAutomatic}>{busy?'Generando…':'Generar una placa'}</button>}/>
    <div className="notice"><b>Modo seguro</b><span>Un clic genera una sola propuesta. Nada se descuenta ni pasa a corte hasta que vos presionás “Pasar a corte”.</span></div>
    <div className="panel">
      <div className="form-grid">
        <div><small>Figuras pendientes con SVG</small><b className="block big">{pending.units.length}</b></div>
        <div><small>Figuras sin SVG completo</small><b className={'block big '+(pending.missing.length?'red-text':'green-text')}>{pending.missing.reduce((a,x)=>a+x.qty,0)}</b></div>
        <div><small>Modo de generación</small><b className="block big">1 placa por vez</b></div>
        <div><small>Prearmado</small><b className="block big">Sin superposición</b></div>
      </div>
      {pending.missing.length>0&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>Faltan SVG en Biblioteca</b><span>{pending.missing.map(x=>`${x.figure} × ${x.qty}`).join(' · ')}</span></div>}
      {progress&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>{progress}</b><span>V1.7 está haciendo el nesting fino y certificando la placa.</span></div>}
    </div>
    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Contenido</th><th>Estado</th><th>Gap certificado</th><th>Conflictos</th><th>Borde</th><th>Tiempo</th><th>Acciones</th></tr></thead><tbody>
      {plans.map(plan=>{const ok=okStatus(plan.status);return <tr key={plan.id}>
        <td><b>Placa {plan.number}</b><small className="block">Entrega prioritaria: {plan.date||'sin fecha'}</small><small className="block">{plan.units.length} figuras completas</small>{plan.deferred>0&&<small className="block">{plan.deferred} quedan para próximas placas</small>}</td>
        <td>{plan.summary.map(x=>`${x.figure} × ${x.qty}`).join(', ')}</td>
        <td><b className={ok?'green-text':'red-text'}>{plan.status}</b>{plan.error&&<small className="block red-text">{plan.error}</small>}</td>
        <td><b>{plan.minGap} mm</b></td><td className={Number(plan.conflicts)===0?'green-text':'red-text'}>{plan.conflicts}</td><td className={Number(plan.border)===0?'green-text':'red-text'}>{plan.border}</td><td>{plan.seconds} s</td>
        <td className="row-actions">{ok&&plan.svgText&&<button className="ghost" onClick={()=>downloadSvg('placa-1',plan.svgText)}>Descargar SVG</button>}{ok&&!plan.registered&&<button className="primary" onClick={()=>registerPlan(plan)}>Pasar a corte</button>}{plan.registered&&<span className="green-text"><b>En corte #{plan.batchNumber}</b></span>}</td>
      </tr>})}
      {!plans.length&&<tr><td colSpan="8">Tocá “Generar una placa”. El sistema tomará primero las entregas más próximas y dejará el resto pendiente.</td></tr>}
    </tbody></table></div>
    <details className="panel"><summary><b>Herramienta manual de certificación SVG</b></summary>
      <div className="actions" style={{marginTop:12}}><label className="ghost filebtn">Elegir SVG<input type="file" accept=".svg,image/svg+xml" multiple onChange={e=>setFiles([...e.target.files])}/></label><button className="ghost" disabled={manualBusy||!files.length} onClick={runManual}>{manualBusy?'Procesando…':'Certificar SVG manualmente'}</button></div>
      <div className="table-wrap"><table><thead><tr><th>Archivo</th><th>Estado</th><th>Gap</th><th>Conflictos</th><th>Borde</th><th>Acción</th></tr></thead><tbody>{manualRows.map(row=>{const ok=okStatus(row.status);return <tr key={row.id}><td>{row.fileName}</td><td className={ok?'green-text':'red-text'}><b>{row.status}</b></td><td>{row.minGap} mm</td><td>{row.conflicts}</td><td>{row.border}</td><td>{ok&&row.svgText?<button className="ghost" onClick={()=>downloadSvg(row.fileName,row.svgText)}>Descargar</button>:'-'}</td></tr>})}{!manualRows.length&&<tr><td colSpan="6">Sin pruebas manuales.</td></tr>}</tbody></table></div>
    </details>
  </>
}
