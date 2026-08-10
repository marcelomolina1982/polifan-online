import React,{useMemo,useState} from 'react'
import {Title} from '../components/UI'
import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'
import {today} from '../lib/format'

const TARGET_UNITS=10
const PLATE_W=1220,PLATE_H=580,MARGIN=8

function downloadSvg(name,text){
  if(!text)return
  const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}))
  const a=document.createElement('a');a.href=url;a.download=String(name||'placa.svg').replace(/\.svg$/i,'')+'__CERTIFICADO_V1_7.svg'
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
}
function okStatus(status){return String(status||'').startsWith('CERTIFICADO')}
function componentName(item){return item?.productName||item?.modelName||item?.name||''}
function parseViewBox(svg){
  try{const doc=new DOMParser().parseFromString(svg,'image/svg+xml'),root=doc.documentElement;return {root,viewBox:root.getAttribute('viewBox')||`0 0 ${parseFloat(root.getAttribute('width'))||100} ${parseFloat(root.getAttribute('height'))||100}`}}catch{return null}
}
function libraryIndex(db){
  const map=new Map()
  ;(db.svgLibrary||[]).forEach(item=>{const key=normalizeFigureKey(componentName(item));if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(item)})
  return map
}
function componentsForFigure(index,figure){
  const list=index.get(normalizeFigureKey(figure))||[]
  const simple=list.find(x=>(x.role||'simple')==='simple'&&x.svgText)
  if(simple)return [simple]
  const base=list.find(x=>x.role==='base'&&x.svgText),tapa=list.find(x=>x.role==='tapa'&&x.svgText)
  if(base&&tapa)return [base,tapa]
  return null
}
function pendingUnits(db,index){
  const units=[],missing=new Map()
  pendingCutByDelivery(db).forEach(group=>group.rows.forEach(row=>{
    const comps=componentsForFigure(index,row.figure)
    if(!comps){missing.set(row.figure,(missing.get(row.figure)||0)+Number(row.qty||0));return}
    for(let i=0;i<Number(row.qty||0);i++)units.push({figure:row.figure,date:group.date||'',orders:group.orders||[],components:comps})
  }))
  return {units,missing:[...missing.entries()].map(([figure,qty])=>({figure,qty}))}
}
function chunks(items,size){const out=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out}
function cleanInner(root){return [...root.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('')}
function composeSourceSvg(units){
  let x=MARGIN,y=MARGIN,rowH=0,parts=[],n=0
  units.forEach(unit=>unit.components.forEach(comp=>{
    const parsed=parseViewBox(comp.svgText);if(!parsed)return
    const w=Math.max(1,Number(comp.sourceWidthCm||comp.widthCm||1)*10),h=Math.max(1,Number(comp.sourceHeightCm||comp.heightCm||1)*10)
    if(x+w>PLATE_W-MARGIN){x=MARGIN;y+=rowH+MARGIN;rowH=0}
    if(y+h>PLATE_H-MARGIN){x=MARGIN+(n%6)*4;y=MARGIN+(n%5)*4}
    parts.push(`<svg data-auto-piece="${n}" x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${parsed.viewBox}" overflow="visible">${cleanInner(parsed.root)}</svg>`)
    x+=w+MARGIN;rowH=Math.max(rowH,h);n++
  }))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1220mm" height="580mm" viewBox="0 0 1220 580">${parts.join('')}</svg>`
}
function summarizeUnits(units){const m=new Map();units.forEach(u=>m.set(u.figure,(m.get(u.figure)||0)+1));return [...m.entries()].map(([figure,qty])=>({figure,qty}))}

export default function MotorDefinitivo({db,onSave}){
  const index=useMemo(()=>libraryIndex(db),[db.svgLibrary])
  const pending=useMemo(()=>pendingUnits(db,index),[db,index])
  const [plans,setPlans]=useState([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState('')
  const [files,setFiles]=useState([]),[manualRows,setManualRows]=useState([]),[manualBusy,setManualBusy]=useState(false)

  async function solve(svgText,filename){
    const response=await fetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename,svgText})})
    let data={};try{data=await response.json()}catch{}
    return {status:data.status||`HTTP ${response.status}`,engine:data.engineVersion||data.engine||'V1.7',pieces:data.pieces??'-',searchGap:data.search_gap_used_mm??'-',rescueGap:data.rescue_search_gap_mm??null,minGap:data.validation?.min_gap_mm??data.min_gap_mm??'-',conflicts:data.validation?.conflicts??data.conflicts??'-',border:data.validation?.border_conflicts??data.border_conflicts??'-',seconds:data.seconds??'-',svgText:data.svgText||null,error:data.error||''}
  }

  async function generateAutomatic(){
    if(!pending.units.length)return alert(pending.missing.length?'No hay piezas generables. Revisá los SVG faltantes en Biblioteca SVG.':'No hay piezas pendientes para cortar.')
    const groups=chunks(pending.units,TARGET_UNITS)
    setBusy(true);setPlans([]);let next=[]
    try{
      for(let i=0;i<groups.length;i++){
        const units=groups[i],filename=`placa-automatica-${String(i+1).padStart(2,'0')}.svg`
        setProgress(`Generando placa ${i+1}/${groups.length} · ${units.length} figuras completas`)
        try{
          const result=await solve(composeSourceSvg(units),filename)
          const plan={id:crypto.randomUUID(),number:i+1,units,summary:summarizeUnits(units),date:units.map(u=>u.date).filter(Boolean).sort()[0]||today(),registered:false,...result}
          next=[...next,plan];setPlans(next)
        }catch(error){const plan={id:crypto.randomUUID(),number:i+1,units,summary:summarizeUnits(units),date:units[0]?.date||today(),registered:false,status:'ERROR',error:error.message,svgText:null,conflicts:'-',border:'-',minGap:'-',seconds:'-'};next=[...next,plan];setPlans(next)}
      }
    }finally{setBusy(false);setProgress('')}
  }

  async function registerPlan(plan){
    if(!okStatus(plan.status)||!plan.svgText)return
    if(plan.registered)return
    if(!confirm(`¿Pasar la Placa ${plan.number} a En corte? Recién ahora se descontarán ${plan.units.length} figuras de Para cortar.`))return
    const number=String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0')
    const batch={id:crypto.randomUUID(),number,date:plan.date||today(),name:`Placa automática V1.7 ${plan.date||today()}`,status:'En corte',notes:`Generada y certificada automáticamente con Motor V1.7 · separación ${plan.minGap} mm · conflictos 0 · borde 0`,multiplier:1,items:plan.summary.map(x=>({figure:x.figure,component:'complete',qty:x.qty})),createdAt:new Date().toISOString()}
    const result=await onSave({...db,cutBatches:[...(db.cutBatches||[]),batch]})
    if(result?.ok!==false)setPlans(list=>list.map(x=>x.id===plan.id?{...x,registered:true,batchNumber:number}:x))
  }

  async function runManual(){
    if(!files.length)return alert('Elegí uno o más SVG.')
    setManualBusy(true);setManualRows([]);let next=[]
    try{for(let i=0;i<files.length;i++){const file=files[i];try{const result=await solve(await file.text(),file.name);next=[...next,{id:`${file.name}-${i}`,fileName:file.name,...result}];setManualRows(next)}catch(error){next=[...next,{id:`${file.name}-${i}`,fileName:file.name,status:'ERROR',error:error.message}];setManualRows(next)}}}finally{setManualBusy(false)}
  }

  return <>
    <Title title="Generar placas · Motor V1.7" sub="Genera placas automáticamente desde Para cortar y Biblioteca SVG. Nada pasa a corte hasta que vos lo confirmás." actions={<button className="primary" disabled={busy||!pending.units.length} onClick={generateAutomatic}>{busy?'Generando…':'Generar placas automáticamente'}</button>}/>
    <div className="notice"><b>Modo seguro</b><span>Primero genera y certifica propuestas. Solo el botón “Pasar a corte” registra la placa y descuenta las cantidades pendientes.</span></div>

    <div className="panel">
      <div className="form-grid">
        <div><small>Figuras pendientes con SVG</small><b className="block big">{pending.units.length}</b></div>
        <div><small>Figuras sin SVG completo</small><b className={'block big '+(pending.missing.length?'red-text':'green-text')}>{pending.missing.reduce((a,x)=>a+x.qty,0)}</b></div>
        <div><small>Placas estimadas iniciales</small><b className="block big">{Math.ceil(pending.units.length/TARGET_UNITS)}</b></div>
        <div><small>Objetivo inicial</small><b className="block big">{TARGET_UNITS} completas/placa</b></div>
      </div>
      {pending.missing.length>0&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>Faltan SVG en Biblioteca</b><span>{pending.missing.map(x=>`${x.figure} × ${x.qty}`).join(' · ')}</span></div>}
      {progress&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>{progress}</b><span>V1.7 está acomodando y certificando la placa.</span></div>}
    </div>

    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Contenido</th><th>Estado</th><th>Gap certificado</th><th>Conflictos</th><th>Borde</th><th>Tiempo</th><th>Acciones</th></tr></thead><tbody>
      {plans.map(plan=>{const ok=okStatus(plan.status);return <tr key={plan.id}>
        <td><b>Placa {plan.number}</b><small className="block">Entrega prioritaria: {plan.date||'sin fecha'}</small><small className="block">{plan.units.length} figuras completas</small></td>
        <td>{plan.summary.map(x=>`${x.figure} × ${x.qty}`).join(', ')}</td>
        <td><b className={ok?'green-text':'red-text'}>{plan.status}</b>{plan.error&&<small className="block red-text">{plan.error}</small>}</td>
        <td><b>{plan.minGap} mm</b></td><td className={Number(plan.conflicts)===0?'green-text':'red-text'}>{plan.conflicts}</td><td className={Number(plan.border)===0?'green-text':'red-text'}>{plan.border}</td><td>{plan.seconds} s</td>
        <td className="row-actions">{ok&&plan.svgText&&<button className="ghost" onClick={()=>downloadSvg(`placa-${plan.number}`,plan.svgText)}>Descargar SVG</button>}{ok&&!plan.registered&&<button className="primary" onClick={()=>registerPlan(plan)}>Pasar a corte</button>}{plan.registered&&<span className="green-text"><b>En corte #{plan.batchNumber}</b></span>}</td>
      </tr>})}
      {!plans.length&&<tr><td colSpan="8">Tocá “Generar placas automáticamente”. El sistema usará primero las entregas más próximas.</td></tr>}
    </tbody></table></div>

    <details className="panel"><summary><b>Herramienta manual de certificación SVG</b></summary>
      <div className="actions" style={{marginTop:12}}><label className="ghost filebtn">Elegir SVG<input type="file" accept=".svg,image/svg+xml" multiple onChange={e=>setFiles([...e.target.files])}/></label><button className="ghost" disabled={manualBusy||!files.length} onClick={runManual}>{manualBusy?'Procesando…':'Certificar SVG manualmente'}</button></div>
      <div className="table-wrap"><table><thead><tr><th>Archivo</th><th>Estado</th><th>Gap</th><th>Conflictos</th><th>Borde</th><th>Acción</th></tr></thead><tbody>{manualRows.map(row=>{const ok=okStatus(row.status);return <tr key={row.id}><td>{row.fileName}</td><td className={ok?'green-text':'red-text'}><b>{row.status}</b></td><td>{row.minGap} mm</td><td>{row.conflicts}</td><td>{row.border}</td><td>{ok&&row.svgText?<button className="ghost" onClick={()=>downloadSvg(row.fileName,row.svgText)}>Descargar</button>:'-'}</td></tr>})}{!manualRows.length&&<tr><td colSpan="6">Sin pruebas manuales.</td></tr>}</tbody></table></div>
    </details>
  </>
}
