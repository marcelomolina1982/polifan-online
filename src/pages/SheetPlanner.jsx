import React, { useMemo, useState } from 'react'

const COLORS = ['#ec2c7c','#14b8b8','#087fc4','#7b3dbb','#f59e0b','#16a34a','#ef4444','#6366f1']

function num(v, fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback }
function uid(){ return Math.random().toString(36).slice(2,9) }

function pack(items, sheetW, sheetH, gap, allowRotate){
  const pieces=[]
  items.forEach((it,idx)=>{
    const w=num(it.width), h=num(it.height), q=Math.max(0,Math.floor(num(it.qty)))
    for(let i=0;i<q;i++) pieces.push({id:`${it.id}-${i}`,itemId:it.id,name:it.name||`Figura ${idx+1}`,w,h,color:it.color||COLORS[idx%COLORS.length]})
  })
  pieces.sort((a,b)=>Math.max(b.w,b.h)-Math.max(a.w,a.h) || b.w*b.h-a.w*a.h)
  const sheets=[]

  function tryPlace(sheet,piece){
    const variants=[{w:piece.w,h:piece.h,rotated:false}]
    if(allowRotate && piece.w!==piece.h) variants.push({w:piece.h,h:piece.w,rotated:true})
    for(const v of variants){
      for(const shelf of sheet.shelves){
        if(v.h<=shelf.height && shelf.x+v.w<=sheetW){
          const placed={...piece,...v,x:shelf.x,y:shelf.y}
          shelf.x += v.w+gap
          sheet.placed.push(placed)
          return true
        }
      }
    }
    for(const v of variants){
      const y=sheet.shelves.length ? Math.max(...sheet.shelves.map(s=>s.y+s.height+gap)) : 0
      if(v.w<=sheetW && y+v.h<=sheetH){
        sheet.shelves.push({y,height:v.h,x:v.w+gap})
        sheet.placed.push({...piece,...v,x:0,y})
        return true
      }
    }
    return false
  }

  const rejected=[]
  pieces.forEach(piece=>{
    let done=false
    for(const sheet of sheets){ if(tryPlace(sheet,piece)){done=true;break} }
    if(!done){
      const sheet={placed:[],shelves:[]}
      if(tryPlace(sheet,piece)){sheets.push(sheet)} else rejected.push(piece)
    }
  })
  const sheetArea=sheetW*sheetH
  sheets.forEach((s,i)=>{s.number=i+1;s.used=s.placed.reduce((a,p)=>a+p.w*p.h,0);s.efficiency=sheetArea?100*s.used/sheetArea:0})
  return {sheets,rejected,total:pieces.length,used:sheets.reduce((a,s)=>a+s.used,0),sheetArea}
}

export default function SheetPlanner(){
  const [sheetW,setSheetW]=useState(58)
  const [sheetH,setSheetH]=useState(118)
  const [gap,setGap]=useState(1)
  const [rotate,setRotate]=useState(true)
  const [active,setActive]=useState(0)
  const [items,setItems]=useState([
    {id:uid(),name:'Mariposa',width:22,height:16,qty:6,color:COLORS[0]},
    {id:uid(),name:'Corazón',width:20,height:18,qty:8,color:COLORS[1]},
  ])
  const result=useMemo(()=>pack(items,num(sheetW),num(sheetH),num(gap),rotate),[items,sheetW,sheetH,gap,rotate])
  const sheet=result.sheets[active]||result.sheets[0]
  const scale=Math.min(640/Math.max(1,num(sheetW)),760/Math.max(1,num(sheetH)))

  function update(id,key,value){setItems(v=>v.map(x=>x.id===id?{...x,[key]:value}:x))}
  function add(){setItems(v=>[...v,{id:uid(),name:'Nueva figura',width:10,height:10,qty:1,color:COLORS[v.length%COLORS.length]}])}
  function remove(id){setItems(v=>v.filter(x=>x.id!==id))}
  function resetExample(){setItems([{id:uid(),name:'Figura',width:20,height:20,qty:1,color:COLORS[0]}]);setActive(0)}
  function downloadSvg(){
    if(!sheet) return
    const rects=sheet.placed.map(p=>`<g><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="none" stroke="black" stroke-width="0.15"/><text x="${p.x+p.w/2}" y="${p.y+p.h/2}" text-anchor="middle" font-size="1.8">${String(p.name).replace(/[<>&]/g,'')}</text></g>`).join('')
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}cm" height="${sheetH}cm" viewBox="0 0 ${sheetW} ${sheetH}">${rects}</svg>`
    const blob=new Blob([svg],{type:'image/svg+xml'}), url=URL.createObjectURL(blob), a=document.createElement('a')
    a.href=url;a.download=`plancha-${sheet.number}.svg`;a.click();URL.revokeObjectURL(url)
  }

  return <div className="sheet-planner-page">
    <div className="page-title"><div><h1>Diseñador automático de planchas</h1><p>Calculá cuántas planchas necesitás y acomodá las figuras reduciendo desperdicio.</p></div><div className="title-actions"><button className="ghost" onClick={resetExample}>Limpiar</button><button className="primary" onClick={()=>window.print()}>Imprimir</button></div></div>

    <section className="panel planner-settings">
      <label>Ancho de plancha (cm)<input type="number" min="1" step="0.1" value={sheetW} onChange={e=>{setSheetW(e.target.value);setActive(0)}}/></label>
      <label>Alto de plancha (cm)<input type="number" min="1" step="0.1" value={sheetH} onChange={e=>{setSheetH(e.target.value);setActive(0)}}/></label>
      <label>Separación (cm)<input type="number" min="0" step="0.1" value={gap} onChange={e=>{setGap(e.target.value);setActive(0)}}/></label>
      <label className="planner-check"><input type="checkbox" checked={rotate} onChange={e=>{setRotate(e.target.checked);setActive(0)}}/> Permitir rotar figuras</label>
    </section>

    <div className="planner-layout">
      <section className="panel planner-items">
        <div className="panel-heading"><h3>Figuras</h3><button className="primary" onClick={add}>＋ Agregar</button></div>
        <div className="planner-item-head"><span>Nombre</span><span>Ancho</span><span>Alto</span><span>Cant.</span><span></span></div>
        {items.map(it=><div className="planner-item" key={it.id}>
          <input value={it.name} onChange={e=>update(it.id,'name',e.target.value)}/>
          <input type="number" min="0.1" step="0.1" value={it.width} onChange={e=>update(it.id,'width',e.target.value)}/>
          <input type="number" min="0.1" step="0.1" value={it.height} onChange={e=>update(it.id,'height',e.target.value)}/>
          <input type="number" min="0" step="1" value={it.qty} onChange={e=>update(it.id,'qty',e.target.value)}/>
          <button className="danger small" onClick={()=>remove(it.id)}>×</button>
        </div>)}
        <small className="planner-note">El cálculo usa el rectángulo exterior de cada figura. En una próxima etapa podrá leer el contorno real desde SVG.</small>
      </section>

      <section className="planner-preview">
        <div className="planner-kpis">
          <div className="metric-card"><small>Planchas</small><b className="viz-stat-value">{result.sheets.length}</b></div>
          <div className="metric-card"><small>Total de piezas</small><b className="viz-stat-value">{result.total}</b></div>
          <div className="metric-card"><small>Aprovechamiento</small><b className="viz-stat-value">{result.sheets.length?Math.round(100*result.used/(result.sheetArea*result.sheets.length)):0}%</b></div>
        </div>
        {result.rejected.length>0 && <div className="notice">Hay {result.rejected.length} pieza(s) que no entran por ser más grandes que la plancha.</div>}
        <div className="panel preview-panel">
          <div className="panel-heading"><h3>Vista previa</h3><button className="ghost" disabled={!sheet} onClick={downloadSvg}>Descargar SVG</button></div>
          {result.sheets.length>1 && <div className="sheet-tabs">{result.sheets.map((s,i)=><button className={active===i?'active':''} onClick={()=>setActive(i)} key={i}>Plancha {i+1}</button>)}</div>}
          {!sheet ? <div className="empty-message">Agregá figuras con medidas y cantidad.</div> : <>
            <div className="sheet-info"><b>Plancha {sheet.number}</b><span>{sheet.placed.length} piezas · {sheet.efficiency.toFixed(1)}% aprovechado</span></div>
            <div className="sheet-canvas-wrap"><div className="sheet-canvas" style={{width:num(sheetW)*scale,height:num(sheetH)*scale}}>
              {sheet.placed.map(p=><div key={p.id} className="placed-piece" title={`${p.name} ${p.w}×${p.h} cm${p.rotated?' (rotada)':''}`} style={{left:p.x*scale,top:p.y*scale,width:p.w*scale,height:p.h*scale,background:p.color}}><span>{p.name}</span><small>{p.w}×{p.h}</small></div>)}
            </div></div>
          </>}
        </div>
      </section>
    </div>
  </div>
}
