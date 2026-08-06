import React, { useMemo, useRef, useState } from 'react'
import { Title } from '../components/UI'
import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'

const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)
const UNIT_TO_CM={mm:.1,cm:1,in:2.54,pt:2.54/72,pc:2.54/6,px:2.54/96}
const GEOMETRY_SELECTOR='path,polygon,polyline,circle,ellipse,rect,line'

function lengthCm(value){
  const m=String(value||'').trim().match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/i)
  if(!m)return 0
  return Number(m[1])*(UNIT_TO_CM[(m[2]||'px').toLowerCase()]||0)
}
function cleanName(name){return String(name||'placa').replace(/\.svg$/i,'')}
function modelSlug(value){return String(value||'modelo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'modelo'}
function matrixText(m){return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`}
function dataUrl(text){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`}
function round(n,d=4){const p=10**d;return Math.round(Number(n||0)*p)/p}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}

function sanitizeSvg(text){
  const doc=new DOMParser().parseFromString(text,'image/svg+xml')
  const svg=doc.documentElement
  if(!svg||svg.nodeName.toLowerCase()!=='svg'||doc.querySelector('parsererror'))throw new Error('SVG inválido')
  svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n=>n.remove())
  svg.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{
    const n=a.name.toLowerCase(),v=a.value.trim().toLowerCase()
    if(n.startsWith('on')||(['href','xlink:href'].includes(n)&&(v.startsWith('http')||v.startsWith('javascript:'))))el.removeAttribute(a.name)
  }))
  let vb=(svg.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number)
  const attr=n=>parseFloat(svg.getAttribute(n))||0
  if(vb.length!==4||!vb.every(Number.isFinite))vb=[0,0,attr('width')||100,attr('height')||100]
  const widthCm=lengthCm(svg.getAttribute('width'))
  const heightCm=lengthCm(svg.getAttribute('height'))
  if(!(widthCm>0&&heightCm>0))throw new Error('El SVG debe declarar width y height con mm o cm para conservar medidas exactas.')
  return {doc,svg,vb,widthCm,heightCm,scaleX:widthCm/vb[2],scaleY:heightCm/vb[3]}
}

function elementSamples(el,matrix,count=48){
  const points=[]
  try{
    if(typeof el.getTotalLength==='function'){
      const total=el.getTotalLength()
      if(total>0){
        for(let i=0;i<count;i++){
          const p=el.getPointAtLength((i/(count-1))*total)
          const q=new DOMPoint(p.x,p.y).matrixTransform(matrix)
          points.push({x:q.x,y:q.y})
        }
      }
    }
  }catch{}
  if(points.length<4){
    const b=el.getBBox()
    ;[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].forEach(([x,y])=>{
      const q=new DOMPoint(x,y).matrixTransform(matrix);points.push({x:q.x,y:q.y})
    })
  }
  return points
}

function fingerprint(points,bbox,pathLength){
  const cx=points.reduce((s,p)=>s+p.x,0)/points.length
  const cy=points.reduce((s,p)=>s+p.y,0)/points.length
  const radii=points.map(p=>Math.hypot(p.x-cx,p.y-cy))
  const maxR=Math.max(...radii,1e-6)
  const radial=radii.map(x=>round(x/maxR,2)).sort((a,b)=>a-b)
  const steps=[]
  for(let i=1;i<points.length;i++)steps.push(distance(points[i-1],points[i])/maxR)
  steps.sort((a,b)=>a-b)
  const short=Math.min(bbox.width,bbox.height),long=Math.max(bbox.width,bbox.height)
  return {
    radial,
    steps:steps.map(x=>round(x,2)),
    aspect:round(long/Math.max(short,1e-6),3),
    lengthRatio:round(pathLength/Math.max(Math.sqrt(bbox.width*bbox.height),1e-6),3)
  }
}

function vectorDistance(a,b){
  if(!a||!b)return Infinity
  const sample=(arr,n=20)=>Array.from({length:n},(_,i)=>arr[Math.min(arr.length-1,Math.round(i*(arr.length-1)/(n-1)))]||0)
  const ar=sample(a.radial),br=sample(b.radial),as=sample(a.steps),bs=sample(b.steps)
  let sum=0
  ar.forEach((v,i)=>sum+=(v-br[i])**2)
  as.forEach((v,i)=>sum+=(v-bs[i])**2)
  sum+=(a.aspect-b.aspect)**2*.8+(a.lengthRatio-b.lengthRatio)**2*.12
  return Math.sqrt(sum/(ar.length+as.length+2))
}

function isolatedSvg(sourceSvg,el,matrix,bbox,widthCm,heightCm){
  const clone=el.cloneNode(true)
  clone.removeAttribute('transform')
  clone.removeAttribute('id')
  const wrapper=document.createElementNS('http://www.w3.org/2000/svg','svg')
  wrapper.setAttribute('xmlns','http://www.w3.org/2000/svg')
  wrapper.setAttribute('width',`${widthCm}cm`)
  wrapper.setAttribute('height',`${heightCm}cm`)
  wrapper.setAttribute('viewBox',`${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`)
  const defs=sourceSvg.querySelector('defs')
  if(defs)wrapper.appendChild(defs.cloneNode(true))
  const g=document.createElementNS('http://www.w3.org/2000/svg','g')
  g.setAttribute('transform',matrixText(matrix))
  g.appendChild(clone)
  wrapper.appendChild(g)
  return new XMLSerializer().serializeToString(wrapper)
}

async function analyzeFile(file,host){
  const parsed=sanitizeSvg(await file.text())
  const mounted=parsed.svg.cloneNode(true)
  mounted.style.position='absolute';mounted.style.left='-100000px';mounted.style.top='0';mounted.style.visibility='hidden'
  mounted.setAttribute('width',String(parsed.vb[2]));mounted.setAttribute('height',String(parsed.vb[3]))
  host.appendChild(mounted)
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
  const items=[]
  const elements=[...mounted.querySelectorAll(GEOMETRY_SELECTOR)].filter(el=>!el.closest('defs,clipPath,mask,pattern,marker'))
  for(let index=0;index<elements.length;index++){
    const el=elements[index]
    try{
      const matrix=el.getCTM()
      const local=el.getBBox()
      if(!matrix||local.width<=0||local.height<=0)continue
      const corners=[[local.x,local.y],[local.x+local.width,local.y],[local.x+local.width,local.y+local.height],[local.x,local.y+local.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix))
      const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y)
      const bbox={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}
      const widthCm=bbox.width*parsed.scaleX,heightCm=bbox.height*parsed.scaleY
      let pathLength=0
      try{pathLength=typeof el.getTotalLength==='function'?el.getTotalLength():2*(local.width+local.height)}catch{pathLength=2*(local.width+local.height)}
      const samples=elementSamples(el,matrix)
      const fp=fingerprint(samples,bbox,pathLength)
      const svgText=isolatedSvg(mounted,el,matrix,bbox,widthCm,heightCm)
      items.push({
        id:uid(),sourceFile:file.name,sourceIndex:index+1,tag:el.tagName.toLowerCase(),
        widthCm:round(widthCm,4),heightCm:round(heightCm,4),bbox,svgText,fingerprint:fp,
        role:'simple',name:'',productId:'',productName:'',selected:true
      })
    }catch(err){console.warn('No se pudo analizar una pieza',file.name,index,err)}
  }
  mounted.remove()
  return items
}

function groupPieces(items,existing){
  const groups=[]
  for(const item of items){
    let best=null
    for(const group of groups){
      const d=vectorDistance(item.fingerprint,group.representative.fingerprint)
      const dimsA=[item.widthCm,item.heightCm].sort((a,b)=>a-b),dimsB=[group.representative.widthCm,group.representative.heightCm].sort((a,b)=>a-b)
      const sizeDiff=Math.max(Math.abs(dimsA[0]-dimsB[0])/Math.max(dimsB[0],.001),Math.abs(dimsA[1]-dimsB[1])/Math.max(dimsB[1],.001))
      const score=d+sizeDiff*.7
      if(score<.18&&(!best||score<best.score))best={group,score}
    }
    if(best){best.group.items.push(item);best.group.confidence=Math.min(best.group.confidence,Math.max(0,1-best.score*3))}
    else groups.push({id:uid(),representative:item,items:[item],confidence:1,name:`Modelo ${groups.length+1}`,role:'simple',productId:'',productName:'',selected:true})
  }
  for(const group of groups){
    let match=null
    for(const lib of existing||[]){
      if(!lib.analysisFingerprint)continue
      const d=vectorDistance(group.representative.fingerprint,lib.analysisFingerprint)
      if(d<.16&&(!match||d<match.distance))match={lib,distance:d}
    }
    if(match){
      group.name=match.lib.name||group.name;group.role=match.lib.role||'simple';group.productId=match.lib.productId||'';group.productName=match.lib.productName||'';group.matchConfidence=Math.round((1-match.distance*3)*100)
    }
  }
  return groups.sort((a,b)=>b.items.length-a.items.length)
}

export default function SvgAnalyzer({db,onSave}){
  const hostRef=useRef(null)
  const products=normalizeCatalogProducts(db.customerCatalog?.length?db.customerCatalog:catalogProducts)
  const library=db.svgLibrary||[]
  const [groups,setGroups]=useState([])
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const total=useMemo(()=>groups.reduce((s,g)=>s+g.items.length,0),[groups])

  async function analyze(files){
    const list=[...files||[]].filter(f=>/\.svg$/i.test(f.name)||f.type==='image/svg+xml')
    if(!list.length)return alert('Elegí uno o varios SVG de placas anteriores.')
    setBusy(true);setMessage('Analizando geometría y medidas exactas…')
    try{
      const pieces=[]
      for(const file of list){
        try{pieces.push(...await analyzeFile(file,hostRef.current))}
        catch(e){alert(`${file.name}: ${e.message}`)}
      }
      const next=groupPieces(pieces,library)
      setGroups(next)
      setMessage(`Se detectaron ${pieces.length} piezas y ${next.length} modelos diferentes.`)
    }finally{setBusy(false)}
  }

  function updateGroup(id,field,value){
    setGroups(gs=>gs.map(g=>g.id===id?{...g,[field]:value}:g))
  }
  function linkProduct(id,productId){
    const product=products.find(p=>p.id===productId)
    setGroups(gs=>gs.map(g=>g.id===id?{...g,productId,productName:product?.name||''}:g))
  }

  async function saveSelected(){
    const selected=groups.filter(g=>g.selected)
    if(!selected.length)return alert('Seleccioná al menos un componente.')
    const unnamed=selected.filter(g=>!String(g.name||'').trim())
    if(unnamed.length)return alert('Escribí el nombre de la figura en todos los componentes seleccionados.')
    const now=new Date().toISOString()
    const unique=new Map()
    selected.forEach(g=>{
      const modelName=String(g.name||'').trim()
      const modelId=g.productId?`producto:${g.productId}`:`modelo:${modelSlug(modelName)}`
      const role=g.role||'simple'
      const key=`${modelId}|${role}`
      if(!unique.has(key))unique.set(key,{g,modelId,modelName,role})
    })
    const additions=[...unique.values()].map(({g,modelId,modelName,role})=>{
      const r=g.representative
      return {
        id:uid(),modelId,modelName,name:`${modelName} · ${role==='tapa'?'Tapa':role==='base'?'Base':role==='capa'?'Capa adicional':'Figura'}`,role,
        productId:g.productId||'',productName:g.productName||modelName,qtyPerUnit:1,
        widthCm:r.widthCm,heightCm:r.heightCm,sourceWidthCm:r.widthCm,sourceHeightCm:r.heightCm,
        sizeSource:'svg-instance',sizeLocked:true,allowRotate:true,blockInterior:true,
        svgText:r.svgText,svgMeta:{paths:1,closed:0,physicalSizeDeclared:true,sourceFiles:[...new Set(g.items.map(x=>x.sourceFile))],occurrences:g.items.length},
        analysisFingerprint:r.fingerprint,analysisSources:g.items.map(x=>({file:x.sourceFile,index:x.sourceIndex,widthCm:x.widthCm,heightCm:x.heightCm})),
        createdAt:now
      }
    })
    const replacementKeys=new Set(additions.map(x=>`${x.modelId}|${x.role}`))
    const retained=library.filter(x=>!replacementKeys.has(`${x.modelId||(x.productId?`producto:${x.productId}`:`modelo:${modelSlug(x.modelName||x.productName||x.name)}`)}|${x.role||'simple'}`))
    const history=[...(db.svgAnalysisHistory||[]),{id:uid(),createdAt:now,pieces:total,models:new Set(additions.map(x=>x.modelId)).size,components:additions.length}]
    await onSave({...db,svgLibrary:[...retained,...additions],svgAnalysisHistory:history})
    const models=new Set(additions.map(x=>x.modelId)).size
    alert(`${models} figura(s) guardadas con ${additions.length} componente(s). Se conservó una sola tapa, base o figura de cada modelo.`)
  }

  return <>
    <Title title="Analizar placas SVG" sub="Subí placas anteriores. La app extrae una sola muestra de cada modelo y permite unir su tapa y su base bajo el mismo nombre." actions={<label className="primary filebtn">{busy?'Analizando…':'Subir placas SVG'}<input type="file" accept=".svg,image/svg+xml" multiple disabled={busy} onChange={e=>analyze(e.target.files)}/></label>}/>
    <div ref={hostRef}/>
    <div className="notice"><b>La medida sale del SVG original</b><span>El catálogo se usa únicamente para ponerle nombre al modelo. Las piezas detectadas se guardan con su ancho y alto reales, sin escalar ni deformar.</span></div>
    <div className="notice"><b>Una figura por modelo</b><span>Las repeticiones se agrupan y no se guardan varias veces. Para formar una figura completa, escribí el mismo nombre en su tapa y su base y elegí el tipo correspondiente.</span></div>
    {message&&<div className="panel svg-analysis-summary"><b>{message}</b>{groups.length>0&&<span>{total} piezas · {groups.length} grupos · {groups.filter(g=>g.matchConfidence).length} coincidencias con la biblioteca</span>}</div>}
    {groups.length>0&&<div className="toolbar"><button className="primary" onClick={saveSelected}>Guardar figuras con tapa y base</button><button className="ghost" onClick={()=>setGroups(gs=>gs.map(g=>({...g,selected:true})))}>Seleccionar todos</button><button className="ghost" onClick={()=>setGroups(gs=>gs.map(g=>({...g,selected:false})))}>Quitar selección</button></div>}
    <div className="svg-analysis-grid">
      {groups.map((group,index)=>{
        const r=group.representative
        const variants=[...new Set(group.items.map(x=>`${x.widthCm.toFixed(2)} × ${x.heightCm.toFixed(2)} cm`))]
        return <article className="panel svg-analysis-card" key={group.id}>
          <div className="svg-analysis-head"><label className="form-check"><input className="form-check-input" type="checkbox" checked={group.selected} onChange={e=>updateGroup(group.id,'selected',e.target.checked)}/><span className="form-check-label">Guardar componente</span></label><span className="count-badge">{group.items.length} apariciones</span></div>
          <div className="svg-library-preview"><img src={dataUrl(r.svgText)} alt={group.name}/></div>
          <label>Nombre de la figura<input value={group.name} onChange={e=>updateGroup(group.id,'name',e.target.value)} placeholder={`Modelo ${index+1}`}/></label>
          <div className="svg-library-fields"><label>Tipo<select value={group.role} onChange={e=>updateGroup(group.id,'role',e.target.value)}><option value="simple">Figura simple</option><option value="tapa">Tapa</option><option value="base">Base</option><option value="capa">Capa adicional</option></select></label><label>Ancho detectado<input readOnly value={`${r.widthCm.toFixed(3)} cm`}/></label><label>Alto detectado<input readOnly value={`${r.heightCm.toFixed(3)} cm`}/></label></div>
          <label>Producto del catálogo<select value={group.productId} onChange={e=>linkProduct(group.id,e.target.value)}><option value="">Sin vincular</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {group.matchConfidence&&<div className="match-badge">Coincidencia previa: {group.matchConfidence}%</div>}
          <small>Archivos: {[...new Set(group.items.map(x=>x.sourceFile))].join(', ')}</small>
          <small>Medidas encontradas: {variants.slice(0,4).join(' · ')}{variants.length>4?` · +${variants.length-4} variantes`:''}</small>
        </article>
      })}
      {!busy&&!groups.length&&<div className="panel">Subí uno o varios SVG de placas ya cortadas para comenzar el análisis.</div>}
    </div>
  </>
}
