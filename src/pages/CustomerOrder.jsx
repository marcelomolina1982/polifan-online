import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { catalogCategories, catalogProducts, normalizeCatalogProducts } from '../lib/catalog'
import { trackCatalogEvent } from '../lib/analytics'
import { argentinaNow, estimateProductionAvailability, formatArgentinaLongDate } from '../lib/production'

const cleanPhone = value => String(value || '').replace(/\D/g, '')
const money = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)

function regularPrice(qty) {
  if (qty <= 0) return 0
  if (qty <= 5) return qty * 6000
  if (qty <= 11) {
    const promoUnitPrice = 25000 / 6
    return 25000 + (qty - 6) * promoUnitPrice
  }
  const promoUnitPrice = 40000 / 12
  return 40000 + (qty - 12) * promoUnitPrice
}

function lightPrice(qty) {
  if (qty <= 0) return 0
  if (qty <= 11) return qty * 7000
  if (qty <= 23) return qty * 6000
  return qty * 5000
}


export default function CustomerOrder() {
  const params = new URLSearchParams(window.location.search)
  const urlPhone = cleanPhone(params.get('w'))
  const [config, setConfig] = useState({ whatsapp: urlPhone, businessName: 'Tu Vida En Tinta' })
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState([])
  const [closedProductionDates, setClosedProductionDates] = useState([])
  const [products, setProducts] = useState(normalizeCatalogProducts(catalogProducts))
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Carameleras')
  const [cart, setCart] = useState({})
  const [data, setData] = useState({ firstName: '', lastName: '', name: '', phone: '', dni: '', email: '', address: '', betweenStreets: '', locality: '', district: '', province: '', postalCode: '', delivery: '', method: 'Logística', agencyDelivery: 'Envío a domicilio', notes: '' })
  const [feedback, setFeedback] = useState({ rating: '', comment: '', sent: false })

  async function refreshPlanning(showLoading=false) {
    if(showLoading) setLoading(true)
    try {
      const { data: row, error } = await supabase.from('app_state').select('data,updated_at').eq('id', 'main').maybeSingle()
      if(error) throw error
      const state = row?.data || {}
      setProducts(normalizeCatalogProducts(state.customerCatalog?.length ? state.customerCatalog : catalogProducts).filter(product => product.active !== false))
      setOrders(state.orders || [])
      setClosedProductionDates(state.productionClosedDates || [])
      setConfig({
        whatsapp: urlPhone || cleanPhone(state.customerSettings?.whatsapp),
        businessName: state.customerSettings?.businessName || 'Tu Vida En Tinta'
      })
      return state
    } catch {
      return null
    } finally {
      if(showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    refreshPlanning(true)
    const onVisible=()=>{ if(document.visibilityState==='visible') refreshPlanning(false) }
    document.addEventListener('visibilitychange',onVisible)
    const timer=window.setInterval(()=>refreshPlanning(false),30000)
    return ()=>{document.removeEventListener('visibilitychange',onVisible);window.clearInterval(timer)}
  }, [urlPhone])

  useEffect(() => {
    trackCatalogEvent('catalog_visit', { metadata: { device: window.innerWidth <= 760 ? 'mobile' : 'desktop' } })
  }, [])

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return products.filter(product => {
      const categoryMatch = !category || category === 'Todos' || product.category === category
      const textMatch = !term || `${product.name} ${product.measure} ${product.category}`.toLocaleLowerCase('es').includes(term)
      return categoryMatch && textMatch
    })
  }, [search, category, products])

  const items = Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ product: products.find(product => product.id === id), qty }))
    .filter(item => item.product)

  const regularQty = items.filter(item => item.product.category === 'Carameleras').reduce((sum, item) => sum + item.qty, 0)
  const lightQty = items.filter(item => item.product.category === 'Figuras con luces').reduce((sum, item) => sum + item.qty, 0)
  const fixedTotal = items.filter(item => item.product.fixedPrice).reduce((sum, item) => sum + item.product.fixedPrice * item.qty, 0)
  const regularTotal = regularPrice(regularQty)
  const lightTotal = lightPrice(lightQty)
  const estimatedTotal = regularTotal + lightTotal + fixedTotal
  const total = items.reduce((sum, item) => sum + item.qty, 0)
  const deliveryEstimate = estimateProductionAvailability(orders,total,closedProductionDates)
  const fmtProductionDate = value => formatArgentinaLongDate(value,{includeYear:false,capitalize:true})
  const nextGoal = regularQty < 6 ? 6 : regularQty < 12 ? 12 : null
  const missingForGoal = nextGoal ? nextGoal - regularQty : 0
  const progressMax = regularQty < 6 ? 6 : 12
  const progressValue = Math.min(regularQty, progressMax)
  const categoryIcons = {'Carameleras':'🍬','Palabras con luces':'✨','Figuras con luces':'💡','Cartelería':'🪧'}

  function changeQty(id, delta) {
    const product = products.find(item => item.id === id)
    const nextQty = Math.max(0, (cart[id] || 0) + delta)
    setCart(previous => ({ ...previous, [id]: nextQty }))
    if (product) trackCatalogEvent(delta > 0 ? 'cart_add' : 'cart_remove', { productId: product.id, productName: product.name, category: product.category, quantity: 1 })
  }
  function viewProduct(product) {
    trackCatalogEvent('product_view', { productId: product.id, productName: product.name, category: product.category })
  }
  async function sendFeedback(rating) {
    setFeedback(previous => ({ ...previous, rating }))
    await trackCatalogEvent('feedback', { rating, comment: feedback.comment })
    setFeedback(previous => ({ ...previous, rating, sent: true }))
  }
  function update(field, value) {
    setData(previous => ({ ...previous, [field]: value }))
  }
  async function send() {
    if (!config.whatsapp) return alert('El comercio todavía no configuró su número de WhatsApp.')
    if (!data.firstName.trim()) return alert('Ingresá tu nombre.')
    if (!data.lastName.trim()) return alert('Ingresá tu apellido.')
    if (!data.phone.trim()) return alert('Ingresá tu WhatsApp.')
    if (!items.length) return alert('Elegí al menos un producto.')
    if(data.method==='Logística' && (!data.address.trim()||!data.betweenStreets.trim()||!data.locality.trim()||!data.district.trim()||!data.province.trim()||!data.postalCode.trim()||!data.email.trim())) return alert('Completá domicilio, entre calles, localidad, partido, provincia, código postal y correo electrónico.')
    if(data.method==='Vía Cargo / Correo Argentino' && (!data.dni.trim()||!data.address.trim()||!data.locality.trim()||!data.district.trim()||!data.province.trim()||!data.postalCode.trim()||!data.email.trim())) return alert('Completá DNI, domicilio, localidad, partido, provincia, código postal y correo electrónico.')

    const latestState=await refreshPlanning(false)
    const latestOrders=latestState?.orders || orders
    const latestClosedDates=latestState?.productionClosedDates || closedProductionDates
    const finalDeliveryEstimate=estimateProductionAvailability(latestOrders,total,latestClosedDates)

    const productLines = items.map(item => `• ${item.product.name} (${item.product.measure}): ${item.qty}`).join('\n')
    const arNow = argentinaNow()
    const [year,month,day]=arNow.date.split('-')
    const receivedDate = `${day}/${month}/${year}`
    const receivedTime = arNow.time
    const compactDate = arNow.compactDate
    const compactTime = arNow.compactTime
    const requestCode=`WEB-${compactDate}-${compactTime}`
    const message = [
      '🛒 *NUEVA SOLICITUD DE PEDIDO*', `🧾 *Código:* ${requestCode}`, `🕘 *Recibida:* ${receivedDate} · ${receivedTime}`, '',
      `👤 *Cliente:* ${data.firstName.trim()} ${data.lastName.trim()}`,
      `📱 *WhatsApp:* ${data.phone.trim()}`,
      data.dni.trim() ? `🪪 *DNI:* ${data.dni.trim()}` : '',
      data.email.trim() ? `✉️ *Email:* ${data.email.trim()}` : '',
      `📦 *Tipo de entrega:* ${data.method}`,
      data.method!=='Retiro en el local'?`📍 *Domicilio:* ${data.address.trim()}`:'',
      data.method==='Logística'?`↔️ *Entre calles:* ${data.betweenStreets.trim()}`:'',
      data.method!=='Retiro en el local'?`🏙️ *Localidad:* ${data.locality.trim()}`:'',
      data.method!=='Retiro en el local'?`🗺️ *Partido / Departamento:* ${data.district.trim()}`:'',
      data.method!=='Retiro en el local'?`📌 *Provincia:* ${data.province.trim()}`:'',
      data.method!=='Retiro en el local'?`📮 *Código postal:* ${data.postalCode.trim()}`:'',
      data.method==='Vía Cargo / Correo Argentino'?`🚚 *Modalidad:* ${data.agencyDelivery}`:'',
      `🛠️ *Producción disponible desde:* ${fmtProductionDate(finalDeliveryEstimate.productionDate)}`, 
      '', '*PRODUCTOS*', productLines,
      '', `🔢 *Total de piezas:* ${total}`,
      estimatedTotal ? `💰 *Total estimado:* ${money(estimatedTotal)}` : '',
      '', `📝 *Observaciones:* ${data.notes.trim() || 'Sin observaciones'}`,
      '', 'El total es estimado y no incluye envío.', '', 'Muchas gracias por elegir *TU VIDA EN TINTA* 💜', 'En breve revisaremos la solicitud, calcularemos el costo del envío y te enviaremos el importe final junto con los datos para realizar el pago.', 'La producción comenzará una vez confirmado el pago.'
    ].filter(Boolean).join('\n')

    const requestItems=items.map(item=>({productId:item.product.id,name:item.product.name,measure:item.product.measure,qty:item.qty}))
    const {error:requestError}=await supabase.from('web_requests').insert({code:requestCode,status:'Pendiente de pago',customer:{...data,name:[data.firstName,data.lastName].filter(Boolean).join(' '),delivery:'',estimatedDeliveryStart:finalDeliveryEstimate.productionDate,estimatedDeliveryEnd:finalDeliveryEstimate.productionDate},items:requestItems,quantity:total,estimated_total:estimatedTotal,estimated_from:finalDeliveryEstimate.productionDate,estimated_to:finalDeliveryEstimate.productionDate,notes:data.notes.trim()})
    if(requestError) return alert('No se pudo guardar la solicitud. Verificá que hayas ejecutado SUPABASE_SOLICITUDES_WEB.sql. '+requestError.message)
    trackCatalogEvent('order_sent', {
      locality: data.locality,
      province: data.province,
      postalCode: data.postalCode,
      quantity: total,
      metadata: { method: data.method, estimatedTotal }
    })
    items.forEach(item => trackCatalogEvent('order_product', { productId: item.product.id, productName: item.product.name, category: item.product.category, quantity: item.qty }))
    window.open(`https://wa.me/${config.whatsapp}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  return <div className="customer-page">
    <header className="customer-hero">
      <div className="customer-hero-brand">
        <img src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta" />
        <div><small>CATÁLOGO OFICIAL DE POLIFAN</small><h1>{config.businessName}</h1><p>Elegí, combiná y armá tu pedido en pocos pasos.</p></div>
      </div>
      <div className="customer-hero-badge"><span>✨</span><div><b>Hecho especialmente para vos</b><small>Producción a pedido · Envíos a todo el país</small></div></div>
    </header>

    <div className="customer-trust-strip">
      <span>🔒 Compra coordinada por WhatsApp</span><span>🎨 Diseños personalizables</span><span>📦 Envíos a todo el país</span><span>💜 Atención personalizada</span>
    </div>

    <section className="customer-promos" aria-label="Precios y promociones">
      <div className="promo-card promo-unit"><small>POR UNIDAD</small><strong>$6.000</strong><span>1 figura</span></div>
      <div className="promo-card promo-six"><small>PROMO POR 6</small><strong>$25.000</strong><span>6 figuras</span></div>
      <div className="promo-card promo-twelve"><small>PROMO POR 12</small><strong>$40.000</strong><span>12 figuras</span></div>
    </section>

    {loading ? <div className="customer-loading">Cargando catálogo…</div> : <>
      <section className="customer-section">
        <div className="customer-section-title"><div><small className="section-kicker">PASO 1</small><h2>Elegí tus diseños favoritos</h2><p>Podés combinar modelos y aprovechar las promociones por cantidad.</p></div><span className="cart-count">🛒 {total} piezas</span></div>
        <div className="catalog-search-main"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar un diseño por nombre..." /><span>⌕</span></div>
        <div className="customer-categories customer-categories-primary">
            {catalogCategories.map(item => <button type="button" key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}
          </div>

          {category === 'Cartelería' ? <div className="catalog-empty"><b>Cartelería personalizada</b><p>Describí lo que necesitás en observaciones y envialo por WhatsApp.</p></div> :
            <div className="customer-catalog">
              {visible.map(product => <article className={`customer-product ${(cart[product.id]||0)>0?'selected':''}`} key={product.id}>
                {(cart[product.id]||0)>0&&<span className="product-selected-badge">✓ {cart[product.id]} en tu pedido</span>}
                <img className="customer-product-image" src={product.image} alt={product.name} loading="lazy" onClick={() => viewProduct(product)} />
                <div className="customer-product-info" onClick={() => viewProduct(product)}><b>{product.name}</b><small>{product.measure}</small>{product.fixedPrice ? <span>{money(product.fixedPrice)}</span> : null}</div>
                <div className="qty-control"><button type="button" aria-label={`Quitar ${product.name}`} onClick={() => changeQty(product.id, -1)}>−</button><span>{cart[product.id] || 0}</span><button type="button" aria-label={`Agregar ${product.name}`} onClick={() => changeQty(product.id, 1)}>＋</button></div>
              </article>)}
            </div>}
        </section>

      {regularQty>0&&<section className="customer-section promo-progress"><div><b>{nextGoal?`Te faltan ${missingForGoal} figura${missingForGoal===1?'':'s'} para el próximo precio`:'🎉 Alcanzaste el mejor precio'}</b><span>{regularQty} figuras regulares seleccionadas</span></div><div className="progress-track"><i style={{width:`${Math.max(8,(progressValue/progressMax)*100)}%`}} /></div></section>}

      {items.length > 0 && <section className="customer-section cart-summary">
        <h2>Tu selección</h2>
        {items.map(item => <div className="cart-line" key={item.product.id}><span>{item.product.name}</span><b>{item.qty}</b></div>)}
        <div className="cart-total"><span>Total</span><strong>{total} piezas</strong></div>
        <div className="estimated-price"><span>Total estimado sin envío</span><strong>{money(estimatedTotal)}</strong><small>La confirmación final se realiza por WhatsApp.</small></div>
      </section>}

      <section className="customer-section">
        <small className="section-kicker">PASO 2</small><h2>Completá tus datos</h2>
        <div className="customer-grid">
          <label>Nombre<input value={data.firstName} onChange={event => {update('firstName', event.target.value);update('name',[event.target.value,data.lastName].filter(Boolean).join(' '))}} placeholder="Tu nombre" autoComplete="given-name" /></label>
          <label>Apellido<input value={data.lastName} onChange={event => {update('lastName', event.target.value);update('name',[data.firstName,event.target.value].filter(Boolean).join(' '))}} placeholder="Tu apellido" autoComplete="family-name" /></label>
          <label>Tu WhatsApp<input inputMode="tel" value={data.phone} onChange={event => update('phone', event.target.value)} placeholder="Ej.: 11 2345 6789" /></label>
          <label>{data.method==='Vía Cargo / Correo Argentino'?'DNI *':'DNI (opcional)'}<input inputMode="numeric" value={data.dni} onChange={event => update('dni', event.target.value.replace(/\D/g, ''))} placeholder="DNI" /></label>
          <label>Tipo de entrega<select value={data.method} onChange={event => update('method', event.target.value)}><option>Logística</option><option>Retiro en el local</option><option>Vía Cargo / Correo Argentino</option></select></label>
          <label>Correo electrónico<input type="email" value={data.email} onChange={event => update('email', event.target.value)} placeholder="tu@email.com" /></label>
          <div className="delivery-estimate-box"><small>🛠️ PRODUCCIÓN DISPONIBLE DESDE</small><b>{fmtProductionDate(deliveryEstimate.productionDate)}</b><span>La fecha definitiva de entrega se confirmará junto con la cotización del envío y la confirmación del pago.</span></div>
          {data.method!=='Retiro en el local'&&<><label>Domicilio<input value={data.address} onChange={event => update('address', event.target.value)} placeholder="Calle y número" /></label>
          {data.method==='Logística'&&<label>Entre calles<input value={data.betweenStreets} onChange={event => update('betweenStreets', event.target.value)} placeholder="Entre calle... y calle..." /></label>}
          <label>Localidad<input value={data.locality} onChange={event => update('locality', event.target.value)} placeholder="Tu localidad" /></label>
          <label>Partido / Departamento<input value={data.district} onChange={event => update('district', event.target.value)} placeholder="Ej.: La Matanza" /></label>
          <label>Provincia<input value={data.province} onChange={event => update('province', event.target.value)} placeholder="Ej.: Buenos Aires" /></label>
          <label>Código postal<input inputMode="text" value={data.postalCode} onChange={event => update('postalCode', event.target.value.replace(/[^0-9A-Za-z-]/g, ''))} placeholder="Ej.: 1655" autoComplete="postal-code" /></label></>}
          {data.method==='Vía Cargo / Correo Argentino'&&<label>¿Cómo lo recibís?<select value={data.agencyDelivery} onChange={event=>update('agencyDelivery',event.target.value)}><option>Envío a domicilio</option><option>Retiro en agencia</option></select></label>}
        </div>
        <label>Observaciones<textarea value={data.notes} onChange={event => update('notes', event.target.value)} placeholder="Colores, nombres personalizados, cartelería u otros detalles..." /></label>
        <div className="customer-notice">La solicitud quedará pendiente de pago. El pedido todavía no queda confirmado. Te responderemos por WhatsApp con el costo del envío, disponibilidad y datos de pago.</div>
        <button type="button" className="whatsapp-button" onClick={send}><span>Enviar solicitud por WhatsApp</span><small>Te confirmamos envío, disponibilidad y pago</small></button>
      </section>

      <section className="customer-section customer-feedback">
        <h2>¿Te gustó el catálogo?</h2>
        <p>Tu opinión nos ayuda a mejorarlo.</p>
        <textarea value={feedback.comment} onChange={event => setFeedback(previous => ({ ...previous, comment: event.target.value, sent: false }))} placeholder="Comentario opcional..." maxLength={500} />
        <div className="feedback-actions">
          <button type="button" className={feedback.rating === 'positive' ? 'active' : ''} onClick={() => sendFeedback('positive')}>👍 Sí, me gustó</button>
          <button type="button" className={feedback.rating === 'negative' ? 'active' : ''} onClick={() => sendFeedback('negative')}>👎 Podría mejorar</button>
        </div>
        {feedback.sent && <small className="feedback-thanks">¡Gracias por tu opinión!</small>}
      </section>
    </>}
    {items.length>0&&<button type="button" className="floating-cart" onClick={()=>document.querySelector('.cart-summary')?.scrollIntoView({behavior:'smooth'})}><span>🛒 {total} piezas</span><strong>{money(estimatedTotal)}</strong></button>}
  </div>
}
