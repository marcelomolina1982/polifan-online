import React, { useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { catalogProducts, catalogCategories } from '../lib/catalog'

const editableCategories = catalogCategories.filter(c => c !== 'Todos')
const emptyForm = { id:'', name:'', measure:'', category:'Carameleras', image:'', fixedPrice:'', active:true }
const slug = text => String(text||'producto').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')

function resizeImage(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader()
    reader.onerror=reject
    reader.onload=()=>{
      const img=new Image()
      img.onerror=reject
      img.onload=()=>{
        const max=700
        const scale=Math.min(1,max/Math.max(img.width,img.height))
        const canvas=document.createElement('canvas')
        canvas.width=Math.max(1,Math.round(img.width*scale)); canvas.height=Math.max(1,Math.round(img.height*scale))
        const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height)
        resolve(canvas.toDataURL('image/jpeg',.78))
      }
      img.src=reader.result
    }
    reader.readAsDataURL(file)
  })
}

export default function CatalogAdmin({db,onSave}){
  const products = db.customerCatalog?.length ? db.customerCatalog : catalogProducts
  const [form,setForm]=useState(emptyForm)
  const [search,setSearch]=useState('')
  const [savingImage,setSavingImage]=useState(false)
  const filtered=useMemo(()=>products.filter(p=>`${p.name} ${p.category} ${p.measure}`.toLowerCase().includes(search.toLowerCase())),[products,search])
  const update=(field,value)=>setForm(v=>({...v,[field]:value}))

  async function chooseImage(e){
    const file=e.target.files?.[0]; if(!file)return
    if(!file.type.startsWith('image/'))return alert('Elegí una imagen JPG, PNG o WEBP.')
    setSavingImage(true)
    try{update('image',await resizeImage(file))}catch{alert('No se pudo procesar la imagen.')}finally{setSavingImage(false)}
  }
  function edit(product){setForm({...product,fixedPrice:product.fixedPrice||''}); window.scrollTo({top:0,behavior:'smooth'})}
  function clear(){setForm(emptyForm)}
  async function save(){
    if(!form.name.trim())return alert('Ingresá el nombre del producto.')
    if(!form.image)return alert('Subí una imagen del producto.')
    const baseId=form.id||`${slug(form.name)}-${Date.now().toString(36)}`
    const product={...form,id:baseId,name:form.name.trim(),measure:form.measure.trim(),fixedPrice:Number(form.fixedPrice)||null,active:form.active!==false}
    const next=form.id?products.map(p=>p.id===form.id?product:p):[...products,product]
    await onSave({...db,customerCatalog:next})
    clear(); alert(form.id?'Producto actualizado.':'Producto agregado al catálogo.')
  }
  async function toggle(product){await onSave({...db,customerCatalog:products.map(p=>p.id===product.id?{...p,active:p.active===false}:p)})}
  async function remove(product){if(!confirm(`¿Eliminar “${product.name}” del catálogo de clientes?`))return; await onSave({...db,customerCatalog:products.filter(p=>p.id!==product.id)})}
  async function restore(){if(!confirm('¿Restaurar el catálogo original? Se eliminarán los productos nuevos y cambios realizados.'))return; await onSave({...db,customerCatalog:catalogProducts}); clear()}

  return <>
    <Title title="Administrar catálogo" sub="Agregá diseños e imágenes sin modificar GitHub."/>
    <div className="panel catalog-editor">
      <h3>{form.id?'Editar producto':'Agregar nuevo producto'}</h3>
      <div className="catalog-form-grid">
        <div className="catalog-image-picker">
          {form.image?<img src={form.image} alt="Vista previa"/>:<div className="catalog-image-placeholder">Sin imagen</div>}
          <label className="primary filebtn">{savingImage?'Procesando…':'Elegir imagen'}<input type="file" accept="image/*" onChange={chooseImage} disabled={savingImage}/></label>
          <small>La imagen se comprime automáticamente para que el catálogo cargue rápido.</small>
        </div>
        <div className="customer-grid">
          <label>Nombre<input value={form.name} onChange={e=>update('name',e.target.value)} placeholder="Ej.: Pikachu"/></label>
          <label>Medida<input value={form.measure} onChange={e=>update('measure',e.target.value)} placeholder="Ej.: 20 x 16 cm"/></label>
          <label>Categoría<select value={form.category} onChange={e=>update('category',e.target.value)}>{editableCategories.map(c=><option key={c}>{c}</option>)}</select></label>
          <label>Precio fijo opcional<input inputMode="numeric" value={form.fixedPrice} onChange={e=>update('fixedPrice',e.target.value.replace(/\D/g,''))} placeholder="Dejar vacío para usar promociones"/></label>
          <label className="form-check"><input className="form-check-input" type="checkbox" checked={form.active!==false} onChange={e=>update('active',e.target.checked)}/><span className="form-check-label">Mostrar en el catálogo de clientes</span></label>
        </div>
      </div>
      <div className="actions"><button className="primary" onClick={save} disabled={savingImage}>{form.id?'Guardar cambios':'Agregar al catálogo'}</button>{form.id&&<button className="ghost" onClick={clear}>Cancelar edición</button>}</div>
    </div>

    <div className="panel">
      <div className="customer-section-title"><div><h3>Productos del catálogo ({products.length})</h3><p>Los productos desactivados no aparecen para los clientes.</p></div><button className="ghost" onClick={restore}>Restaurar catálogo original</button></div>
      <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar producto..."/>
      <div className="admin-catalog-grid">
        {filtered.map(p=><article className={`admin-product ${p.active===false?'inactive':''}`} key={p.id}>
          <img src={p.image} alt={p.name}/><div className="admin-product-body"><b>{p.name}</b><small>{p.category} · {p.measure||'Sin medida'}</small><span>{p.active===false?'Oculto':'Visible'}</span></div>
          <div className="row-actions"><button className="ghost smallbtn" onClick={()=>edit(p)}>Editar</button><button className="ghost smallbtn" onClick={()=>toggle(p)}>{p.active===false?'Activar':'Ocultar'}</button><button className="danger smallbtn" onClick={()=>remove(p)}>Eliminar</button></div>
        </article>)}
      </div>
    </div>
  </>
}
