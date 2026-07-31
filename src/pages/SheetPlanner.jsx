import React, { useEffect, useMemo, useState } from 'react'

const COLORS = ['#ec2c7c','#14b8b8','#087fc4','#7b3dbb','#f59e0b','#16a34a','#ef4444','#6366f1']
const PX_PER_CM = 2

function num(v, fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback }
function uid(){ return Math.random().toString(36).slice(2,9) }
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))}

function parseSvg(text){
  const doc=new DOMParser().parseFromString(text,'image/svg+xml')
  const svg=doc.documentElement
  if(!svg || svg.nodeName.toLowerCase()!=='svg' || doc.querySelector('parsererror')) throw new Error('SVG inválido')
  svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n=>n.remove())
  svg.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{
    const n=a.name.toLowerCase(), v=a.value.trim().toLowerCase()
    if(n.startsWith('on') || (['href','xlink:href'].includes(n) && (v.startsWith('http')||v.startsWith('javascript:')))) el.removeAttribute(a.name)
  }))
  let vb=svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number)
  const widthAttr=parseFloat(svg.getAttribute('width'))||0, heightAttr=parseFloat(svg.getAttribute('height'))||0
  if(!vb || vb.length!==4 || !vb.every(Number.isFinite)) vb=[0,0,widthAttr||100,heightAttr||100]
  const inner=[...svg.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('')
  return {viewBox:vb.join(' '),vbW:vb[2],vbH:vb[3],inner}
}

function svgDataUrl(text){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`}
function loadImage(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('No se pudo leer el SVG'));im.src=src})}

async function makeMask(item, rotated=false, gapCm=0){
  const baseW=Math.max(.1,num(item.width)), baseH=Math.max(.1,num(item.height))
  const outW=rotated?baseH:baseW, outH=rotated?baseW:baseH
  const pad=Math.ceil(Math.max(0,num(gapCm))*PX_PER_CM/2)
  const w=Math.max(1,Math.ceil(outW*PX_PER_CM)), h=Math.max(1,Math.ceil(outH*PX_PER_CM))
  const canvas=document.createElement('canvas');canvas.width=w+pad*2;canvas.height=h+pad*2
  const ctx=canvas.getContext('2d',{willReadFrequently:true})
  if(item.svgText){
    const im=await loadImage(svgDataUrl(item.svgText))
    ctx.save();ctx.translate(pad,pad)
    if(rotated){ctx.translate(w,0);ctx.rotate(Math.PI/2);ctx.drawImage(im,0,0,h,w)}else ctx.drawImage(im,0,0,w,h)
    ctx.restore()
  }else{ctx.fillStyle='#000';ctx.fillRect(pad,pad,w,h)}
  const alpha=ctx.getImageData(0,0,canvas.width,canvas.height).data
  let mask=new Uint8Array(canvas.width*canvas.height)
  for(let i=0;i<mask.length;i++) if(alpha[i*4+3]>20) mask[i]=1
  if(pad>0){
    const dilated=new Uint8Array(mask.length)
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(mask[y*canvas.width+x]){
      for(let dy=-pad;dy<=pad;dy++)for(let dx=-pad;dx<=pad;dx++)if(dx*dx+dy*dy<=pad*pad){const xx=x+dx,yy=y+dy;if(xx>=0&&(xx<canvas.width)&&yy>=0&&yy<canvas.height)dilated[yy*canvas.width+xx]=1}
    }
    mask=dilated
  }
  return {mask,pw:canvas.width,ph:canvas.height,w:outW,h:outH,pad}
}

function collides(occ,sw,sh,m,x,y){
  if(x<0||y<0||x+m.pw>sw||y+m.ph>sh)return true
  for(let my=0;my<m.ph;my++)for(let mx=0;mx<m.pw;mx++)if(m.mask[my*m.pw+mx]&&occ[(y+my)*sw+x+mx])return true
  return false
}
function stamp(occ,sw,m,x,y){for(let my=0;my<m.ph;my++)for(let mx=0;mx<m.pw;mx++)if(m.mask[my*m.pw+mx])occ[(y+my)*sw+x+mx]=1}

async function packSilhouettes(items,sheetWcm,sheetHcm,gap,allowRotate){
  const sw=Math.max(1,Math.floor(sheetWcm*PX_PER_CM)), sh=Math.max(1,Math.floor(sheetHcm*PX_PER_CM))
  const pieces=[]
  for(let idx=0;idx<items.length;idx++){
    const it=items[idx],q=Math.max(0,Math.floor(num(it.qty)))
    if(num(it.width)<=0||num(it.height)<=0)continue
    const normal=await makeMask(it,false,gap), rotated=allowRotate&&num(it.width)!==num(it.height)?await makeMask(it,true,gap):null
    for(let i=0;i<q;i++)pieces.push({id:`${it.id}-${i}`,itemId:it.id,name:it.name||`Figura ${idx+1}`,color:it.color||COLORS[idx%COLORS.length],svgText:it.svgText,svgMeta:it.svgMeta,normal,rotated})
  }
  pieces.sort((a,b)=>Math.max(b.normal.pw,b.normal.ph)-Math.max(a.normal.pw,a.normal.ph) || b.normal.pw*b.normal.ph-a.normal.pw*a.normal.ph)
  const sheets=[],rejected=[]
  const trySheet=(sheet,piece)=>{
    const variants=[{m:piece.normal,rotated:false},...(piece.rotated?[{m:piece.rotated,rotated:true}]:[])]
    let best=null
    for(const v of variants){
      for(let y=0;y<=sh-v.m.ph;y++)for(let x=0;x<=sw-v.m.pw;x++)if(!collides(sheet.occ,sw,sh,v.m,x,y)){
        const score=y*sw+x;if(!best||score<best.score)best={...v,x,y,score};break
      }
    }
    if(!best)return false
    stamp(sheet.occ,sw,best.m,best.x,best.y)
    sheet.placed.push({...piece,x:(best.x+best.m.pad)/PX_PER_CM,y:(best.y+best.m.pad)/PX_PER_CM,w:best.m.w,h:best.m.h,rotated:best.rotated})
    return true
  }
  for(const p of pieces){
    let done=false
    for(const s of sheets)if(trySheet(s,p)){done=true;break}
    if(!done){const s={occ:new Uint8Array(sw*sh),placed:[]};if(trySheet(s,p)){sheets.push(s)}else rejected.push(p)}
  }
  const area=sheetWcm*sheetHcm
  sheets.forEach((s,i)=>{s.number=i+1;s.used=s.placed.reduce((a,p)=>a+p.w*p.h,0);s.efficiency=area?100*s.used/area:0;delete s.occ})
  return {sheets,rejected,total:pieces.length,used:sheets.reduce((a,s)=>a+s.used,0),sheetArea:area}
}

export default function SheetPlanner(){
  const [sheetW,setSheetW]=useState(58),[sheetH,setSheetH]=useState(118),[gap,setGap]=useState(1),[rotate,setRotate]=useState(true)
  const [active,setActive]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [items,setItems]=useState([{id:uid(),name:'Mariposa',width:22,height:16,qty:6,color:COLORS[0],svgText:null,svgMeta:null},{id:uid(),name:'Corazón',width:20,height:18,qty:8,color:COLORS[1],svgText:null,svgMeta:null}])
  const [result,setResult]=useState({sheets:[],rejected:[],total:0,used:0,sheetArea:0})
  const sheet=result.sheets[active]||result.sheets[0], scale=Math.min(640/Math.max(1,num(sheetW)),760/Math.max(1,num(sheetH)))
  const dirtyKey=useMemo(()=>JSON.stringify([items.map(x=>[x.id,x.name,x.width,x.height,x.qty,!!x.svgText]),sheetW,sheetH,gap,rotate]),[items,sheetW,sheetH,gap,rotate])
  useEffect(()=>{setResult(r=>({...r,stale:true}))},[dirtyKey])

  function update(id,key,value){setItems(v=>v.map(x=>x.id===id?{...x,[key]:value}:x))}
  function add(){setItems(v=>[...v,{id:uid(),name:'Nueva figura',width:10,height:10,qty:1,color:COLORS[v.length%COLORS.length],svgText:null,svgMeta:null}])}
  function remove(id){setItems(v=>v.filter(x=>x.id!==id))}
  function resetExample(){setItems([{id:uid(),name:'Figura',width:20,height:20,qty:1,color:COLORS[0],svgText:null,svgMeta:null}]);setResult({sheets:[],rejected:[],total:0,used:0,sheetArea:0});setActive(0)}
  async function uploadSvg(id,file){
    if(!file)return
    try{const text=await file.text(),meta=parseSvg(text);setItems(v=>v.map(x=>x.id===id?{...x,svgText:text,svgMeta:meta,name:x.name==='Nueva figura'||x.name==='Figura'?file.name.replace(/\.svg$/i,''):x.name}:x));setError('')}catch(e){setError(e.message||'No se pudo cargar el SVG')}
  }
  async function generate(){
    setBusy(true);setError('');setActive(0)
    try{setResult({...await packSilhouettes(items,num(sheetW),num(sheetH),num(gap),rotate),stale:false})}catch(e){setError(e.message||'No se pudo calcular la plancha')}finally{setBusy(false)}
  }
  function pieceMarkup(p){
    if(!p.svgText||!p.svgMeta)return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="none" stroke="black" stroke-width="0.08"/>`
    const m=p.svgMeta
    if(p.rotated)return `<g transform="translate(${p.x+p.w} ${p.y}) rotate(90)"><svg x="0" y="0" width="${p.h}" height="${p.w}" viewBox="${esc(m.viewBox)}" preserveAspectRatio="none">${m.inner}</svg></g>`
    return `<svg x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" viewBox="${esc(m.viewBox)}" preserveAspectRatio="none">${m.inner}</svg>`
  }
  function downloadSvg(){
    if(!sheet)return
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}cm" height="${sheetH}cm" viewBox="0 0 ${sheetW} ${sheetH}"><rect width="100%" height="100%" fill="white"/>${sheet.placed.map(pieceMarkup).join('')}</svg>`
    const blob=new Blob([svg],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`plancha-siluetas-${sheet.number}.svg`;a.click();URL.revokeObjectURL(url)
  }

  return <div className="sheet-planner-page">
    <div className="page-title"><div><h1>Diseñador de planchas con siluetas SVG</h1><p>Cargá los contornos reales y acomodalos automáticamente para aprovechar mejor el polifan.</p></div><div className="title-actions"><button className="ghost" onClick={resetExample}>Limpiar</button><button className="primary" onClick={generate} disabled={busy}>{busy?'Calculando…':'Generar planchas'}</button></div></div>
    <section className="panel planner-settings"><label>Ancho de plancha (cm)<input type="number" min="1" step="0.1" value={sheetW} onChange={e=>setSheetW(e.target.value)}/></label><label>Alto de plancha (cm)<input type="number" min="1" step="0.1" value={sheetH} onChange={e=>setSheetH(e.target.value)}/></label><label>Separación (cm)<input type="number" min="0" step="0.1" value={gap} onChange={e=>setGap(e.target.value)}/></label><label className="planner-check"><input type="checkbox" checked={rotate} onChange={e=>setRotate(e.target.checked)}/> Permitir rotar figuras</label></section>
    {error&&<div className="notice">{error}</div>}
    <div className="planner-layout">
      <section className="panel planner-items"><div className="panel-heading"><h3>Figuras y archivos SVG</h3><button className="primary" onClick={add}>＋ Agregar</button></div><div className="planner-item-head svg-head"><span>Nombre / SVG</span><span>Ancho</span><span>Alto</span><span>Cant.</span><span></span></div>
        {items.map(it=><div className="planner-item svg-item" key={it.id}><div className="svg-upload-cell"><input value={it.name} onChange={e=>update(it.id,'name',e.target.value)}/><label className={it.svgText?'svg-file loaded':'svg-file'}>{it.svgText?'✓ SVG cargado':'Subir SVG'}<input type="file" accept=".svg,image/svg+xml" onChange={e=>uploadSvg(it.id,e.target.files?.[0])}/></label>{it.svgText&&<button className="link-button" onClick={()=>setItems(v=>v.map(x=>x.id===it.id?{...x,svgText:null,svgMeta:null}:x))}>Quitar</button>}</div><input type="number" min="0.1" step="0.1" value={it.width} onChange={e=>update(it.id,'width',e.target.value)}/><input type="number" min="0.1" step="0.1" value={it.height} onChange={e=>update(it.id,'height',e.target.value)}/><input type="number" min="0" step="1" value={it.qty} onChange={e=>update(it.id,'qty',e.target.value)}/><button className="danger small" onClick={()=>remove(it.id)}>×</button></div>)}
        <small className="planner-note">Los SVG se rasterizan únicamente para calcular choques entre siluetas. Al descargar, se conservan como vectores. Las figuras sin SVG siguen usando su rectángulo exterior.</small>
      </section>
      <section className="planner-preview"><div className="planner-kpis"><div className="metric-card"><small>Planchas</small><b className="viz-stat-value">{result.sheets.length}</b></div><div className="metric-card"><small>Total de piezas</small><b className="viz-stat-value">{result.total}</b></div><div className="metric-card"><small>Aprovechamiento</small><b className="viz-stat-value">{result.sheets.length?Math.round(100*result.used/(result.sheetArea*result.sheets.length)):0}%</b></div></div>
        {result.stale&&result.sheets.length>0&&<div className="notice">Cambiaste datos. Presioná “Generar planchas” para actualizar el cálculo.</div>}{result.rejected.length>0&&<div className="notice">Hay {result.rejected.length} pieza(s) que no entran en la plancha.</div>}
        <div className="panel preview-panel"><div className="panel-heading"><h3>Vista previa</h3><div><button className="ghost" disabled={!sheet} onClick={()=>window.print()}>Imprimir</button> <button className="ghost" disabled={!sheet} onClick={downloadSvg}>Descargar SVG</button></div></div>{result.sheets.length>1&&<div className="sheet-tabs">{result.sheets.map((s,i)=><button className={active===i?'active':''} onClick={()=>setActive(i)} key={i}>Plancha {i+1}</button>)}</div>}{!sheet?<div className="empty-message">Cargá las figuras y presioná “Generar planchas”.</div>:<><div className="sheet-info"><b>Plancha {sheet.number}</b><span>{sheet.placed.length} piezas · {sheet.efficiency.toFixed(1)}% aproximado</span></div><div className="sheet-canvas-wrap"><div className="sheet-canvas" style={{width:num(sheetW)*scale,height:num(sheetH)*scale}}>{sheet.placed.map(p=><div key={p.id} className={`placed-piece ${p.svgText?'silhouette':''}`} title={`${p.name} ${p.w}×${p.h} cm${p.rotated?' (rotada)':''}`} style={{left:p.x*scale,top:p.y*scale,width:p.w*scale,height:p.h*scale,background:p.svgText?'transparent':p.color,transform:p.rotated?'rotate(0deg)':''}}>{p.svgText?<img src={svgDataUrl(p.svgText)} alt={p.name} style={{width:'100%',height:'100%',objectFit:'fill',transform:p.rotated?'rotate(90deg) scale('+p.h/p.w+','+p.w/p.h+')':'none'}}/>:<><span>{p.name}</span><small>{p.w}×{p.h}</small></>}</div>)}</div></div></>}</div>
      </section>
    </div>
  </div>
}
