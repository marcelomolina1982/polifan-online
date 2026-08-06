import React, { useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'

const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)
const cleanName=name=>String(name||'pieza').replace(/\.svg$/i,'')
const UNIT_TO_CM={mm:.1,cm:1,in:2.54,pt:2.54/72,pc:2.54/6,px:2.54/96}
function lengthCm(value){const m=String(value||'').trim().match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/i);if(!m)return 0;return Number(m[1])*(UNIT_TO_CM[(m[2]||'px').toLowerCase()]||0)}
function modelSlug(value){return String(value||'modelo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'modelo'}
function roleLabel(role){return role==='tapa'?'Tapa':role==='base'?'Base':role==='capa'?'Capa adicional':'Figura simple'}
function parseSvg(text){
  const doc=new DOMParser().parseFromString(text,'image/svg+xml'),svg=doc.documentElement
  if(!svg||svg.nodeName.toLowerCase()!=='svg'||doc.querySelector('parsererror'))throw new Error('SVG inválido')
  svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n=>n.remove())
  svg.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{const n=a.name.toLowerCase(),v=a.value.trim().toLowerCase();if(n.startsWith('on')||(['href','xlink:href'].includes(n)&&(v.startsWith('http')||v.startsWith('javascript:'))))el.removeAttribute(a.name)}))
  let vb=svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);const rawWidth=svg.getAttribute('width')||'',rawHeight=svg.getAttribute('height')||'',attr=n=>parseFloat(svg.getAttribute(n))||0
  if(!vb||vb.length!==4||!vb.every(Number.isFinite))vb=[0,0,attr('width')||100,attr('height')||100]
  const widthCm=lengthCm(rawWidth),heightCm=lengthCm(rawHeight),physicalSizeDeclared=widthCm>0&&heightCm>0
  const paths=svg.querySelectorAll('path,polygon,polyline,circle,ellipse,rect').length,closed=[...svg.querySelectorAll('path')].filter(x=>/[zZ]\s*$/.test(x.getAttribute('d')||'')).length
  return {text:new XMLSerializer().serializeToString(svg),viewBox:vb.join(' '),vbW:vb[2],vbH:vb[3],paths,closed,rawWidth,rawHeight,widthCm:physicalSizeDeclared?widthCm:0,heightCm:physicalSizeDeclared?heightCm:0,physicalSizeDeclared}
}
function dataUrl(text){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`}
function componentModelId(item){return item.modelId||(item.productId?`producto:${item.productId}`:`modelo:${modelSlug(item.modelName||item.productName||String(item.name||'').replace(/\s*[·-]\s*(tapa|base|figura|capa.*)$/i,''))}`)}

export default function SvgLibrary({db,onSave}){
  const library=db.svgLibrary||[],products=normalizeCatalogProducts(db.customerCatalog?.length?db.customerCatalog:catalogProducts)
  const [search,setSearch]=useState(''),[busy,setBusy]=useState(false)
  const models=useMemo(()=>{
    const map=new Map()
    library.forEach(item=>{const id=componentModelId(item),modelName=item.modelName||item.productName||String(item.name||'Modelo').replace(/\s*[·-]\s*(tapa|base|figura|capa.*)$/i,'');if(!map.has(id))map.set(id,{id,modelName,productId:item.productId||'',productName:item.productName||modelName,components:[]});map.get(id).components.push(item)})
    return [...map.values()].map(m=>({...m,components:m.components.sort((a,b)=>({tapa:0,base:1,simple:2,capa:3}[a.role]??9)-({tapa:0,base:1,simple:2,capa:3}[b.role]??9))})).filter(m=>`${m.modelName} ${m.productName} ${m.components.map(c=>c.role).join(' ')}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>a.modelName.localeCompare(b.modelName,'es'))
  },[library,search])

  async function importFiles(files){
    const list=[...files||[]].filter(f=>/\.svg$/i.test(f.name)||f.type==='image/svg+xml');if(!list.length)return alert('Elegí uno o varios archivos SVG.')
    setBusy(true)
    try{const next=[...library];for(const file of list){try{const parsed=parseSvg(await file.text()),modelName=cleanName(file.name).replace(/\s*[·_-]\s*(tapa|base)$/i,'').trim(),role=/base/i.test(file.name)?'base':/tapa/i.test(file.name)?'tapa':'simple',modelId=`modelo:${modelSlug(modelName)}`;next.push({id:uid(),modelId,modelName,name:`${modelName} · ${roleLabel(role)}`,role,productId:'',productName:modelName,qtyPerUnit:1,widthCm:parsed.widthCm||'',heightCm:parsed.heightCm||'',sourceWidthCm:parsed.widthCm||0,sourceHeightCm:parsed.heightCm||0,sizeSource:'svg',sizeLocked:parsed.physicalSizeDeclared,allowRotate:true,blockInterior:true,svgText:parsed.text,svgMeta:parsed,createdAt:new Date().toISOString()})}catch(e){console.warn(file.name,e)}}await onSave({...db,svgLibrary:next})}finally{setBusy(false)}
  }
  async function updateComponent(id,field,value){await onSave({...db,svgLibrary:library.map(x=>x.id===id?{...x,[field]:value}:x)})}
  async function renameModel(model,newName){const name=String(newName||'').trim();if(!name)return;const newId=model.productId?`producto:${model.productId}`:`modelo:${modelSlug(name)}`;await onSave({...db,svgLibrary:library.map(x=>componentModelId(x)===model.id?{...x,modelId:newId,modelName:name,productName:x.productId?x.productName:name,name:`${name} · ${roleLabel(x.role)}`}:x)})}
  async function linkProduct(model,productId){const product=products.find(p=>p.id===productId),newId=productId?`producto:${productId}`:`modelo:${modelSlug(model.modelName)}`;await onSave({...db,svgLibrary:library.map(x=>componentModelId(x)===model.id?{...x,modelId:newId,modelName:product?.name||model.modelName,productId,productName:product?.name||model.modelName,name:`${product?.name||model.modelName} · ${roleLabel(x.role)}`}:x)})}
  async function removeComponent(id){if(confirm('¿Eliminar este componente SVG?'))await onSave({...db,svgLibrary:library.filter(x=>x.id!==id)})}
  async function removeModel(model){if(confirm(`¿Eliminar la figura ${model.modelName} con todos sus componentes?`))await onSave({...db,svgLibrary:library.filter(x=>componentModelId(x)!==model.id)})}

  return <>
    <Title title="Biblioteca SVG" sub="Cada tarjeta representa una figura y muestra juntos su tapa, base o pieza simple." actions={<label className="primary filebtn">{busy?'Analizando…':'Importar SVG individuales'}<input type="file" accept=".svg,image/svg+xml" multiple disabled={busy} onChange={e=>importFiles(e.target.files)}/></label>}/>
    <div className="notice"><b>Una figura, sus componentes</b><span>La tapa y la base deben tener el mismo nombre de figura. Las medidas se conservan desde cada SVG y nunca se toman del catálogo.</span></div>
    <div className="panel"><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar figura por nombre..."/></div>
    <div className="svg-model-grid">
      {models.map(model=><article className="panel svg-model-card" key={model.id}>
        <div className="panel-heading"><div><h3>{model.modelName}</h3><small>{model.components.length} componente(s)</small></div><button className="danger smallbtn" onClick={()=>removeModel(model)}>Eliminar figura</button></div>
        <div className="svg-model-fields"><label>Nombre de la figura<input defaultValue={model.modelName} onBlur={e=>renameModel(model,e.target.value)}/></label><label>Producto del catálogo<select value={model.productId||''} onChange={e=>linkProduct(model,e.target.value)}><option value="">Sin vincular</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
        <div className="svg-components-grid">{model.components.map(item=><section className="svg-component" key={item.id}>
          <div className="svg-library-preview"><img src={dataUrl(item.svgText)} alt={`${model.modelName} ${item.role}`}/></div>
          <b>{roleLabel(item.role)}</b>
          <span>{Number(item.sourceWidthCm||item.widthCm||0).toFixed(3)} × {Number(item.sourceHeightCm||item.heightCm||0).toFixed(3)} cm</span>
          <label>Tipo<select value={item.role||'simple'} onChange={e=>updateComponent(item.id,'role',e.target.value)}><option value="simple">Figura simple</option><option value="tapa">Tapa</option><option value="base">Base</option><option value="capa">Capa adicional</option></select></label>
          <div className="svg-card-checks"><label className="form-check"><input className="form-check-input" type="checkbox" checked={item.allowRotate!==false} onChange={e=>updateComponent(item.id,'allowRotate',e.target.checked)}/><span className="form-check-label">Rotar</span></label><label className="form-check"><input className="form-check-input" type="checkbox" checked={item.blockInterior!==false} onChange={e=>updateComponent(item.id,'blockInterior',e.target.checked)}/><span className="form-check-label">Bloquear interior</span></label></div>
          <button className="danger smallbtn" onClick={()=>removeComponent(item.id)}>Eliminar componente</button>
        </section>)}</div>
        {!model.components.some(x=>x.role==='simple')&&<div className="component-status"><span className={model.components.some(x=>x.role==='tapa')?'ok':'missing'}>{model.components.some(x=>x.role==='tapa')?'✓ Tapa':'Falta tapa'}</span><span className={model.components.some(x=>x.role==='base')?'ok':'missing'}>{model.components.some(x=>x.role==='base')?'✓ Base':'Falta base'}</span></div>}
      </article>)}
      {!models.length&&<div className="panel">Todavía no hay figuras SVG guardadas.</div>}
    </div>
  </>
}
