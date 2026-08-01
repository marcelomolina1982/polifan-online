import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { figuresDefault } from '../lib/constants'

const cleanPhone = value => String(value||'').replace(/\D/g,'')

export default function CustomerOrder(){
  const params=new URLSearchParams(window.location.search)
  const urlPhone=cleanPhone(params.get('w'))
  const [config,setConfig]=useState({whatsapp:urlPhone, businessName:'Tu Vida En Tinta', figures:figuresDefault})
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState('')
  const [cart,setCart]=useState({})
  const [data,setData]=useState({name:'',phone:'',address:'',locality:'',delivery:'',method:'Envío',notes:''})

  useEffect(()=>{
    async function load(){
      try{
        const {data:row}=await supabase.from('app_state').select('data').eq('id','main').maybeSingle()
        const state=row?.data||{}
        setConfig({
          whatsapp:urlPhone||cleanPhone(state.customerSettings?.whatsapp),
          businessName:state.customerSettings?.businessName||'Tu Vida En Tinta',
          figures:Array.isArray(state.figures)&&state.figures.length?state.figures:figuresDefault
        })
      }catch{
        // La página puede seguir funcionando con el catálogo incluido en la app.
      }finally{setLoading(false)}
    }
    load()
  },[urlPhone])

  const visible=useMemo(()=>config.figures.filter(f=>f.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))),[config.figures,search])
  const items=Object.entries(cart).filter(([,qty])=>qty>0).map(([figure,qty])=>({figure,qty}))
  const total=items.reduce((sum,item)=>sum+item.qty,0)

  function changeQty(figure,delta){
    setCart(prev=>({...prev,[figure]:Math.max(0,(prev[figure]||0)+delta)}))
  }
  function update(field,value){setData(prev=>({...prev,[field]:value}))}
  function send(){
    if(!config.whatsapp)return alert('El comercio todavía no configuró su número de WhatsApp.')
    if(!data.name.trim())return alert('Ingresá tu nombre.')
    if(!data.phone.trim())return alert('Ingresá tu WhatsApp.')
    if(!items.length)return alert('Elegí al menos una figura.')
    if(data.method==='Envío'&&(!data.address.trim()||!data.locality.trim()))return alert('Completá dirección y localidad para cotizar el envío.')

    const productLines=items.map(i=>`• ${i.figure}: ${i.qty}`).join('\n')
    const message=[
      '🛒 *NUEVA SOLICITUD DE PEDIDO*','',
      `👤 *Cliente:* ${data.name.trim()}`,
      `📱 *WhatsApp:* ${data.phone.trim()}`,
      `📦 *Entrega:* ${data.method}`,
      data.method==='Envío'?`📍 *Dirección:* ${data.address.trim()}, ${data.locality.trim()}`:'📍 *Retiro por el local*',
      data.delivery?`📅 *Fecha deseada:* ${data.delivery}`:'',
      '', '*FIGURAS*', productLines,
      '', `🔢 *Total de piezas:* ${total}`,
      '', `📝 *Observaciones:* ${data.notes.trim()||'Sin observaciones'}`,
      '', 'Quedo a la espera de la cotización del envío y los datos para realizar el pago.'
    ].filter(Boolean).join('\n')
    window.open(`https://wa.me/${config.whatsapp}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer')
  }

  return <div className="customer-page">
    <div className="customer-top">
      <img src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta"/>
      <div><small>PEDIDOS DE POLIFAN</small><h1>{config.businessName}</h1><p>Elegí tus figuras y enviá la solicitud por WhatsApp. El envío y el pago se coordinan después.</p></div>
    </div>

    {loading?<div className="customer-loading">Cargando catálogo…</div>:<>
      <section className="customer-section">
        <div className="customer-section-title"><div><h2>1. Elegí las figuras</h2><p>Podés combinar todos los modelos.</p></div><span className="cart-count">{total} piezas</span></div>
        <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar figura..."/>
        <div className="customer-catalog">
          {visible.map(figure=><article className="customer-product" key={figure}>
            <div className="customer-product-icon">✂</div><b>{figure}</b>
            <div className="qty-control"><button type="button" onClick={()=>changeQty(figure,-1)}>−</button><span>{cart[figure]||0}</span><button type="button" onClick={()=>changeQty(figure,1)}>＋</button></div>
          </article>)}
        </div>
      </section>

      {items.length>0&&<section className="customer-section cart-summary">
        <h2>Tu selección</h2>
        {items.map(i=><div className="cart-line" key={i.figure}><span>{i.figure}</span><b>{i.qty}</b></div>)}
        <div className="cart-total"><span>Total</span><strong>{total} piezas</strong></div>
      </section>}

      <section className="customer-section">
        <h2>2. Tus datos</h2>
        <div className="customer-grid">
          <label>Nombre y apellido<input value={data.name} onChange={e=>update('name',e.target.value)} placeholder="Tu nombre"/></label>
          <label>Tu WhatsApp<input inputMode="tel" value={data.phone} onChange={e=>update('phone',e.target.value)} placeholder="Ej.: 11 2345 6789"/></label>
          <label>Forma de entrega<select value={data.method} onChange={e=>update('method',e.target.value)}><option>Envío</option><option>Retiro por el local</option></select></label>
          <label>Fecha deseada<input type="date" value={data.delivery} onChange={e=>update('delivery',e.target.value)}/></label>
          {data.method==='Envío'&&<><label>Dirección<input value={data.address} onChange={e=>update('address',e.target.value)} placeholder="Calle, número y entrecalles"/></label><label>Localidad<input value={data.locality} onChange={e=>update('locality',e.target.value)} placeholder="Tu localidad"/></label></>}
        </div>
        <label>Observaciones<textarea value={data.notes} onChange={e=>update('notes',e.target.value)} placeholder="Colores, medidas, nombres personalizados u otros detalles..."/></label>
        <div className="customer-notice">El pedido todavía no queda confirmado. Te responderemos por WhatsApp con el costo del envío, disponibilidad y datos de pago.</div>
        <button type="button" className="whatsapp-button" onClick={send}>Enviar pedido por WhatsApp</button>
      </section>
    </>}
  </div>
}
