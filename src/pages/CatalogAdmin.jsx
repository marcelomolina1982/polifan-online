import React, { useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { catalogProducts, catalogCategories, normalizeCatalogProducts } from '../lib/catalog'
import { money } from '../lib/format'

const editableCategories = catalogCategories.filter(c => c !== 'Todos')
const emptyForm = { id:'', name:'', measure:'', category:'Carameleras', image:'', fixedPrice:'', active:true, productionType:'simple' }
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
  const products = normalizeCatalogProducts(db.customerCatalog?.length ? db.customerCatalog : catalogProducts)
  const [form,setForm]=useState(emptyForm)
  const [search,setSearch]=useState('')
  const [savingImage,setSavingImage]=useState(false)
  const [exportingPdf,setExportingPdf]=useState(false)
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
    const product={...form,id:baseId,name:form.name.trim(),measure:form.measure.trim(),fixedPrice:Number(form.fixedPrice)||null,active:form.active!==false,productionType:form.productionType||'simple'}
    const next=normalizeCatalogProducts(form.id?products.map(p=>p.id===form.id?product:p):[...products,product])
    await onSave({...db,customerCatalog:next})
    clear(); alert(form.id?'Producto actualizado.':'Producto agregado al catálogo.')
  }
  async function toggle(product){await onSave({...db,customerCatalog:products.map(p=>p.id===product.id?{...p,active:p.active===false}:p)})}
  async function remove(product){if(!confirm(`¿Eliminar “${product.name}” del catálogo de clientes?`))return; await onSave({...db,customerCatalog:products.filter(p=>p.id!==product.id)})}
  async function restore(){if(!confirm('¿Restaurar el catálogo original? Se eliminarán los productos nuevos y cambios realizados.'))return; await onSave({...db,customerCatalog:catalogProducts}); clear()}


  async function imageToDataUrl(url){
    if(!url)return null
    if(String(url).startsWith('data:'))return url
    const response=await fetch(url)
    if(!response.ok)throw new Error('No se pudo cargar una imagen')
    const blob=await response.blob()
    return await new Promise((resolve,reject)=>{
      const reader=new FileReader(); reader.onerror=reject; reader.onload=()=>resolve(reader.result); reader.readAsDataURL(blob)
    })
  }

  function imageFormat(dataUrl){
    if(String(dataUrl).startsWith('data:image/png'))return 'PNG'
    if(String(dataUrl).startsWith('data:image/webp'))return 'WEBP'
    return 'JPEG'
  }

  function getImageDimensions(dataUrl){
    return new Promise((resolve,reject)=>{
      const img=new Image()
      img.onload=()=>resolve({width:img.naturalWidth||img.width,height:img.naturalHeight||img.height})
      img.onerror=reject
      img.src=dataUrl
    })
  }

  async function addImageContained(pdf,dataUrl,x,y,boxW,boxH){
    const {width,height}=await getImageDimensions(dataUrl)
    const scale=Math.min(boxW/width,boxH/height)
    const drawW=width*scale
    const drawH=height*scale
    const drawX=x+(boxW-drawW)/2
    const drawY=y+(boxH-drawH)/2
    pdf.addImage(dataUrl,imageFormat(dataUrl),drawX,drawY,drawW,drawH,undefined,'FAST')
  }

  async function downloadCatalogPdf(){
    const visible=products.filter(p=>p.active!==false)
    if(!visible.length)return alert('No hay productos visibles para exportar.')
    setExportingPdf(true)
    try{
      const { jsPDF }=await import('jspdf')
      const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true})
      const pageW=210, pageH=297, margin=12
      const purple=[83,46,160], navy=[23,49,95], dark=[30,30,38], light=[246,247,252]
      const addPageNumber=()=>{
        const pages=pdf.getNumberOfPages()
        pdf.setPage(pages); pdf.setFontSize(8); pdf.setTextColor(110); pdf.text(`Tu Vida En Tinta · Página ${pages}`,pageW/2,pageH-6,{align:'center'})
      }
      const addHeader=(title)=>{
        pdf.setFillColor(...navy); pdf.rect(0,0,pageW,22,'F')
        pdf.setFont('helvetica','bold'); pdf.setFontSize(18); pdf.setTextColor(255); pdf.text(title,margin,14)
        pdf.setTextColor(...dark)
      }
      // Portada
      pdf.setFillColor(...navy); pdf.rect(0,0,pageW,78,'F')
      pdf.setFillColor(...purple); pdf.rect(0,78,pageW,7,'F')
      try{
        const logo=await imageToDataUrl('/logo-tu-vida-en-tinta.png')
        await addImageContained(pdf,logo,margin,12,44,44)
      }catch{}
      pdf.setTextColor(255); pdf.setFont('helvetica','bold'); pdf.setFontSize(26); pdf.text('CATÁLOGO DE POLIFAN',64,30)
      pdf.setFontSize(18); pdf.text('Tu Vida En Tinta',64,43)
      pdf.setFont('helvetica','normal'); pdf.setFontSize(10); pdf.text('Elegí tus diseños y enviá tu pedido por WhatsApp.',64,53)
      pdf.setTextColor(...dark); pdf.setFont('helvetica','bold'); pdf.setFontSize(16); pdf.text('PRECIOS Y PROMOCIONES',pageW/2,104,{align:'center'})
      const promos=[['POR UNIDAD','$6.000'],['PROMO POR 6','$25.000'],['PROMO POR 12','$40.000']]
      promos.forEach((pr,i)=>{
        const x=margin+i*62
        pdf.setFillColor(...(i===1?purple:navy)); pdf.roundedRect(x,116,58,32,4,4,'F')
        pdf.setTextColor(255); pdf.setFontSize(10); pdf.setFont('helvetica','bold'); pdf.text(pr[0],x+29,127,{align:'center'})
        pdf.setFontSize(17); pdf.text(pr[1],x+29,140,{align:'center'})
      })
      pdf.setTextColor(...dark); pdf.setFontSize(11); pdf.setFont('helvetica','normal')
      pdf.text('Los productos pueden combinarse dentro de cada promoción.',pageW/2,164,{align:'center'})
      pdf.text('Envíos a todo el país · José León Suárez, Buenos Aires',pageW/2,174,{align:'center'})
      pdf.setFont('helvetica','bold'); pdf.text('WhatsApp: 11-5919-2358  ·  @tuvidaentinta',pageW/2,190,{align:'center'})
      addPageNumber()

      for(const category of editableCategories){
        const categoryProducts=visible.filter(p=>p.category===category)
        if(!categoryProducts.length)continue
        pdf.addPage(); addHeader(category.toUpperCase())
        let y=31
        for(let i=0;i<categoryProducts.length;i+=2){
          const pair=categoryProducts.slice(i,i+2)
          const cardH=74
          if(y+cardH>pageH-12){addPageNumber();pdf.addPage();addHeader(category.toUpperCase());y=31}
          for(let col=0;col<pair.length;col++){
            const product=pair[col], x=margin+col*94
            pdf.setFillColor(...light); pdf.setDrawColor(220); pdf.roundedRect(x,y,88,68,3,3,'FD')
            try{
              const img=await imageToDataUrl(product.image)
              pdf.setFillColor(255); pdf.rect(x+4,y+4,80,45,'F')
              await addImageContained(pdf,img,x+4,y+4,80,45)
            }catch{
              pdf.setFillColor(230); pdf.rect(x+4,y+4,80,45,'F'); pdf.setTextColor(120); pdf.setFontSize(9); pdf.text('Imagen no disponible',x+44,y+27,{align:'center'})
            }
            pdf.setTextColor(...dark); pdf.setFont('helvetica','bold'); pdf.setFontSize(11)
            const nameLines=pdf.splitTextToSize(product.name,78).slice(0,2)
            pdf.text(nameLines,x+5,y+54)
            pdf.setFont('helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(85)
            pdf.text(product.measure||'Consultar medida',x+5,y+64)
            if(product.fixedPrice){pdf.setFont('helvetica','bold');pdf.setTextColor(...purple);pdf.text(money(product.fixedPrice),x+83,y+64,{align:'right'})}
          }
          y+=74
        }
        addPageNumber()
      }
      pdf.save(`catalogo-tu-vida-en-tinta-${new Date().toISOString().slice(0,10)}.pdf`)
    }catch(error){
      console.error(error); alert('No se pudo generar el PDF. Probá nuevamente con conexión a internet.')
    }finally{setExportingPdf(false)}
  }

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
          <label>Composición para corte<select value={form.productionType||'simple'} onChange={e=>update('productionType',e.target.value)}><option value="simple">Figura simple</option><option value="tapa-base">Tapa + base</option><option value="capas">Varias capas</option></select></label>
          <label>Precio fijo opcional<input inputMode="numeric" value={form.fixedPrice} onChange={e=>update('fixedPrice',e.target.value.replace(/\D/g,''))} placeholder="Dejar vacío para usar promociones"/></label>
          <label className="form-check"><input className="form-check-input" type="checkbox" checked={form.active!==false} onChange={e=>update('active',e.target.checked)}/><span className="form-check-label">Mostrar en el catálogo de clientes</span></label>
        </div>
      </div>
      <div className="actions"><button className="primary" onClick={save} disabled={savingImage}>{form.id?'Guardar cambios':'Agregar al catálogo'}</button>{form.id&&<button className="ghost" onClick={clear}>Cancelar edición</button>}</div>
    </div>

    <div className="panel">
      <div className="customer-section-title"><div><h3>Productos del catálogo ({products.length})</h3><p>Los productos desactivados no aparecen para los clientes.</p></div><div className="actions"><button className="primary" onClick={downloadCatalogPdf} disabled={exportingPdf}>{exportingPdf?'Generando PDF…':'Descargar catálogo en PDF'}</button><button className="ghost" onClick={restore}>Restaurar catálogo original</button></div></div>
      <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar producto..."/>
      <div className="admin-catalog-grid">
        {filtered.map(p=><article className={`admin-product ${p.active===false?'inactive':''}`} key={p.id}>
          <img src={p.image} alt={p.name}/><div className="admin-product-body"><b>{p.name}</b><small>{p.category} · {p.measure||'Sin medida'} · {(db.svgLibrary||[]).filter(s=>s.productId===p.id).length} SVG</small><span>{p.active===false?'Oculto':'Visible'}</span></div>
          <div className="row-actions"><button className="ghost smallbtn" onClick={()=>edit(p)}>Editar</button><button className="ghost smallbtn" onClick={()=>toggle(p)}>{p.active===false?'Activar':'Ocultar'}</button><button className="danger smallbtn" onClick={()=>remove(p)}>Eliminar</button></div>
        </article>)}
      </div>
    </div>
  </>
}
