import React, { useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'

const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)
const cleanName=name=>String(name||'pieza').replace(/\.svg$/i,'')
const UNIT_TO_CM={mm:.1,cm:1,in:2.54,pt:2.54/72,pc:2.54/6,px:2.54/96}
function lengthCm(value){
  const m=String(value||'').trim().match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/i)
  if(!m)return 0
  return Number(m[1])*(UNIT_TO_CM[(m[2]||'px').toLowerCase()]||0)
}

function parseSvg(text){
  const doc=new DOMParser().parseFromString(text,'image/svg+xml')
  const svg=doc.documentElement
  if(!svg||svg.nodeName.toLowerCase()!=='svg'||doc.querySelector('parsererror'))throw new Error('SVG inválido')
  svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n=>n.remove())
  svg.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{
    const n=a.name.toLowerCase(),v=a.value.trim().toLowerCase()
    if(n.startsWith('on')||(['href','xlink:href'].includes(n)&&(v.startsWith('http')||v.startsWith('javascript:'))))el.removeAttribute(a.name)
  }))
  let vb=svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number)
  const rawWidth=svg.getAttribute('width')||'',rawHeight=svg.getAttribute('height')||''
  const attr=n=>parseFloat(svg.getAttribute(n))||0
  if(!vb||vb.length!==4||!vb.every(Number.isFinite))vb=[0,0,attr('width')||100,attr('height')||100]
  let widthCm=lengthCm(rawWidth),heightCm=lengthCm(rawHeight)
  // Cuando el archivo no declara una unidad física, se conserva la relación del viewBox
  // y se marca para revisión; nunca se inventa una medida desde el catálogo.
  const physicalSizeDeclared=widthCm>0&&heightCm>0
  if(!physicalSizeDeclared){widthCm=0;heightCm=0}
  const paths=svg.querySelectorAll('path,polygon,polyline,circle,ellipse,rect').length
  const closed=[...svg.querySelectorAll('path')].filter(x=>/[zZ]\s*$/.test(x.getAttribute('d')||'')).length
  return {text:new XMLSerializer().serializeToString(svg),viewBox:vb.join(' '),vbW:vb[2],vbH:vb[3],paths,closed,rawWidth,rawHeight,widthCm,heightCm,physicalSizeDeclared,aspectRatio:vb[3]?vb[2]/vb[3]:0}
}
function dataUrl(text){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`}

export default function SvgLibrary({db,onSave}){
  const library=db.svgLibrary||[]
  const products=normalizeCatalogProducts(db.customerCatalog?.length?db.customerCatalog:catalogProducts)
  const [search,setSearch]=useState('')
  const [busy,setBusy]=useState(false)
  const filtered=useMemo(()=>library.filter(x=>`${x.name} ${x.role} ${x.productName||''}`.toLowerCase().includes(search.toLowerCase())),[library,search])

  async function importFiles(files){
    const list=[...files||[]].filter(f=>/\.svg$/i.test(f.name)||f.type==='image/svg+xml')
    if(!list.length)return alert('Elegí uno o varios archivos SVG.')
    setBusy(true)
    try{
      const next=[...library]
      for(const file of list){
        try{
          const parsed=parseSvg(await file.text())
          next.push({id:uid(),name:cleanName(file.name),role:'simple',productId:'',productName:'',widthCm:parsed.widthCm||'',heightCm:parsed.heightCm||'',sourceWidthCm:parsed.widthCm||0,sourceHeightCm:parsed.heightCm||0,sizeSource:'svg',sizeLocked:parsed.physicalSizeDeclared,allowRotate:true,blockInterior:true,svgText:parsed.text,svgMeta:parsed,createdAt:new Date().toISOString()})
        }catch(e){console.warn(file.name,e)}
      }
      await onSave({...db,svgLibrary:next})
    }finally{setBusy(false)}
  }
  async function update(id,field,value){await onSave({...db,svgLibrary:library.map(x=>x.id===id?{...x,[field]:value}:x)})}
  async function linkProduct(id,productId){const product=products.find(p=>p.id===productId);await onSave({...db,svgLibrary:library.map(x=>x.id===id?{...x,productId,productName:product?.name||''}:x)})}
  async function remove(id){if(confirm('¿Eliminar esta pieza de la biblioteca?'))await onSave({...db,svgLibrary:library.filter(x=>x.id!==id)})}

  return <>
    <Title title="Biblioteca SVG" sub="Importá los archivos vectoriales, clasificá tapas, bases y figuras simples, y vinculalos al catálogo." actions={<label className="primary filebtn">{busy?'Analizando…':'Importar varios SVG'}<input type="file" accept=".svg,image/svg+xml" multiple disabled={busy} onChange={e=>importFiles(e.target.files)}/></label>}/>
    <div className="notice"><b>Medidas exactas del SVG</b><span>El catálogo solo identifica la figura. El ancho y el alto se leen del archivo SVG y quedan bloqueados: el motor puede mover y rotar, pero no escalar ni deformar.</span></div><div className="notice"><b>Regla de seguridad CNC</b><span>“Bloquear interior” evita que el motor coloque una pieza dentro del hueco cerrado de otra.</span></div>
    <div className="panel"><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar SVG..."/></div>
    <div className="svg-library-grid">
      {filtered.map(item=><article className="panel svg-library-card" key={item.id}>
        <div className="svg-library-preview"><img src={dataUrl(item.svgText)} alt={item.name}/></div>
        <label>Nombre<input value={item.name} onChange={e=>update(item.id,'name',e.target.value)}/></label>
        <div className="svg-library-fields">
          <label>Tipo<select value={item.role||'simple'} onChange={e=>update(item.id,'role',e.target.value)}><option value="simple">Figura simple</option><option value="tapa">Tapa</option><option value="base">Base</option><option value="capa">Capa adicional</option></select></label>
          <label>Ancho exacto (cm)<input type="number" step="0.001" value={item.sourceWidthCm||item.widthCm||''} readOnly title="Medida tomada del SVG original"/></label>
          <label>Alto exacto (cm)<input type="number" step="0.001" value={item.sourceHeightCm||item.heightCm||''} readOnly title="Medida tomada del SVG original"/></label>
        </div>
        <label>Producto del catálogo<select value={item.productId||''} onChange={e=>linkProduct(item.id,e.target.value)}><option value="">Sin vincular</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="svg-card-checks"><label className="form-check"><input className="form-check-input" type="checkbox" checked={item.allowRotate!==false} onChange={e=>update(item.id,'allowRotate',e.target.checked)}/><span className="form-check-label">Permitir rotación</span></label><label className="form-check"><input className="form-check-input" type="checkbox" checked={item.blockInterior!==false} onChange={e=>update(item.id,'blockInterior',e.target.checked)}/><span className="form-check-label">Bloquear interior</span></label></div>
        <small>{item.svgMeta?.paths||0} contornos · {item.svgMeta?.closed||0} paths cerrados · {item.sizeLocked!==false?`medida SVG bloqueada (${Number(item.sourceWidthCm||item.widthCm||0).toFixed(3)} × ${Number(item.sourceHeightCm||item.heightCm||0).toFixed(3)} cm)`:'sin medida física: requiere SVG con mm o cm'}</small>
        <button className="danger smallbtn" onClick={()=>remove(item.id)}>Eliminar SVG</button>
      </article>)}
      {!filtered.length&&<div className="panel">Todavía no hay archivos SVG importados.</div>}
    </div>
  </>
}
