import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'
import { trackCatalogEvent } from '../lib/analytics'
import { argentinaNow, estimateProductionAvailability, formatArgentinaLongDate } from '../lib/production'

const cleanPhone = value => String(value || '').replace(/\D/g, '')
const money = value => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)
const PLANNING_CACHE_KEY = 'tvet_catalog_planning_cache_v1'

function regularPrice(qty) {
  if (qty <= 0) return 0
  if (qty <= 5) return qty * 6000
  if (qty <= 11) return 25000 + (qty - 6) * (25000 / 6)
  return 40000 + (qty - 12) * (40000 / 12)
}
function lightPrice(qty) {
  if (qty <= 0) return 0
  if (qty <= 11) return qty * 7000
  if (qty <= 23) return qty * 6000
  return qty * 5000
}
function hasCustomPrice(product){return Boolean(product?.priceUnit||product?.price6||product?.price12||product?.price100)}
function customProductPrice(product,qty){
  const q=Math.max(0,Number(qty)||0)
  if(!q)return 0
  if(product.price100&&q>=100)return q*(Number(product.price100)/100)
  if(product.price12&&q>=12)return q*(Number(product.price12)/12)
  if(product.price6&&q>=6)return q*(Number(product.price6)/6)
  if(product.priceUnit)return q*Number(product.priceUnit)
  return q*Number(product.fixedPrice||0)
}

export default function CustomerOrder({publicCatalogState=null}) {
  const params = new URLSearchParams(window.location.search)
  const urlPhone = cleanPhone(params.get('w'))
  const publicProductsInitial=publicCatalogState?.customerCatalog?.length?publicCatalogState.customerCatalog:catalogProducts
  const [config, setConfig] = useState({ whatsapp: urlPhone, businessName: 'Tu Vida En Tinta' })
  const [loading, setLoading] = useState(!publicCatalogState?.customerCatalog?.length)
  const [orders, setOrders] = useState([])
  const [closedProductionDates, setClosedProductionDates] = useState([])
  const [planningSync, setPlanningSync] = useState({ status: 'loading', error: '', updatedAt: '', fetchedAt: '' })
  const [sending, setSending] = useState(false)
  const [products, setProducts] = useState(normalizeCatalogProducts(publicProductsInitial).filter(product=>product.active!==false))
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Carameleras')
  const [cart, setCart] = useState({})
  const [zoomProduct,setZoomProduct]=useState(null)
  const [specialFigure,setSpecialFigure]=useState({enabled:false,description:''})
  const [customerSource]=useState(()=>{const q=new URLSearchParams(window.location.search);const raw=(q.get('src')||q.get('utm_source')||'').toLowerCase();if(raw.includes('tiktok'))return 'TikTok';if(raw.includes('instagram')||raw==='ig')return 'Instagram';if(raw.includes('whatsapp')||raw==='wa')return 'WhatsApp';return 'Directo / otro'})
  const [data, setData] = useState({ firstName: '', lastName: '', name: '', phone: '', dni: '', email: '', address: '', betweenStreets: '', locality: '', district: '', province: '', postalCode: '', delivery: '', method: 'Logística GBA/CABA', agencyDelivery: 'Envío a domicilio', notes: '' })
  const [publicReviews,setPublicReviews]=useState([])
  const [publicPhotos,setPublicPhotos]=useState([])
  const [feedback, setFeedback] = useState({ rating: '', comment: '', sent: false })
  const [chatOpen,setChatOpen]=useState(false)
  const [chatbotSettings,setChatbotSettings]=useState(()=>{let saved={};try{saved=JSON.parse(window.localStorage.getItem(PLANNING_CACHE_KEY)||'null')?.state?.chatbotSettings||{}}catch{};return {enabled:true,assistantName:'Juli',assistantSubtitle:'Asistente de Tu Vida en Tinta',assistantImage:'/mia-assistant-cutout.png',avatarStyleVersion:2,launcherAvatarPosition:'above',welcome:'¡Hola! Puedo ayudarte a buscar figuras, conocer precios y armar tu pedido.',...saved}})
  const [chatMessages,setChatMessages]=useState([{from:'bot',text:'¡Hola! Puedo ayudarte a buscar figuras, conocer precios y armar tu pedido.'}])

  useEffect(()=>{setChatMessages(current=>current.length<=1?[{from:'bot',text:chatbotSettings.welcome||`¡Hola! Soy ${chatbotSettings.assistantName||'tu asistente'}. Puedo ayudarte a buscar figuras, conocer precios y armar tu pedido.`}]:current)},[chatbotSettings.welcome,chatbotSettings.assistantName])

  useEffect(()=>{
    if(!publicCatalogState?.customerCatalog?.length)return
    const publicProducts=normalizeCatalogProducts(publicCatalogState.customerCatalog).filter(product=>product.active!==false)
    setProducts(publicProducts)
    setPublicReviews((publicCatalogState.customerReviews||[]).filter(x=>x.active!==false))
    setPublicPhotos((publicCatalogState.customerPhotos||[]).filter(x=>x.active!==false))
    setConfig({whatsapp:urlPhone||cleanPhone(publicCatalogState.customerSettings?.whatsapp),businessName:publicCatalogState.customerSettings?.businessName||'Tu Vida En Tinta'})
    setChatbotSettings((()=>{const saved=publicCatalogState.chatbotSettings||{};const migrateAvatar=saved.avatarStyleVersion!==2;return {enabled:true,assistantName:'Juli',assistantSubtitle:'Asistente de Tu Vida en Tinta',avatarStyleVersion:2,launcherAvatarPosition:'above',welcome:'¡Hola! Puedo ayudarte a buscar figuras, conocer precios y armar tu pedido.',...saved,assistantImage:migrateAvatar?'/mia-assistant-cutout.png':(saved.assistantImage||'/mia-assistant-cutout.png')}})())
    setLoading(false)
    if(category!=='Todos'&&!publicProducts.some(p=>p.category===category))setCategory('Todos')
  },[publicCatalogState?.__updatedAt,urlPhone])

  async function refreshPlanning(showLoading=false,{retries=1,strict=false}={}) {
    if(showLoading&&!publicCatalogState?.customerCatalog?.length) setLoading(true)
    setPlanningSync(previous=>({...previous,status:'loading',error:''}))
    let lastError=null
    try {
      for(let attempt=1;attempt<=Math.max(1,retries);attempt++){
        try{
          const { data: row, error } = await supabase.from('app_state').select('data,updated_at').eq('id', 'main').maybeSingle()
          if(error) throw error
          if(!row?.data) throw new Error('No se encontró la planificación principal.')
          const state = row.data
          if(!Array.isArray(state.productionClosedDates)) throw new Error('La planificación no contiene la lista de días cerrados.')
          if(!Array.isArray(state.orders)) throw new Error('La planificación no contiene la lista de pedidos.')
          if(!publicCatalogState?.customerCatalog?.length){
            setProducts(normalizeCatalogProducts(state.customerCatalog?.length ? state.customerCatalog : catalogProducts).filter(product => product.active !== false))
            setPublicReviews((state.customerReviews||[]).filter(x=>x.active!==false))
            setPublicPhotos((state.customerPhotos||[]).filter(x=>x.active!==false))
            setConfig({whatsapp:urlPhone||cleanPhone(state.customerSettings?.whatsapp),businessName:state.customerSettings?.businessName||'Tu Vida En Tinta'})
            setChatbotSettings((()=>{const saved=state.chatbotSettings||{};const migrateAvatar=saved.avatarStyleVersion!==2;return {enabled:true,assistantName:'Juli',assistantSubtitle:'Asistente de Tu Vida en Tinta',avatarStyleVersion:2,launcherAvatarPosition:'above',welcome:'¡Hola! Puedo ayudarte a buscar figuras, conocer precios y armar tu pedido.',...saved,assistantImage:migrateAvatar?'/mia-assistant-cutout.png':(saved.assistantImage||'/mia-assistant-cutout.png')}})())
          }
          setOrders(state.orders)
          setClosedProductionDates(state.productionClosedDates)
          const cachedPlanning={state:{orders:state.orders,productionClosedDates:state.productionClosedDates},updatedAt:row.updated_at||'',cachedAt:new Date().toISOString()}
          try{window.localStorage.setItem(PLANNING_CACHE_KEY,JSON.stringify(cachedPlanning))}catch{}
          setPlanningSync({status:'ready',error:'',updatedAt:row.updated_at||'',fetchedAt:new Date().toISOString()})
          return {...state,__updatedAt:row.updated_at||''}
        }catch(error){lastError=error;if(attempt<retries) await new Promise(resolve=>window.setTimeout(resolve,500*attempt))}
      }
      throw lastError || new Error('No se pudo actualizar la planificación.')
    } catch(error) {
      let cached=null
      try{cached=JSON.parse(window.localStorage.getItem(PLANNING_CACHE_KEY)||'null')}catch{}
      const cachedState=cached?.state
      if(Array.isArray(cachedState?.productionClosedDates)&&Array.isArray(cachedState?.orders)){
        if(!publicCatalogState?.customerCatalog?.length){
          setProducts(normalizeCatalogProducts(cachedState.customerCatalog?.length ? cachedState.customerCatalog : catalogProducts).filter(product => product.active !== false))
          setPublicReviews((cachedState.customerReviews||[]).filter(x=>x.active!==false));setPublicPhotos((cachedState.customerPhotos||[]).filter(x=>x.active!==false))
          setConfig({whatsapp:urlPhone||cleanPhone(cachedState.customerSettings?.whatsapp),businessName:cachedState.customerSettings?.businessName||'Tu Vida En Tinta'})
          setChatbotSettings((()=>{const saved=cachedState.chatbotSettings||{};const migrateAvatar=saved.avatarStyleVersion!==2;return {enabled:true,assistantName:'Juli',assistantSubtitle:'Asistente de Tu Vida en Tinta',avatarStyleVersion:2,launcherAvatarPosition:'above',welcome:'¡Hola! Puedo ayudarte a buscar figuras, conocer precios y armar tu pedido.',...saved,assistantImage:migrateAvatar?'/mia-assistant-cutout.png':(saved.assistantImage||'/mia-assistant-cutout.png')}})())
        }
        setOrders(cachedState.orders);setClosedProductionDates(cachedState.productionClosedDates)
        setPlanningSync({status:'stale',error:error?.message||'No se pudo actualizar la planificación.',updatedAt:cached.updatedAt||'',fetchedAt:cached.cachedAt||''})
        return {...cachedState,__updatedAt:cached.updatedAt||'',__cached:true}
      }
      setPlanningSync(previous=>({...previous,status:'error',error:error?.message||'No se pudo actualizar la planificación.'}))
      if(strict) throw error
      return null
    } finally {if(showLoading&&!publicCatalogState?.customerCatalog?.length) setLoading(false)}
  }

  useEffect(() => {
    refreshPlanning(true,{retries:1})
    const onVisible=()=>{ if(document.visibilityState==='visible') refreshPlanning(false,{retries:1}) }
    document.addEventListener('visibilitychange',onVisible)
    const timer=window.setInterval(()=>refreshPlanning(false,{retries:1}),60000)
    const channel=supabase.channel('catalog-planning-sync').on('postgres_changes',{event:'*',schema:'public',table:'app_state',filter:'id=eq.main'},()=>refreshPlanning(false,{retries:1})).subscribe()
    return ()=>{document.removeEventListener('visibilitychange',onVisible);window.clearInterval(timer);supabase.removeChannel(channel)}
  }, [urlPhone])

  useEffect(() => {trackCatalogEvent('catalog_visit', { metadata: { device: window.innerWidth <= 760 ? 'mobile' : 'desktop', source: customerSource } })}, [customerSource])

  const categories=useMemo(()=>['Todos',...new Set(products.map(p=>p.category).filter(Boolean))],[products])
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return products.filter(product => {
      const categoryMatch = !category || category === 'Todos' || product.category === category
      const textMatch = !term || `${product.name} ${product.measure} ${product.category}`.toLocaleLowerCase('es').includes(term)
      return categoryMatch && textMatch
    })
  }, [search, category, products])

  const items = Object.entries(cart).filter(([, qty]) => qty > 0).map(([id, qty]) => ({ product: products.find(product => product.id === id), qty })).filter(item => item.product)
  const specialQty=specialFigure.enabled&&specialFigure.description.trim()?1:0
  const standardItems=items.filter(item=>!hasCustomPrice(item.product)&&!item.product.fixedPrice)
  const regularQty = standardItems.filter(item => item.product.category === 'Carameleras').reduce((sum, item) => sum + item.qty, 0)+specialQty
  const lightQty = standardItems.filter(item => item.product.category === 'Figuras con luces'||item.product.category==='Palabras con luces').reduce((sum, item) => sum + item.qty, 0)
  const specialPriceTotal=items.filter(item=>hasCustomPrice(item.product)||item.product.fixedPrice).reduce((sum,item)=>sum+customProductPrice(item.product,item.qty),0)
  const estimatedTotal = regularPrice(regularQty) + lightPrice(lightQty) + specialPriceTotal
  const total = items.reduce((sum, item) => sum + item.qty, 0)+specialQty
  const deliveryEstimate = ['ready','stale'].includes(planningSync.status) ? estimateProductionAvailability(orders,total,closedProductionDates) : null
  const fmtProductionDate = value => formatArgentinaLongDate(value,{includeYear:false,capitalize:true})
  const nextGoal = regularQty < 6 ? 6 : regularQty < 12 ? 12 : null
  const missingForGoal = nextGoal ? nextGoal - regularQty : 0
  const progressMax = regularQty < 6 ? 6 : 12
  const progressValue = Math.min(regularQty, progressMax)

  function changeQty(id, delta) {const product=products.find(item=>item.id===id);const nextQty=Math.max(0,(cart[id]||0)+delta);setCart(previous=>({...previous,[id]:nextQty}));if(product)trackCatalogEvent(delta>0?'cart_add':'cart_remove',{productId:product.id,productName:product.name,category:product.category,quantity:1})}
  function viewProduct(product) {setZoomProduct(product);trackCatalogEvent('product_view', { productId: product.id, productName: product.name, category: product.category })}
  async function sendFeedback(rating) {setFeedback(previous=>({...previous,rating}));await trackCatalogEvent('feedback',{rating,comment:feedback.comment});setFeedback(previous=>({...previous,rating,sent:true}))}
  function update(field, value) {setData(previous => ({ ...previous, [field]: value }))}

  async function send() {
    if(sending) return
    if (!config.whatsapp) return alert('El comercio todavía no configuró su número de WhatsApp.')
    if (!data.firstName.trim()) return alert('Ingresá tu nombre.')
    if (!data.lastName.trim()) return alert('Ingresá tu apellido.')
    if (!data.phone.trim()) return alert('Ingresá tu WhatsApp.')
    if (!items.length&&!specialQty) return alert('Elegí al menos un producto o describí una figura especial.')
    if(data.method==='Logística GBA/CABA' && (!data.address.trim()||!data.betweenStreets.trim()||!data.locality.trim()||!data.district.trim()||!data.province.trim()||!data.postalCode.trim()||!data.email.trim())) return alert('Completá domicilio, entre calles, localidad, partido, provincia, código postal y correo electrónico.')
    if(data.method==='Vía Cargo' && (!data.dni.trim()||!data.address.trim()||!data.locality.trim()||!data.district.trim()||!data.province.trim()||!data.postalCode.trim()||!data.email.trim())) return alert('Completá DNI, domicilio, localidad, partido, provincia, código postal y correo electrónico.')
    setSending(true)
    const latestState=await refreshPlanning(false,{retries:1})
    const latestOrders=Array.isArray(latestState?.orders)?latestState.orders:orders
    const latestClosedDates=Array.isArray(latestState?.productionClosedDates)?latestState.productionClosedDates:closedProductionDates
    const canEstimate=Array.isArray(latestOrders)&&Array.isArray(latestClosedDates)&&(planningSync.status!=='error'||latestState)
    const finalDeliveryEstimate=canEstimate?estimateProductionAvailability(latestOrders,total,latestClosedDates):null
    const productionDate=finalDeliveryEstimate?.productionDate||null
    const productionText=productionDate?`🛠️ *Producción disponible:* Desde ${fmtProductionDate(productionDate).toLowerCase()} en adelante`:'🛠️ *Producción disponible:* Fecha a confirmar por nuestro equipo'
    const productLines=[...items.map(item=>`• ${item.product.name} (${item.product.measure}): ${item.qty}`),...(specialQty?[`• FIGURA ESPECIAL A DISEÑAR: 1 — ${specialFigure.description.trim()}`]:[])].join('\n')
    const arNow=argentinaNow();const [year,month,day]=arNow.date.split('-');const receivedDate=`${day}/${month}/${year}`;const receivedTime=arNow.time;const requestCode=`WEB-${arNow.compactDate}-${arNow.compactTime}`
    const message=['🛒 *NUEVA SOLICITUD DE PEDIDO*',`🧾 *Código:* ${requestCode}`,`🕘 *Recibida:* ${receivedDate} · ${receivedTime}`,'',`👤 *Cliente:* ${data.firstName.trim()} ${data.lastName.trim()}`,`📱 *WhatsApp:* ${data.phone.trim()}`,data.dni.trim()?`🪪 *DNI:* ${data.dni.trim()}`:'',data.email.trim()?`✉️ *Email:* ${data.email.trim()}`:'',`📦 *Tipo de entrega:* ${data.method}`,data.method!=='Retiro en el local'?`📍 *Domicilio:* ${data.address.trim()}`:'',data.method==='Logística GBA/CABA'?`↔️ *Entre calles:* ${data.betweenStreets.trim()}`:'',data.method!=='Retiro en el local'?`🏙️ *Localidad:* ${data.locality.trim()}`:'',data.method!=='Retiro en el local'?`🗺️ *Partido / Departamento:* ${data.district.trim()}`:'',data.method!=='Retiro en el local'?`📌 *Provincia:* ${data.province.trim()}`:'',data.method!=='Retiro en el local'?`📮 *Código postal:* ${data.postalCode.trim()}`:'',data.method==='Vía Cargo'?`🚚 *Modalidad:* ${data.agencyDelivery}`:'',productionText,'','*PRODUCTOS*',productLines,'',`🔢 *Total de piezas:* ${total}`,estimatedTotal?`💰 *Total estimado:* ${money(estimatedTotal)}`:'','',`📝 *Observaciones:* ${data.notes.trim()||'Sin observaciones'}`,'','El total es estimado y no incluye envío.','','Muchas gracias por elegir *TU VIDA EN TINTA* 💜','En breve revisaremos la solicitud, calcularemos el costo del envío y te enviaremos el importe final junto con los datos para realizar el pago.','La producción comenzará una vez confirmado el pago.'].filter(Boolean).join('\n')
    const requestItems=[...items.map(item=>({productId:item.product.id,name:item.product.name,measure:item.product.measure,qty:item.qty})),...(specialQty?[{productId:'special-request',name:'Figura especial a diseñar',measure:'A confirmar',qty:1,special:true,description:specialFigure.description.trim()}]:[])]
    const {error:requestError}=await supabase.from('web_requests').insert({code:requestCode,status:'Pendiente de pago',customer:{...data,source:customerSource,name:[data.firstName,data.lastName].filter(Boolean).join(' '),delivery:'',estimatedDeliveryStart:productionDate,estimatedDeliveryEnd:productionDate,productionDateStatus:productionDate?'estimada':'pendiente de confirmar'},items:requestItems,quantity:total,estimated_total:estimatedTotal,estimated_from:productionDate,estimated_to:productionDate,notes:data.notes.trim()})
    if(requestError){setSending(false);return alert('No se pudo guardar la solicitud. Verificá que hayas ejecutado SUPABASE_SOLICITUDES_WEB.sql. '+requestError.message)}
    trackCatalogEvent('order_sent',{locality:data.locality,province:data.province,postalCode:data.postalCode,quantity:total,metadata:{method:data.method,estimatedTotal,source:customerSource,specialFigure:specialQty?specialFigure.description.trim():null}})
    items.forEach(item=>trackCatalogEvent('order_product',{productId:item.product.id,productName:item.product.name,category:item.product.category,quantity:item.qty}))
    setSending(false);window.open(`https://wa.me/${config.whatsapp}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer')
  }

  function chatbotAction(action){
    const replies={catalogo:chatbotSettings.catalogo||'Podés buscar por nombre o recorrer las categorías. Usá el buscador del catálogo.',precios:chatbotSettings.precios||'Los precios se calculan automáticamente según la cantidad. Armá el carrito y vas a ver el total estimado.',envio:chatbotSettings.envio||'El envío se coordina por WhatsApp. Necesitamos localidad, provincia y código postal.',comprar:chatbotSettings.comprar||'Elegí las figuras, completá tus datos y enviá la solicitud. Después confirmaremos disponibilidad, fecha, pago y envío.',humano:chatbotSettings.humano||'Te conectamos con nosotros por WhatsApp para una atención personalizada.'}
    setChatMessages(m=>[...m,{from:'user',text:{catalogo:'Ver catálogo',precios:'Consultar precios',envio:'Consultar envío',comprar:'Cómo comprar',humano:'Hablar con una persona'}[action]},{from:'bot',text:replies[action]}])
    if(action==='catalogo'){setChatOpen(false);document.querySelector('.catalog-search-main')?.scrollIntoView({behavior:'smooth'})}
    if(action==='comprar'){setChatOpen(false);document.querySelector('.cart-summary,.customer-grid')?.scrollIntoView({behavior:'smooth'})}
    if(action==='humano'&&config.whatsapp)window.open(`https://wa.me/${config.whatsapp}?text=${encodeURIComponent('Hola, necesito ayuda para realizar una compra en el catálogo.')}`,'_blank','noopener,noreferrer')
  }

  return <div className="customer-page">
    <header className="customer-hero"><div className="customer-hero-brand"><img src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta" /><div><small>CATÁLOGO OFICIAL DE POLIFAN</small><h1>{config.businessName}</h1><p>Elegí, combiná y armá tu pedido en pocos pasos.</p></div></div><div className="customer-hero-badge"><span>✨</span><div><b>Hecho especialmente para vos</b><small>Producción a pedido · Envíos a todo el país</small></div></div></header>
    <div className="customer-trust-strip"><span>🔒 Compra coordinada por WhatsApp</span><span>🎨 Diseños personalizables</span><span>📦 Envíos a todo el país</span><span>💜 Atención personalizada</span></div>
    <section className="customer-promos" aria-label="Precios y promociones"><div className="promo-card promo-unit"><small>POR UNIDAD</small><strong>$6.000</strong><span>1 figura</span></div><div className="promo-card promo-six"><small>PROMO POR 6</small><strong>$25.000</strong><span>6 figuras</span></div><div className="promo-card promo-twelve"><small>PROMO POR 12</small><strong>$40.000</strong><span>12 figuras</span></div></section>

    {loading ? <div className="customer-loading">Cargando catálogo…</div> : <>
      <section className="customer-section">
        <div className="customer-section-title"><div><small className="section-kicker">PASO 1</small><h2>Elegí tus diseños favoritos</h2><p>Podés combinar modelos y aprovechar las promociones por cantidad. Los productos con precio especial muestran sus propias promos.</p></div><span className="cart-count">🛒 {total} piezas</span></div>
        <div className="catalog-search-main"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar un diseño por nombre..." /><span>⌕</span></div>
        <div className="customer-categories customer-categories-primary">{categories.map(item=><button type="button" key={item} className={category===item?'active':''} onClick={()=>setCategory(item)}>{item}</button>)}</div>
        {category==='Cartelería'?<div className="catalog-empty"><b>Cartelería personalizada</b><p>Describí lo que necesitás en observaciones y envialo por WhatsApp.</p></div>:<div className="customer-catalog">{visible.map(product=><article className={`customer-product ${(cart[product.id]||0)>0?'selected':''}`} key={product.id}>{(cart[product.id]||0)>0&&<span className="product-selected-badge">✓ {cart[product.id]} en tu pedido</span>}<img className="customer-product-image" src={product.image} alt={product.name} loading="lazy" onClick={()=>viewProduct(product)}/><div className="customer-product-info" onClick={()=>viewProduct(product)}><b>{product.name}</b><small>{product.measure}</small>{hasCustomPrice(product)?<span>{product.priceUnit?`1: ${money(product.priceUnit)}`:''}{product.price6?` · x6: ${money(product.price6)}`:''}{product.price12?` · x12: ${money(product.price12)}`:''}{product.price100?` · x100: ${money(product.price100)}`:''}</span>:product.fixedPrice?<span>{money(product.fixedPrice)}</span>:null}</div><div className="qty-control"><button type="button" onClick={()=>changeQty(product.id,-1)}>−</button><span>{cart[product.id]||0}</span><button type="button" onClick={()=>changeQty(product.id,1)}>＋</button></div></article>)}</div>}
      </section>

      <section className="customer-section special-figure-request"><small className="section-kicker">¿NO ENCONTRASTE TU FIGURA?</small><h2>Pedí una figura especial</h2><p>Podés agregar una sola figura especial por pedido. Describinos qué personaje, objeto o diseño necesitás y lo revisaremos antes de confirmar el pedido.</p><label className="form-check"><input type="checkbox" checked={specialFigure.enabled} onChange={e=>setSpecialFigure(v=>({...v,enabled:e.target.checked}))}/><span>Quiero agregar 1 figura especial</span></label>{specialFigure.enabled&&<textarea maxLength={300} value={specialFigure.description} onChange={e=>setSpecialFigure(v=>({...v,description:e.target.value}))} placeholder="Ej.: Quiero una figura de... Detalles, temática, nombre, etc."/>}</section>
      {regularQty>0&&<section className="customer-section promo-progress"><div><b>{nextGoal?`Te faltan ${missingForGoal} figura${missingForGoal===1?'':'s'} para el próximo precio`:'🎉 Alcanzaste el mejor precio'}</b><span>{regularQty} figuras regulares seleccionadas</span></div><div className="progress-track"><i style={{width:`${Math.max(8,(progressValue/progressMax)*100)}%`}} /></div></section>}
      {items.length>0&&<section className="customer-section cart-summary"><h2>Tu selección</h2>{items.map(item=><div className="cart-line" key={item.product.id}><span>{item.product.name}</span><b>{item.qty}</b></div>)}{specialQty>0&&<div className="cart-line"><span>Figura especial: {specialFigure.description.trim()}</span><b>1</b></div>}<div className="cart-total"><span>Total</span><strong>{total} piezas</strong></div><div className="estimated-price"><span>Total estimado sin envío</span><strong>{money(estimatedTotal)}</strong><small>La confirmación final se realiza por WhatsApp.</small></div></section>}

      <section className="customer-section"><small className="section-kicker">PASO 2</small><h2>Completá tus datos</h2><div className="customer-grid">
        <label>Nombre<input value={data.firstName} onChange={event=>{update('firstName',event.target.value);update('name',[event.target.value,data.lastName].filter(Boolean).join(' '))}} placeholder="Tu nombre" autoComplete="given-name" /></label>
        <label>Apellido<input value={data.lastName} onChange={event=>{update('lastName',event.target.value);update('name',[data.firstName,event.target.value].filter(Boolean).join(' '))}} placeholder="Tu apellido" autoComplete="family-name" /></label>
        <label>Tu WhatsApp<input inputMode="tel" value={data.phone} onChange={event=>update('phone',event.target.value)} placeholder="Ej.: 11 2345 6789" /></label>
        <label>{data.method==='Vía Cargo'?'DNI *':'DNI (opcional)'}<input inputMode="numeric" value={data.dni} onChange={event=>update('dni',event.target.value.replace(/\D/g,''))} placeholder="DNI" /></label>
        <label>Tipo de entrega<select value={data.method} onChange={event=>update('method',event.target.value)}><option>Logística GBA/CABA</option><option>Retiro en el local</option><option>Vía Cargo</option><option>Otro expreso</option></select></label>
        <label>Correo electrónico<input type="email" value={data.email} onChange={event=>update('email',event.target.value)} placeholder="tu@email.com" /></label>
        <div className={`delivery-estimate-box planning-${planningSync.status}`}><small>🛠️ PRODUCCIÓN DISPONIBLE</small>{planningSync.status==='ready'&&deliveryEstimate?<><b>Desde {fmtProductionDate(deliveryEstimate.productionDate).toLowerCase()} en adelante</b><span>Calculado con el calendario actualizado y los días cerrados registrados en la app.</span></>:planningSync.status==='stale'&&deliveryEstimate?<><b>Desde {fmtProductionDate(deliveryEstimate.productionDate).toLowerCase()} en adelante (estimado)</b><span>No pudimos actualizar ahora; usamos la última planificación guardada. <button type="button" className="planning-retry" onClick={()=>refreshPlanning(false,{retries:1})}>Actualizar</button></span></>:planningSync.status==='error'?<><b>Fecha de producción a confirmar</b><span>No pudimos consultar el calendario. <button type="button" className="planning-retry" onClick={()=>refreshPlanning(false,{retries:1})}>Reintentar</button></span></>:<><b>Actualizando calendario…</b><span>Podés continuar completando el pedido.</span></>}</div>
        {data.method!=='Retiro en el local'&&<><label>Domicilio<input value={data.address} onChange={event=>update('address',event.target.value)} placeholder="Calle y número" /></label>{data.method==='Logística GBA/CABA'&&<label>Entre calles<input value={data.betweenStreets} onChange={event=>update('betweenStreets',event.target.value)} /></label>}<label>Localidad<input value={data.locality} onChange={event=>update('locality',event.target.value)} /></label><label>Partido / Departamento<input value={data.district} onChange={event=>update('district',event.target.value)} /></label><label>Provincia<input value={data.province} onChange={event=>update('province',event.target.value)} /></label><label>Código postal<input value={data.postalCode} onChange={event=>update('postalCode',event.target.value.replace(/[^0-9A-Za-z-]/g,''))} /></label></>}
        {data.method==='Vía Cargo'&&<label>¿Cómo lo recibís?<select value={data.agencyDelivery} onChange={event=>update('agencyDelivery',event.target.value)}><option>Envío a domicilio</option><option>Retiro en agencia</option></select></label>}
      </div><label>Observaciones<textarea value={data.notes} onChange={event=>update('notes',event.target.value)} /></label><div className="customer-notice">La solicitud quedará pendiente de pago. El pedido todavía no queda confirmado.</div><button type="button" className="whatsapp-button" onClick={send} disabled={sending}><span>{sending?'Guardando y enviando…':'Enviar solicitud por WhatsApp'}</span></button></section>

      {(publicPhotos.length>0||publicReviews.length>0)&&<section className="customer-section customer-trust-public"><small className="section-kicker">CLIENTES REALES</small><h2>Fotos y opiniones de quienes ya compraron</h2>{publicPhotos.length>0&&<><h3>📸 Fotos que nos enviaron</h3><div className="trust-photo-grid">{publicPhotos.map(x=><article key={x.id}><img src={x.image} alt={x.caption||'Foto de cliente'}/><b>{x.name||'Cliente'}</b><small>{x.caption}</small></article>)}</div></>}{publicReviews.length>0&&<><h3>⭐ Reseñas</h3><div className="trust-review-grid">{publicReviews.map(x=><article key={x.id}><strong>★★★★★</strong><p>“{x.text}”</p><b>{x.name||'Cliente'}</b></article>)}</div></>}</section>}
      <section className="customer-section customer-feedback"><h2>¿Te gustó el catálogo?</h2><p>Tu opinión nos ayuda a mejorarlo.</p><textarea value={feedback.comment} onChange={event=>setFeedback(previous=>({...previous,comment:event.target.value,sent:false}))} placeholder="Comentario opcional..." maxLength={500}/><div className="feedback-actions"><button type="button" className={feedback.rating==='positive'?'active':''} onClick={()=>sendFeedback('positive')}>👍 Sí, me gustó</button><button type="button" className={feedback.rating==='negative'?'active':''} onClick={()=>sendFeedback('negative')}>👎 Podría mejorar</button></div>{feedback.sent&&<small className="feedback-thanks">¡Gracias por tu opinión!</small>}</section>
    </>}

    {zoomProduct&&<div onClick={()=>setZoomProduct(null)} style={{position:'fixed',inset:0,zIndex:99999,background:'rgba(0,0,0,.82)',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}><div onClick={e=>e.stopPropagation()} style={{position:'relative',maxWidth:'95vw',maxHeight:'95vh',background:'#fff',borderRadius:'18px',padding:'14px'}}><button onClick={()=>setZoomProduct(null)} style={{position:'absolute',right:'8px',top:'8px',zIndex:2,fontSize:'24px'}}>×</button><img src={zoomProduct.image} alt={zoomProduct.name} style={{display:'block',maxWidth:'90vw',maxHeight:'82vh',width:'auto',height:'auto',objectFit:'contain'}}/><div style={{padding:'10px 4px 2px',fontWeight:800,textAlign:'center'}}>{zoomProduct.name}</div></div></div>}
    {items.length>0&&<button type="button" className="floating-cart" onClick={()=>document.querySelector('.cart-summary')?.scrollIntoView({behavior:'smooth'})}><span>🛒 {total} piezas</span><strong>{money(estimatedTotal)}</strong></button>}
    {chatbotSettings.enabled!==false&&<div className={`catalog-chat-launcher-wrap launcher-${chatbotSettings.launcherAvatarPosition||'above'}`} style={{'--assistant-color':chatbotSettings.themeColor||'#6f3dc4'}}><div className="catalog-chat-launcher-avatar">{chatbotSettings.assistantImage?<img src={chatbotSettings.assistantImage} alt={chatbotSettings.assistantName||'Asistente'}/>:<span>💬</span>}</div><span className="catalog-chat-launcher-name">{chatbotSettings.assistantName||'Asistente'}</span><button type="button" className="catalog-chat-launcher" onClick={()=>setChatOpen(v=>!v)}><span className="chat-launcher-icon">💬</span><span>¿Necesitás ayuda?</span></button></div>}
    {chatbotSettings.enabled!==false&&chatOpen&&<aside className="catalog-chatbot"><header style={{background:chatbotSettings.themeColor||'#6f3dc4'}}><div className="catalog-chat-identity"><div className="catalog-chat-avatar">{chatbotSettings.assistantImage?<img src={chatbotSettings.assistantImage} alt={chatbotSettings.assistantName||'Asistente'}/>:<span>💬</span>}</div><div><b>{chatbotSettings.assistantName||'Asistente de compra'}</b><small>{chatbotSettings.assistantSubtitle||'Tu Vida en Tinta'}</small></div></div><button onClick={()=>setChatOpen(false)}>×</button></header><div className="catalog-chat-messages">{chatMessages.map((m,i)=><div key={i} className={`chat-message ${m.from}`}>{m.text}</div>)}</div><div className="catalog-chat-options">{chatbotSettings.enableCatalog!==false&&<button onClick={()=>chatbotAction('catalogo')}>🔎 Buscar figuras</button>}{chatbotSettings.enablePrices!==false&&<button onClick={()=>chatbotAction('precios')}>💰 Precios</button>}{chatbotSettings.enableShipping!==false&&<button onClick={()=>chatbotAction('envio')}>📦 Envío</button>}{chatbotSettings.enablePurchase!==false&&<button onClick={()=>chatbotAction('comprar')}>🛒 Cómo comprar</button>}{chatbotSettings.enableHuman!==false&&<button onClick={()=>chatbotAction('humano')}>👤 Hablar con nosotros</button>}</div></aside>}
  </div>
}