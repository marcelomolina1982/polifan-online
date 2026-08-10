import React,{useMemo,useState} from 'react'
import {Title} from '../components/UI'
import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'
import {today} from '../lib/format'

const PLATE_W=1220,PLATE_H=580,BORDER=3,PACK_GAP=3,TARGET_COMPLETE=10

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
function unitStats(unit){
  const boxes=unit.components.map(componentBox).filter(Boolean)
  return {area:boxes.reduce((a,b)=>a+b.w*b.h,0),maxSide:boxes.reduce((m,b)=>Math.max(m,b.w,b.h),0)}
}
function overlaps(a,b){
  return !(a.x+a.fw+PACK_GAP<=b.x||b.x+b.fw+PACK_GAP<=a.x||a.y+a.fh+PACK_GAP<=b.y||b.y+b.fh+PACK_GAP<=a.y)
}
function candidatePoints(placed){
  const xs=new Set([BORDER]),ys=new Set([BORDER])
  placed.forEach(r=>{xs.add(r.x+r.fw+PACK_GAP);ys.add(r.y+r.fh+PACK_GAP)})
  const out=[]
  const sx=[...xs].filter(x=>x<PLATE_W-BORDER).sort((a,b)=>a-b)
  const sy=[...ys].filter(y=>y<PLATE_H-BORDER).sort((a,b)=>a-b)
  sy.forEach(y=>sx.forEach(x=>out.push({x,y})))
  return out
}
function placeBox(box,placed){
  const orientations=[{rotated:false,fw:box.w,fh:box.h}]
  if(Math.abs(box.w-box.h)>0.01)orientations.push({rotated:true,fw:box.h,fh:box.w})
  let best=null
  for(const o of orientations){
    for(const pt of candidatePoints(placed)){
      const c={...box,...o,...pt}
      if(c.x+c.fw>PLATE_W-BORDER||c.y+c.fh>PLATE_H-BORDER)continue
      if(placed.some(r=>overlaps(c,r)))continue
      const maxY=Math.max(c.y+c.fh,...placed.map(r=>r.y+r.fh),0)
      const maxX=Math.max(c.x+c.fw,...placed.map(r=>r.x+r.fw),0)
      const score=maxY*PLATE_W+maxX+(c.rotated?0.1:0)
      if(!best||score<best.score)best={...c,score}
    }
  }
  return best
}
function tryPlaceUnit2D(unit,placed){
  const boxes=unit.components.map(componentBox)
  if(boxes.some(x=>!x))return null
  boxes.sort((a,b)=>b.w*b.h-a.w*a.h)
  const temp=[...placed],added=[]
  for(const box of boxes){
    const p=placeBox(box,temp)
    if(!p)return null
    temp.push(p);added.push(p)
  }
  return added
}
function orderUnits(units,mode){
  return units.map((u,i)=>({u,i,s:unitStats(u)})).sort((a,b)=>{
    const da=String(a.u.date||'9999-99-99'),db=String(b.u.date||'9999-99-99')
    const dc=da.localeCompare(db)
    if(dc)return dc
    if(mode==='areaDesc')return b.s.area-a.s.area||a.i-b.i
    if(mode==='areaAsc')return a.s.area-b.s.area||a.i-b.i
    if(mode==='maxSideDesc')return b.s.maxSide-a.s.maxSide||a.i-b.i
    return a.i-b.i
  }).map(x=>x.u)
}
function packOrder(original,ordered){
  const selected=[],placements=[]
  for(const unit of ordered){
    const added=tryPlaceUnit2D(unit,placements)
    if(!added)continue
    selected.push(unit);placements.push(...added)
  }
  const chosen=new Set(selected)
  const deferred=original.filter(u=>!chosen.has(u))
  const originalIndex=new Map(original.map((u,i)=>[u,i]))
  const priorityPenalty=selected.reduce((a,u)=>a+(originalIndex.get(u)||0),0)
  const usedArea=placements.reduce((a,p)=>a+p.fw*p.fh,0)
  return {units:selected,placements,deferred,priorityPenalty,usedArea}
}
function buildOptimizedPlate(units){
  const modes=['areaDesc','maxSideDesc','areaAsc','original']
  let best=null
  for(const mode of modes){
    const draft=packOrder(units,orderUnits(units,mode))
    if(!best||draft.units.length>best.units.length||
      (draft.units.length===best.units.length&&draft.priorityPenalty<best.priorityPenalty)||
      (draft.units.length===best.units.length&&draft.priorityPenalty===best.priorityPenalty&&draft.usedArea>best.usedArea)){
      best={...draft,strategy:mode}
    }
  }
  return best||{units:[],placements:[],deferred:units,strategy:'none'}
}
function renderPlacement(p,n){
  const inner=cleanInner(p.parsed.root)
  if(!p.rotated)return `<g data-auto-piece="${n}" transform="translate(${p.x} ${p.y})"><svg width="${p.w}" height="${p.h}" viewBox="${p.parsed.viewBox}" overflow="visible">${inner}</svg></g>`
  return `<g data-auto-piece="${n}" transform="translate(${p.x+p.h} ${p.y}) rotate(90)"><svg width="${p.w}" height="${p.h}" viewBox="${p.parsed.viewBox}" overflow="visible">${inner}</svg></g>`
}
function composePlacedSvg(placements){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1220mm" height="580mm" viewBox="0 0 1220 580">${placements.map(renderPlacement).join('')}</svg>`
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
    const draft=buildOptimizedPlate(pending.units)
    if(!draft.units.length)return alert('No pude prearmar una placa sin superposiciones. Revisá las medidas guardadas en Biblioteca SVG.')
    setBusy(true)
    setPlans([])
    setProgress(`Optimizando una placa · ${draft.units.length} figuras completas · objetivo ${TARGET_COMPLETE}+ · ${draft.deferred.length} quedan pendientes`)
    try{
      const result=await solve(composePlacedSvg(draft.placements),'placa-automatica-01.svg')
      setPlans([{
        id:crypto.randomUUID(),number:1,units:draft.units,summary:summarizeUnits(draft.units),strategy:draft.strategy,
        date:draft.units.map(u=>u.date).filter(Boolean).sort()[0]||today(),registered:false,deferred:draft.deferred.length,...result
      }])
    }catch(error){
      setPlans([{id:crypto.randomUUID(),number:1,units:draft.units,summary:summarizeUnits(draft.units),strategy:draft.strategy,date:draft.units[0]?.date||today(),registered:false,deferred:draft.deferred.length,status:'ERROR',error:error.message,svgText:null,conflicts:'-',border:'-',minGap:'-',seconds:'-'}])
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
    <Title title="Generar placas · Motor V1.7" sub="Genera una sola placa por vez. Prioriza la entrega y busca 10 o más figuras completas cuando geométricamente sea posible." actions={<button className="primary" disabled={busy||!pending.units.length} onClick={generateAutomatic}>{busy?'Generando…':'Generar una placa'}</button>}/>
    <div className="notice"><b>Modo seguro</b><span>Un clic genera una sola propuesta. Nada se descuenta ni pasa a corte hasta que vos presionás “Pasar a corte”.</span></div>
    <div className="panel">
      <div className="form-grid">
        <div><small>Figuras pendientes con SVG</small><b className="block big">{pending.units.length}</b></div>
        <div><small>Figuras sin SVG completo</small><b className={'block big '+(pending.missing.length?'red-text':'green-text')}>{pending.missing.reduce((a,x)=>a+x.qty,0)}</b></div>
        <div><small>Objetivo por placa</small><b className="block big">10+ completas</b></div>
        <div><small>Prearmado</small><b className="block big">2D + giro 90° · 3 mm</b></div>
      </div>
      {pending.missing.length>0&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>Faltan SVG en Biblioteca</b><span>{pending.missing.map(x=>`${x.figure} × ${x.qty}`).join(' · ')}</span></div>}
      {progress&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>{progress}</b><span>V1.7 hace el nesting fino y certifica que el resultado final tenga al menos 2,5 mm, 0 conflictos y 0 borde.</span></div>}
    </div>
    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Contenido</th><th>Estado</th><th>Gap certificado</th><th>Conflictos</th><th>Borde</th><th>Tiempo</th><th>Acciones</th></tr></thead><tbody>
      {plans.map(plan=>{const ok=okStatus(plan.status),targetOk=plan.units.length>=TARGET_COMPLETE;return <tr key={plan.id}>
        <td><b>Placa {plan.number}</b><small className="block">Entrega prioritaria: {plan.date||'sin fecha'}</small><small className="block">{plan.units.length} figuras completas</small><small className={'block '+(targetOk?'green-text':'red-text')}><b>{targetOk?'Objetivo 10+ cumplido':'Bajo objetivo de 10'}</b></small>{plan.deferred>0&&<small className="block">{plan.deferred} quedan para próximas placas</small>}</td>
        <td>{plan.summary.map(x=>`${x.figure} × ${x.qty}`).join(', ')}</td>
        <td><b className={ok?'green-text':'red-text'}>{plan.status}</b>{plan.error&&<small className="block red-text">{plan.error}</small>}</td>
        <td><b>{plan.minGap} mm</b></td><td className={Number(plan.conflicts)===0?'green-text':'red-text'}>{plan.conflicts}</td><td className={Number(plan.border)===0?'green-text':'red-text'}>{plan.border}</td><td>{plan.seconds} s</td>
        <td className="row-actions">{ok&&plan.svgText&&<button className="ghost" onClick={()=>downloadSvg('placa-1',plan.svgText)}>Descargar SVG</button>}{ok&&!plan.registered&&<button className="primary" onClick={()=>registerPlan(plan)}>Pasar a corte</button>}{plan.registered&&<span className="green-text"><b>En corte #{plan.batchNumber}</b></span>}</td>
      </tr>})}
      {!plans.length&&<tr><td colSpan="8">Tocá “Generar una placa”. El sistema probará varias estrategias 2D, mantendrá prioridad por fecha y elegirá la que coloque más figuras completas.</td></tr>}
    </tbody></table></div>
    <details className="panel"><summary><b>Herramienta manual de certificación SVG</b></summary>
      <div className="actions" style={{marginTop:12}}><label className="ghost filebtn">Elegir SVG<input type="file" accept=".svg,image/svg+xml" multiple onChange={e=>setFiles([...e.target.files])}/></label><button className="ghost" disabled={manualBusy||!files.length} onClick={runManual}>{manualBusy?'Procesando…':'Certificar SVG manualmente'}</button></div>
      <div className="table-wrap"><table><thead><tr><th>Archivo</th><th>Estado</th><th>Gap</th><th>Conflictos</th><th>Borde</th><th>Acción</th></tr></thead><tbody>{manualRows.map(row=>{const ok=okStatus(row.status);return <tr key={row.id}><td>{row.fileName}</td><td className={ok?'green-text':'red-text'}><b>{row.status}</b></td><td>{row.minGap} mm</td><td>{row.conflicts}</td><td>{row.border}</td><td>{ok&&row.svgText?<button className="ghost" onClick={()=>downloadSvg(row.fileName,row.svgText)}>Descargar</button>:'-'}</td></tr>})}{!manualRows.length&&<tr><td colSpan="6">Sin pruebas manuales.</td></tr>}</tbody></table></div>
    </details>
  </>
}
