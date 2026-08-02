import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { catalogCategories, catalogProducts } from '../lib/catalog'

const cleanPhone = value => String(value || '').replace(/\D/g, '')
const money = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)

function regularPrice(qty) {
  if (qty <= 0) return 0
  if (qty <= 5) return qty * 6000
  if (qty <= 11) return qty * (25000 / 6)
  return qty * (40000 / 12)
}

function lightPrice(qty) {
  if (qty <= 0) return 0
  if (qty <= 11) return qty * 7000
  if (qty <= 23) return qty * 6000
  return qty * 5000
}

function regularRateLabel(qty) {
  if (qty <= 5) return '$6.000 c/u'
  if (qty <= 11) return 'precio promo de 6 ($25.000 ÷ 6 por pieza)'
  return 'precio promo de 12 ($40.000 ÷ 12 por pieza)'
}

function lightRateLabel(qty) {
  if (qty <= 11) return '$7.000 c/u'
  if (qty <= 23) return '$6.000 c/u'
  return '$5.000 c/u'
}

export default function CustomerOrder() {
  const params = new URLSearchParams(window.location.search)
  const urlPhone = cleanPhone(params.get('w'))
  const [config, setConfig] = useState({ whatsapp: urlPhone, businessName: 'Tu Vida En Tinta' })
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState(catalogProducts)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Todos')
  const [cart, setCart] = useState({})
  const [data, setData] = useState({ name: '', phone: '', address: '', locality: '', postalCode: '', delivery: '', method: 'Envío', notes: '' })

  useEffect(() => {
    async function load() {
      try {
        const { data: row } = await supabase.from('app_state').select('data').eq('id', 'main').maybeSingle()
        const state = row?.data || {}
        setProducts((state.customerCatalog?.length ? state.customerCatalog : catalogProducts).filter(product => product.active !== false))
        setConfig({
          whatsapp: urlPhone || cleanPhone(state.customerSettings?.whatsapp),
          businessName: state.customerSettings?.businessName || 'Tu Vida En Tinta'
        })
      } catch {
        // El catálogo puede funcionar igualmente con los productos incluidos.
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [urlPhone])

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return products.filter(product => {
      const categoryMatch = category === 'Todos' || product.category === category
      const textMatch = !term || `${product.name} ${product.measure} ${product.category}`.toLocaleLowerCase('es').includes(term)
      return categoryMatch && textMatch
    })
  }, [search, category, products])

  const items = Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ product: products.find(product => product.id === id), qty }))
    .filter(item => item.product)

  const regularQty = items.filter(item => ['Carameleras', 'Figuras para pintar'].includes(item.product.category) || (item.product.category === 'Palabras' && !item.product.fixedPrice)).reduce((sum, item) => sum + item.qty, 0)
  const lightQty = items.filter(item => item.product.category === 'Figuras con luces').reduce((sum, item) => sum + item.qty, 0)
  const fixedTotal = items.filter(item => item.product.fixedPrice).reduce((sum, item) => sum + item.product.fixedPrice * item.qty, 0)
  const regularTotal = regularPrice(regularQty)
  const lightTotal = lightPrice(lightQty)
  const estimatedTotal = regularTotal + lightTotal + fixedTotal
  const total = items.reduce((sum, item) => sum + item.qty, 0)

  function changeQty(id, delta) {
    setCart(previous => ({ ...previous, [id]: Math.max(0, (previous[id] || 0) + delta) }))
  }
  function update(field, value) {
    setData(previous => ({ ...previous, [field]: value }))
  }
  function send() {
    if (!config.whatsapp) return alert('El comercio todavía no configuró su número de WhatsApp.')
    if (!data.name.trim()) return alert('Ingresá tu nombre.')
    if (!data.phone.trim()) return alert('Ingresá tu WhatsApp.')
    if (!items.length) return alert('Elegí al menos un producto.')
    if (data.method === 'Envío' && (!data.address.trim() || !data.locality.trim() || !data.postalCode.trim())) return alert('Completá dirección, localidad y código postal para cotizar el envío.')

    const productLines = items.map(item => `• ${item.product.name} (${item.product.measure}): ${item.qty}`).join('\n')
    const priceLines = [
      regularQty ? `Figuras regulares (${regularQty}, ${regularRateLabel(regularQty)}): ${money(regularTotal)}` : '',
      lightQty ? `Figuras con luces (${lightQty}, ${lightRateLabel(lightQty)}): ${money(lightTotal)}` : '',
      fixedTotal ? `Productos con precio fijo: ${money(fixedTotal)}` : ''
    ].filter(Boolean).join('\n')

    const message = [
      '🛒 *NUEVA SOLICITUD DE PEDIDO*', '',
      `👤 *Cliente:* ${data.name.trim()}`,
      `📱 *WhatsApp:* ${data.phone.trim()}`,
      `📦 *Entrega:* ${data.method}`,
      data.method === 'Envío' ? `📍 *Dirección:* ${data.address.trim()}, ${data.locality.trim()}` : '📍 *Retiro por el local*',
      data.method === 'Envío' ? `📮 *Código postal:* ${data.postalCode.trim()}` : '',
      data.delivery ? `📅 *Fecha deseada:* ${data.delivery}` : '',
      '', '*PRODUCTOS*', productLines,
      '', `🔢 *Total de piezas:* ${total}`,
      priceLines ? `\n💰 *Cálculo estimado:*\n${priceLines}\n*Total estimado: ${money(estimatedTotal)}*` : '',
      '', `📝 *Observaciones:* ${data.notes.trim() || 'Sin observaciones'}`,
      '', 'El total es estimado y no incluye envío. Quedo a la espera de la confirmación, la cotización del envío y los datos para realizar el pago.'
    ].filter(Boolean).join('\n')

    window.open(`https://wa.me/${config.whatsapp}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  return <div className="customer-page">
    <div className="customer-top">
      <img src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta" />
      <div><small>PEDIDOS DE POLIFAN</small><h1>{config.businessName}</h1><p>Elegí tus productos y enviá la solicitud por WhatsApp. El envío y el pago se coordinan después.</p></div>
    </div>

    <section className="customer-promos">
      <div><small>POR UNIDAD</small><strong>$6.000</strong><span>figuras regulares</span></div>
      <div><small>DE 6 A 11</small><strong>$25.000 ÷ 6</strong><span>ese valor por cada pieza</span></div>
      <div><small>12 O MÁS</small><strong>$40.000 ÷ 12</strong><span>ese valor por cada pieza</span></div>
    </section>

    {loading ? <div className="customer-loading">Cargando catálogo…</div> : <>
      <section className="customer-section">
        <div className="customer-section-title"><div><h2>1. Elegí los productos</h2><p>Fotos, nombres y medidas tomados de tu catálogo.</p></div><span className="cart-count">{total} piezas</span></div>
        <div className="customer-categories">
          {catalogCategories.map(item => <button type="button" key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}
        </div>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="🔍 Buscar por nombre..." />

        {category === 'Cartelería' ? <div className="catalog-empty"><b>Cartelería personalizada</b><p>El PDF compartido todavía no incluye modelos de cartelería. Podés describir lo que necesitás en observaciones y enviarlo por WhatsApp.</p></div> :
          <div className="customer-catalog">
            {visible.map(product => <article className="customer-product" key={product.id}>
              <img className="customer-product-image" src={product.image} alt={product.name} loading="lazy" />
              <div className="customer-product-info"><b>{product.name}</b><small>{product.measure}</small>{product.fixedPrice ? <span>{money(product.fixedPrice)}</span> : null}</div>
              <div className="qty-control"><button type="button" aria-label={`Quitar ${product.name}`} onClick={() => changeQty(product.id, -1)}>−</button><span>{cart[product.id] || 0}</span><button type="button" aria-label={`Agregar ${product.name}`} onClick={() => changeQty(product.id, 1)}>＋</button></div>
            </article>)}
          </div>}
      </section>

      {items.length > 0 && <section className="customer-section cart-summary">
        <h2>Tu selección</h2>
        {items.map(item => <div className="cart-line" key={item.product.id}><span>{item.product.name}</span><b>{item.qty}</b></div>)}
        <div className="cart-total"><span>Total</span><strong>{total} piezas</strong></div>
        <div className="estimated-price"><span>Total estimado sin envío</span><strong>{money(estimatedTotal)}</strong><small>La confirmación final se realiza por WhatsApp.</small></div>
      </section>}

      <section className="customer-section">
        <h2>2. Tus datos</h2>
        <div className="customer-grid">
          <label>Nombre y apellido<input value={data.name} onChange={event => update('name', event.target.value)} placeholder="Tu nombre" /></label>
          <label>Tu WhatsApp<input inputMode="tel" value={data.phone} onChange={event => update('phone', event.target.value)} placeholder="Ej.: 11 2345 6789" /></label>
          <label>Forma de entrega<select value={data.method} onChange={event => update('method', event.target.value)}><option>Envío</option><option>Retiro por el local</option></select></label>
          <label>Fecha deseada<input type="date" value={data.delivery} onChange={event => update('delivery', event.target.value)} /></label>
          {data.method === 'Envío' && <>
            <label>Dirección<input value={data.address} onChange={event => update('address', event.target.value)} placeholder="Calle, número y entrecalles" required /></label>
            <label>Localidad<input value={data.locality} onChange={event => update('locality', event.target.value)} placeholder="Tu localidad" required /></label>
            <label>Código postal<input inputMode="text" value={data.postalCode} onChange={event => update('postalCode', event.target.value.replace(/[^0-9A-Za-z-]/g, ''))} placeholder="Ej.: 1655" autoComplete="postal-code" required /></label>
          </>}
        </div>
        <label>Observaciones<textarea value={data.notes} onChange={event => update('notes', event.target.value)} placeholder="Colores, nombres personalizados, cartelería u otros detalles..." /></label>
        <div className="customer-notice">El pedido todavía no queda confirmado. Te responderemos por WhatsApp con el costo del envío, disponibilidad y datos de pago.</div>
        <button type="button" className="whatsapp-button" onClick={send}>Enviar pedido por WhatsApp</button>
      </section>
    </>}
  </div>
}
