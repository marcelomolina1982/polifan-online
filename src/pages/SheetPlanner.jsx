import React, { useEffect, useMemo, useState } from 'react'
import { pendingCutRows } from '../lib/inventory'
import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'

const COLORS=['#ec2c7c','#14b8b8','#087fc4','#7b3dbb','#f59e0b','#16a34a','#ef4444','#6366f1']
const PX_PER_CM=3
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const sameSize=(a,b,t=.0005)=>Math.abs(num(a)-num(b))<=t
const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)
const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const svgDataUrl=text=>`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
const loadImage=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('No se pudo leer el SVG'));im.src=src})

function modelSlug(value){return String(value||'modelo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'modelo'}
function componentModelId(item){return item.modelId||(item.productId?`producto:${item.productId}`:`modelo:${modelSlug(item.modelName||item.productName||String(item.name||'').replace(/\s*[·-]\s*(tapa|base|figura|capa.*)$/i,''))}`)}
function componentModelName(item){return item.modelName||item.productName||String(item.name||'Modelo').replace(/\s*[·-]\s*(tapa|base|figura|capa.*)$/i,'')}
function normalizedName(value){return modelSlug(String(value||'').replace(/\b(tapa|base|figura|capa)\b/gi,''))}

function parseSvg(text){
  const doc=new DOMParser().parseFromString(text,'image/svg+xml'),svg=doc.documentElement
  if(!svg||svg.nodeName.toLowerCase()!=='svg'||doc.querySelector('parsererror'))throw new Error('SVG inválido')
  svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n=>n.remove())
  let vb=svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number)
  if(!vb||vb.length!==4||!vb.every(Number.isFinite))vb=[0,0,parseFloat(svg.getAttribute('width'))||100,parseFloat(svg.getAttribute('height'))||100]
  return {viewBox:vb.join(' '),vbW:vb[2],vbH:vb[3],inner:[...svg.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('')}
}
async function makeMask(item,rotated=false,gapCm=0){
  const bw=Math.max(.1,num(item.width)),bh=Math.max(.1,num(item.height)),ow=rotated?bh:bw,oh=rotated?bw:bh
  const pad=Math.ceil(Math.max(0,num(gapCm))*PX_PER_CM/2),w=Math.max(1,Math.ceil(ow*PX_PER_CM)),h=Math.max(1,Math.ceil(oh*PX_PER_CM))
  const canvas=document.createElement('canvas');canvas.width=w+pad*2;canvas.height=h+pad*2
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#000'
  if(item.svgText){
    const doc=new DOMParser().parseFromString(item.svgText,'image/svg+xml'),svg=doc.documentElement
    if(item.blockInterior!==false)svg.querySelectorAll('path,polygon,polyline,circle,ellipse,rect').forEach(el=>{el.setAttribute('fill','#000');el.setAttribute('stroke','#000')})
    const im=await loadImage(svgDataUrl(new XMLSerializer().serializeToString(svg)))
    ctx.save();ctx.translate(pad,pad);if(rotated){ctx.translate(w,0);ctx.rotate(Math.PI/2);ctx.drawImage(im,0,0,h,w)}else ctx.drawImage(im,0,0,w,h);ctx.restore()
  }else ctx.fillRect(pad,pad,w,h)
  const alpha=ctx.getImageData(0,0,canvas.width,canvas.height).data;let mask=new Uint8Array(canvas.width*canvas.height)
  for(let i=0;i<mask.length;i++)if(alpha[i*4+3]>20)mask[i]=1
  if(pad){const d=new Uint8Array(mask.length);for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(mask[y*canvas.width+x])for(let dy=-pad;dy<=pad;dy++)for(let dx=-pad;dx<=pad;dx++)if(dx*dx+dy*dy<=pad*pad){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<canvas.width&&yy>=0&&yy<canvas.height)d[yy*canvas.width+xx]=1}mask=d}
  return {mask,pw:canvas.width,ph:canvas.height,w:ow,h:oh,pad}
}
function collides(occ,sw,m,x,y){if(x<0||y<0||x+m.pw>sw)return true;for(let my=0;my<m.ph;my++)for(let mx=0;mx<m.pw;mx++)if(m.mask[my*m.pw+mx]&&occ[(y+my)*sw+x+mx])return true;return false}
function stamp(occ,sw,m,x,y){for(let my=0;my<m.ph;my++)for(let mx=0;mx<m.pw;mx++)if(m.mask[my*m.pw+mx])occ[(y+my)*sw+x+mx]=1}
async function pack(items,wCm,hCm,gap){
  const sw=Math.floor(wCm*PX_PER_CM),sh=Math.floor(hCm*PX_PER_CM),pieces=[]
  for(const it of items){const q=Math.max(0,Math.floor(num(it.qty)));if(!q||!num(it.width)||!num(it.height))continue;const normal=await makeMask(it,false,gap),rotated=it.allowRotate!==false&&num(it.width)!==num(it.height)?await makeMask(it,true,gap):null;for(let i=0;i<q;i++)pieces.push({...it,instanceId:`${it.id}-${i}`,normal,rotated})}
  pieces.sort((a,b)=>num(a.priority,999999)-num(b.priority,999999)||b.normal.pw*b.normal.ph-a.normal.pw*a.normal.ph)
  const sheets=[],rejected=[]
  function trySheet(sheet,p){let best=null;for(const v of [{m:p.normal,rotated:false},...(p.rotated?[{m:p.rotated,rotated:true}]:[])])for(let y=0;y<=sh-v.m.ph;y++)for(let x=0;x<=sw-v.m.pw;x++){if(!collides(sheet.occ,sw,v.m,x,y)){const score=y*sw+x;if(!best||score<best.score)best={...v,x,y,score};break}}if(!best)return false;stamp(sheet.occ,sw,best.m,best.x,best.y);sheet.placed.push({...p,x:(best.x+best.m.pad)/PX_PER_CM,y:(best.y+best.m.pad)/PX_PER_CM,w:best.m.w,h:best.m.h,rotated:best.rotated});return true}
  for(const p of pieces){let ok=sheets.some(s=>trySheet(s,p));if(!ok){const s={occ:new Uint8Array(sw*sh),placed:[]};if(trySheet(s,p))sheets.push(s);else rejected.push(p)}}
  const area=wCm*hCm;sheets.forEach((s,i)=>{s.number=i+1;s.used=s.placed.reduce((a,p)=>a+p.w*p.h,0);s.efficiency=area?100*s.used/area:0;delete s.occ})
  return {sheets,rejected,total:pieces.length,sheetArea:area,used:sheets.reduce((a,s)=>a+s.used,0)}
}



function usableModelComponents(model){
  const components=model?.components||[]
  const tapa=components.find(c=>c.role==='tapa'),base=components.find(c=>c.role==='base')
  if(tapa&&base){
    const compatible=tapa.pairCompatible!==false&&base.pairCompatible!==false&&sameSize(tapa.sourceWidthCm||tapa.widthCm,base.sourceWidthCm||base.widthCm,.001)&&sameSize(tapa.sourceHeightCm||tapa.heightCm,base.sourceHeightCm||base.heightCm,.001)
    if(!compatible)return {components:[],reason:'tapa y base con medidas incompatibles'}
  }
  return {components,reason:''}
}

function pendingGroupsByDelivery(db){
  const available={}
  pendingCutRows(db).forEach(r=>{available[r.figure]=num(r.pending)})
  const groups={}
  ;(db.orders||[]).filter(o=>o.status!=='Cancelado').slice().sort((a,b)=>(a.delivery||'9999-12-31').localeCompare(b.delivery||'9999-12-31')||String(a.number||'').localeCompare(String(b.number||''))).forEach(o=>{
    const date=o.delivery||'sin-fecha'
    if(!groups[date])groups[date]={date:o.delivery||'',orders:[],rows:{}}
    groups[date].orders.push(o.number)
    ;(o.items||[]).forEach(it=>{
      const remaining=Math.max(0,num(available[it.figure]))
      if(!it.figure||remaining<=0)return
      const qty=Math.min(remaining,Math.max(0,num(it.qty)))
      if(qty>0){groups[date].rows[it.figure]=(groups[date].rows[it.figure]||0)+qty;available[it.figure]=remaining-qty}
    })
  })
  Object.entries(available).forEach(([figure,qty])=>{if(qty>0){const key='sin-fecha';if(!groups[key])groups[key]={date:'',orders:[],rows:{}};groups[key].rows[figure]=(groups[key].rows[figure]||0)+qty}})
  return Object.values(groups).map(g=>({...g,orders:[...new Set(g.orders)],rows:Object.entries(g.rows).map(([figure,qty])=>({figure,qty}))})).filter(g=>g.rows.length).sort((a,b)=>(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31'))
}
function bestSellerNames(db){
  const counts={}
  ;(db.orders||[]).filter(o=>o.status!=='Cancelado').forEach(o=>(o.items||[]).forEach(i=>{if(i.figure)counts[i.figure]=(counts[i.figure]||0)+num(i.qty)}))
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([name])=>name)
}

function sheetProductionRows(sheet,multiplier=1){
  const totals={}
  ;(sheet?.placed||[]).forEach(p=>{
    const figure=p.figure||p.name?.split(' · ')[0]||''
    if(!figure)return
    totals[figure]=(totals[figure]||0)+num(p.unitWeight,1)
  })
  return Object.entries(totals).map(([figure,baseQty])=>({figure,baseQty,qty:baseQty*num(multiplier,1)}))
}

export default function SheetPlanner({db,onSave}){
  const [sheetW,setSheetW]=useState(122),[sheetH,setSheetH]=useState(58),[gap,setGap]=useState(.2)
  const [items,setItems]=useState([]),[result,setResult]=useState({sheets:[],rejected:[],total:0,used:0,sheetArea:0}),[active,setActive]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[minFill,setMinFill]=useState(85),[useFillers,setUseFillers]=useState(true),[autoSummary,setAutoSummary]=useState(null),[sheetMultipliers,setSheetMultipliers]=useState({}),[modelSearch,setModelSearch]=useState(''),[modelQty,setModelQty]=useState(1)
  const library=db.svgLibrary||[],products=normalizeCatalogProducts(db.customerCatalog?.length?db.customerCatalog:catalogProducts),pending=pendingCutRows(db).filter(x=>x.pending>0),sheet=result.sheets[active]||result.sheets[0]
  const libraryModels=useMemo(()=>{const map=new Map();library.forEach(c=>{const id=componentModelId(c),name=componentModelName(c);if(!map.has(id))map.set(id,{id,name,productId:c.productId||'',components:[]});map.get(id).components.push(c)});return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'es'))},[library])
  function modelForFigure(figure){const key=normalizedName(figure);const product=products.find(p=>normalizedName(p.name)===key)||products.find(p=>normalizedName(p.name).includes(key)||key.includes(normalizedName(p.name)));const model=libraryModels.find(m=>(product?.id&&m.productId===product.id)||normalizedName(m.name)===key)||libraryModels.find(m=>normalizedName(m.name).includes(key)||key.includes(normalizedName(m.name)));return {product,model}}
  const scale=Math.min(700/num(sheetW,122),420/num(sheetH,58))
  const dirtyKey=useMemo(()=>JSON.stringify([items.map(x=>[x.id,x.qty,x.width,x.height,x.svgId]),sheetW,sheetH,gap]),[items,sheetW,sheetH,gap])
  useEffect(()=>setResult(r=>({...r,stale:true})),[dirtyKey])

  function loadPending(){
    const next=[];const missing=[]
    for(const row of pending){
      const {product,model}=modelForFigure(row.figure)
      const checked=usableModelComponents(model),components=checked.components
      if(!components.length){missing.push(`${row.figure}${checked.reason?` (${checked.reason})`:''}`);continue}
      const totalPerUnit=components.reduce((a,c)=>a+num(c.qtyPerUnit,1),0)||1;components.forEach((c,i)=>{const width=num(c.sourceWidthCm||c.widthCm),height=num(c.sourceHeightCm||c.heightCm);next.push({id:uid(),svgId:c.id,productId:product?.id,figure:row.figure,name:`${row.figure} · ${c.role||'pieza'}`,width,height,sourceWidth:width,sourceHeight:height,sizeLocked:true,qty:row.pending*num(c.qtyPerUnit||1),unitWeight:1/totalPerUnit,svgText:c.svgText,svgMeta:parseSvg(c.svgText),allowRotate:c.allowRotate!==false,blockInterior:c.blockInterior!==false,color:COLORS[i%COLORS.length]})})
    }
    setItems(next);if(missing.length)alert(`Faltan SVG vinculados para: ${missing.join(', ')}`)
  }
  function componentsForRows(rows,priority,date,source='pedido'){
    const next=[],missing=[]
    rows.forEach(row=>{
      const {product,model}=modelForFigure(row.figure)
      const checked=usableModelComponents(model),components=checked.components
      if(!components.length){missing.push(`${row.figure}${checked.reason?` (${checked.reason})`:''}`);return}
      const totalPerUnit=components.reduce((a,c)=>a+num(c.qtyPerUnit,1),0)||1;components.forEach((c,i)=>{const width=num(c.sourceWidthCm||c.widthCm),height=num(c.sourceHeightCm||c.heightCm);next.push({id:uid(),svgId:c.id,productId:product?.id,figure:row.figure,name:`${row.figure} · ${c.role||'pieza'}`,width,height,sourceWidth:width,sourceHeight:height,sizeLocked:true,qty:num(row.qty)*num(c.qtyPerUnit||1),unitWeight:1/totalPerUnit,svgText:c.svgText,svgMeta:parseSvg(c.svgText),allowRotate:c.allowRotate!==false,blockInterior:c.blockInterior!==false,color:COLORS[i%COLORS.length],priority,dueDate:date||'',source})})
    })
    return {items:next,missing}
  }
  async function generateAutomatic(){
    setBusy(true);setError('');setActive(0);setAutoSummary(null)
    try{
      const groups=pendingGroupsByDelivery(db),automatic=[],missing=[]
      groups.forEach((g,index)=>{const built=componentsForRows(g.rows,index,g.date,'pedido');automatic.push(...built.items);missing.push(...built.missing)})
      if(!automatic.length)throw new Error('No hay piezas pendientes con SVG vinculados para planificar.')
      let working=automatic,packed=await pack(working,num(sheetW),num(sheetH),num(gap)),fillers=[]
      const threshold=Math.max(1,Math.min(100,num(minFill,85)))
      if(useFillers&&missing.length===0&&packed.rejected.length===0&&packed.sheets.length){
        const ranking=bestSellerNames(db),last=()=>packed.sheets[packed.sheets.length-1]
        let attempts=0
        while(last()&&last().efficiency<threshold&&attempts<40){
          attempts++
          const name=ranking[(attempts-1)%Math.max(1,ranking.length)]
          const built=componentsForRows([{figure:name,qty:1}],9999,'','relleno')
          if(!built.items.length)continue
          const trialItems=[...working,...built.items],trial=await pack(trialItems,num(sheetW),num(sheetH),num(gap))
          if(trial.rejected.length||trial.sheets.length>packed.sheets.length)continue
          const oldEff=last()?.efficiency||0,newEff=trial.sheets[trial.sheets.length-1]?.efficiency||0
          if(newEff>oldEff+.05){working=trialItems;packed=trial;fillers.push(name)}
          else if(attempts>ranking.length*2)break
        }
      }
      const complete=[],waiting=[]
      packed.sheets.forEach((s,i)=>{const isComplete=i<packed.sheets.length-1||s.efficiency>=threshold;(isComplete?complete:waiting).push(s)})
      const finalResult={...packed,sheets:complete,waitingSheets:waiting,allSheets:packed.sheets,stale:false,automatic:true,threshold,fillers}
      setItems(working);setResult(finalResult);setAutoSummary({groups,missing:[...new Set(missing)],fillers,complete:complete.length,waiting:waiting.length,threshold})
      if(missing.length)alert(`No se incluyeron por falta de SVG: ${[...new Set(missing)].join(', ')}`)
    }catch(e){setError(e.message||'No se pudo generar la cola automática')}finally{setBusy(false)}
  }
  function addModelByName(){
    const wanted=String(modelSearch||'').trim().toLowerCase()
    const model=libraryModels.find(m=>m.name.toLowerCase()===wanted)||libraryModels.find(m=>m.name.toLowerCase().includes(wanted))
    if(!model)return alert('No encontré esa figura en la Biblioteca SVG.')
    const qty=Math.max(1,Math.floor(num(modelQty,1))),checked=usableModelComponents(model),components=checked.components.filter(c=>['tapa','base','simple','capa'].includes(c.role||'simple'))
    if(!components.length)return alert(checked.reason||'La figura no tiene componentes SVG.')
    const totalPerUnit=components.reduce((a,c)=>a+num(c.qtyPerUnit,1),0)||1
    const additions=components.map((c,i)=>{const width=num(c.sourceWidthCm||c.widthCm),height=num(c.sourceHeightCm||c.heightCm);return {id:uid(),svgId:c.id,modelId:model.id,productId:c.productId||model.productId,figure:model.name,name:`${model.name} · ${c.role||'pieza'}`,width,height,sourceWidth:width,sourceHeight:height,sizeLocked:true,qty:qty*num(c.qtyPerUnit||1),unitWeight:1/totalPerUnit,svgText:c.svgText,svgMeta:parseSvg(c.svgText),allowRotate:c.allowRotate!==false,blockInterior:c.blockInterior!==false,color:COLORS[(items.length+i)%COLORS.length]}})
    const invalid=additions.filter(x=>!x.width||!x.height)
    if(invalid.length)return alert('Algún componente no declara medidas físicas válidas en el SVG.')
    setItems(v=>[...v,...additions]);setModelSearch(model.name)
  }
  const update=(id,k,val)=>setItems(v=>v.map(x=>x.id===id?{...x,[k]:val}:x))
  async function generate(){setBusy(true);setError('');setActive(0);try{const invalid=items.filter(x=>!num(x.sourceWidth||x.width)||!num(x.sourceHeight||x.height)||!sameSize(x.width,x.sourceWidth||x.width)||!sameSize(x.height,x.sourceHeight||x.height));if(invalid.length)throw new Error(`Medida alterada o faltante en: ${invalid.map(x=>x.name).join(', ')}. El motor solo acepta la medida exacta del SVG.`);setResult({...await pack(items,num(sheetW),num(sheetH),num(gap)),stale:false})}catch(e){setError(e.message||'No se pudo generar')}finally{setBusy(false)}}
  function markup(p){const m=p.svgMeta;if(!m)return '';if(p.rotated)return `<g transform="translate(${p.x+p.w} ${p.y}) rotate(90)"><svg width="${p.h}" height="${p.w}" viewBox="${esc(m.viewBox)}" preserveAspectRatio="xMinYMin meet">${m.inner}</svg></g>`;return `<svg x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" viewBox="${esc(m.viewBox)}" preserveAspectRatio="xMinYMin meet">${m.inner}</svg>`}
  function download(){if(!sheet)return;const altered=sheet.placed.filter(p=>!sameSize(p.w,p.rotated?p.sourceHeight||p.height:p.sourceWidth||p.width)||!sameSize(p.h,p.rotated?p.sourceWidth||p.width:p.sourceHeight||p.height));if(altered.length)return alert('No se puede exportar: se detectó una pieza con escala diferente al SVG original.');const metadata=esc(JSON.stringify({empresa:'Tu Vida en Tinta',regla:'medidas exactas del SVG',scaleX:1,scaleY:1,piezas:sheet.placed.map(p=>({nombre:p.name,svgId:p.svgId,anchoOrigen:p.sourceWidth||p.width,altoOrigen:p.sourceHeight||p.height,rotada:p.rotated}))}));const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}cm" height="${sheetH}cm" viewBox="0 0 ${sheetW} ${sheetH}"><metadata>${metadata}</metadata>${sheet.placed.map(markup).join('')}</svg>`;const u=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),a=document.createElement('a');a.href=u;a.download=`placa-cnc-${sheet.number}.svg`;a.click();URL.revokeObjectURL(u)}
  async function savePlan(){if(!result.sheets.length)return;const plan={id:uid(),date:new Date().toISOString(),status:result.automatic?'Lista automática':'Diseñada',automatic:!!result.automatic,priorityRule:'fecha de salida ascendente',fillThreshold:result.threshold||null,fillers:result.fillers||[],sheetW:num(sheetW),sheetH:num(sheetH),gap:num(gap),sheets:result.sheets.map(s=>({number:s.number,multiplier:num(sheetMultipliers[s.number],1),efficiency:s.efficiency,pieces:s.placed.map(p=>({name:p.name,figure:p.figure,unitWeight:num(p.unitWeight,1),itemId:p.itemId||p.id,svgId:p.svgId,x:p.x,y:p.y,w:p.w,h:p.h,sourceWidth:p.sourceWidth||p.width,sourceHeight:p.sourceHeight||p.height,scaleX:1,scaleY:1,rotated:p.rotated}))}))};await onSave({...db,generatedSheets:[...(db.generatedSheets||[]),plan]});alert('Diseño guardado. No se descontaron piezas todavía.')}
  function setMultiplier(number,value){setSheetMultipliers(v=>({...v,[number]:Math.max(1,Math.min(2,Number(value)||1))}))}
  async function sendSheetToCut(){
    if(!sheet)return
    const multiplier=num(sheetMultipliers[sheet.number],1),rows=sheetProductionRows(sheet,multiplier)
    const incomplete=rows.filter(r=>Math.abs(r.qty-Math.round(r.qty))>.001)
    if(incomplete.length)return alert(`Esta placa tiene juegos incompletos de: ${incomplete.map(r=>r.figure).join(', ')}. Agrupá los componentes antes de enviarla a corte.`)
    const items=rows.filter(r=>r.qty>0).map(r=>({figure:r.figure,qty:Math.round(r.baseQty)}))
    if(!items.length)return alert('No se pudieron identificar productos completos en esta placa.')
    const mode=multiplier===2?'doble':'simple'
    if(!confirm(`¿Enviar la placa ${sheet.number} a corte ${mode}? Se reservarán ${items.reduce((a,i)=>a+i.qty*multiplier,0)} unidades.`))return
    const nextNumber=String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0')
    const batch={id:uid(),number:nextNumber,name:`Diseño automático · Placa ${sheet.number}`,date:new Date().toISOString().slice(0,10),notes:`Generada desde Diseñar placas · corte ${mode}`,status:'En corte',multiplier,sourceSheetNumber:sheet.number,items,createdAt:new Date().toISOString()}
    await onSave({...db,cutBatches:[...(db.cutBatches||[]),batch]})
    alert(`Placa enviada a corte ${mode}. Las cantidades quedaron reservadas y se sumarán al stock al terminar.`)
  }

  return <div className="sheet-planner-page">
    <div className="page-title"><div><h1>Diseñar placas de corte</h1><p>Lee los SVG del catálogo y genera placas sin superposición ni piezas dentro de huecos cerrados.</p></div><div className="title-actions"><button className="ghost" onClick={loadPending}>Cargar manualmente</button><button className="ghost" onClick={generateAutomatic} disabled={busy}>{busy?'Calculando…':'Generar cola automática'}</button><button className="primary" onClick={generate} disabled={busy}>{busy?'Calculando…':'Generar selección'}</button></div></div>
    <div className="notice"><b>Escala bloqueada</b><span>Las medidas salen del SVG original. El catálogo solo sirve para reconocer el modelo. Se permite trasladar y rotar; no se permite escalar, deformar ni reflejar.</span></div><div className="notice"><b>Cola automática de producción</b><span>Coloca primero las entregas más cercanas y completa cada placa con las figuras pendientes de las fechas siguientes. Solo usa modelos de alta venta cuando ya no queda ninguna pieza pendiente identificada.</span></div>
    <section className="panel planner-settings"><label>Ancho (cm)<input type="number" step=".1" value={sheetW} onChange={e=>setSheetW(e.target.value)}/></label><label>Alto (cm)<input type="number" step=".1" value={sheetH} onChange={e=>setSheetH(e.target.value)}/></label><label>Separación (cm)<input type="number" step=".1" value={gap} onChange={e=>setGap(e.target.value)}/></label><label>Placa completa desde (%)<input type="number" min="50" max="100" value={minFill} onChange={e=>setMinFill(e.target.value)}/></label><label className="form-check"><input className="form-check-input" type="checkbox" checked={useFillers} onChange={e=>setUseFillers(e.target.checked)}/><span className="form-check-label">Completar con modelos de alta venta</span></label></section>
    <section className="panel model-picker"><div><label>Buscar figura por nombre<input list="svg-model-options" value={modelSearch} onChange={e=>setModelSearch(e.target.value)} placeholder="Ej.: Minnie Mouse"/></label><datalist id="svg-model-options">{libraryModels.map(m=><option key={m.id} value={m.name}/>)}</datalist></div><label>Cantidad de figuras<input type="number" min="1" value={modelQty} onChange={e=>setModelQty(e.target.value)}/></label><button className="primary" onClick={addModelByName}>Agregar figura completa</button><span>Al agregar una figura se cargan automáticamente su tapa y su base, o su SVG simple.</span></section>
    {autoSummary&&<div className="notice"><b>Plan automático</b><span>{autoSummary.complete} placa(s) completas · {autoSummary.waiting} en espera · prioridad por {autoSummary.groups.length} fecha(s){autoSummary.fillers.length?` · ${autoSummary.fillers.length} rellenos de alta venta`:``}. Mínimo: {autoSummary.threshold}%.</span></div>}
    {error&&<div className="notice">{error}</div>}
    <div className="planner-layout"><section className="panel planner-items"><div className="panel-heading"><h3>Piezas físicas ({items.reduce((a,x)=>a+num(x.qty),0)})</h3><button className="ghost" onClick={()=>setItems([])}>Limpiar</button></div>
      <div className="planner-item-head svg-head"><span>Componente</span><span>Ancho</span><span>Alto</span><span>Cant.</span><span></span></div>
      {items.map(it=><div className="planner-item svg-item" key={it.id}><div className="svg-upload-cell"><b>{it.name}</b><small>{it.blockInterior!==false?'Interior bloqueado':'Interior utilizable'}</small></div><input type="number" step=".001" value={it.width} readOnly title="Ancho exacto leído del SVG"/><input type="number" step=".001" value={it.height} readOnly title="Alto exacto leído del SVG"/><input type="number" min="0" value={it.qty} onChange={e=>update(it.id,'qty',e.target.value)}/><button className="danger small" onClick={()=>setItems(v=>v.filter(x=>x.id!==it.id))}>×</button></div>)}
      {!items.length&&<div className="empty-message">Buscá una figura por nombre y elegí la cantidad. La app agregará automáticamente su tapa y su base.</div>}
    </section><section className="planner-preview"><div className="planner-kpis"><div className="metric-card"><small>Placas</small><b className="viz-stat-value">{result.sheets.length}</b></div><div className="metric-card"><small>Piezas</small><b className="viz-stat-value">{result.total}</b></div><div className="metric-card"><small>Aprovechamiento</small><b className="viz-stat-value">{result.sheets.length?Math.round(100*result.used/(result.sheetArea*result.sheets.length)):0}%</b></div></div>
      {result.rejected.length>0&&<div className="notice">{result.rejected.length} pieza(s) no entraron.</div>}{result.waitingSheets?.length>0&&<div className="notice"><b>{result.waitingSheets.length} placa(s) en espera</b><span>No se guardan como listas para cortar hasta alcanzar {result.threshold}% o recibir más piezas pendientes.</span></div>}
      <div className="panel preview-panel"><div className="panel-heading"><h3>Vista previa</h3><div><button className="ghost" disabled={!sheet} onClick={savePlan}>Guardar diseño</button> <button className="ghost" disabled={!sheet} onClick={sendSheetToCut}>Enviar a corte</button> <button className="primary" disabled={!sheet} onClick={download}>Descargar SVG</button></div></div>{result.sheets.length>1&&<div className="sheet-tabs">{result.sheets.map((s,i)=><button key={i} className={active===i?'active':''} onClick={()=>setActive(i)}>Placa {i+1}</button>)}</div>}{!sheet?<div className="empty-message">Generá las placas para ver el resultado.</div>:<><div className="sheet-info"><div><b>Placa {sheet.number}</b><span>{sheet.placed.length} piezas en el diseño · {sheet.efficiency.toFixed(1)}% aproximado</span><small className="block">Producción real: {sheetProductionRows(sheet,sheetMultipliers[sheet.number]||1).reduce((a,r)=>a+r.qty,0)} figura(s). Esta cantidad se reserva en “Para cortar” y se suma al inventario al terminar.</small></div><label className="sheet-cut-mode"><b>Tipo de corte</b><select value={sheetMultipliers[sheet.number]||1} onChange={e=>setMultiplier(sheet.number,e.target.value)}><option value="1">Simple · cortar 1 placa</option><option value="2">Doble · cortar 2 placas iguales</option></select><small>{(sheetMultipliers[sheet.number]||1)===2?'Las cantidades se multiplican por 2.':'Las cantidades se registran una sola vez.'}</small></label></div><div className="sheet-canvas-wrap"><div className="sheet-canvas" style={{width:num(sheetW)*scale,height:num(sheetH)*scale}}>{sheet.placed.map(p=><div key={p.instanceId} className="placed-piece silhouette" title={p.name} style={{left:p.x*scale,top:p.y*scale,width:p.w*scale,height:p.h*scale}}><img src={svgDataUrl(p.svgText)} alt={p.name} style={{width:'100%',height:'100%',objectFit:'contain',transform:p.rotated?'rotate(90deg)':'none'}}/></div>)}</div></div></>}</div>
    </section></div>
  </div>
}
