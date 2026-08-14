import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { Title, Kpi } from '../components/UI'
import { activeCutQty, pendingCutRows, stockRows } from '../lib/inventory'
import { money } from '../lib/format'

const DAY = 86400000
const localDate = date => {
  const copy = new Date(date)
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset())
  return copy.toISOString().slice(0, 10)
}

const normalize = value => String(value || '').trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const orderDate = order => String(order.date || order.createdAt || '').slice(0, 10)
const inRange = (date, from, to) => Boolean(date && date >= from && date <= to)
const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0
const plural = (value, singular, pluralText = `${singular}s`) => `${value} ${value === 1 ? singular : pluralText}`

function topRows(events, key, eventTypes, limit = 10) {
  const counts = new Map()
  events.filter(event => eventTypes.includes(event.event_type)).forEach(event => {
    const label = event[key] || 'Sin informar'
    counts.set(label, (counts.get(label) || 0) + Math.max(1, Number(event.quantity || 0)))
  })
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

function StatList({ title, rows, empty = 'Todavía no hay datos.' }) {
  return <section className="panel analytics-list"><h3>{title}</h3>{rows.length ? rows.map(([label, value], index) => <div className="analytics-row" key={`${label}-${index}`}><span>{label}</span><b>{value}</b></div>) : <p className="muted">{empty}</p>}</section>
}

function rotationLabel(sold30, soldPrevious30) {
  if (!sold30 && !soldPrevious30) return { label: 'Sin datos', className: 'neutral' }
  if (!sold30 && soldPrevious30) return { label: 'En caída', className: 'danger' }
  const growth = soldPrevious30 ? (sold30 - soldPrevious30) / soldPrevious30 : sold30 > 0 ? 1 : 0
  if (growth >= .35 && sold30 >= 4) return { label: 'En crecimiento', className: 'success' }
  if (growth <= -.35) return { label: 'En caída', className: 'danger' }
  if (sold30 >= 12) return { label: 'Alta', className: 'success' }
  if (sold30 >= 4) return { label: 'Media', className: 'warning' }
  return { label: 'Baja', className: 'neutral' }
}

function downloadCsv(rows) {
  const headers = ['Producto','Categoría','Vendidos período','Vendidos 30 días','Pedidos','Facturación','Stock físico','Demanda','En corte','Falta cortar','Rotación','Stock ideal','Producir sugerido','Última venta']
  const csv = [headers, ...rows.map(row => [
    row.name,row.category,row.soldPeriod,row.sold30,row.orderCount,row.revenuePeriod,row.available,row.ordered,row.inCut,row.pending,row.rotation.label,row.targetStock,row.suggested,row.lastSale || ''
  ])].map(line => line.map(value => `"${String(value ?? '').replace(/"/g,'""')}"`).join(',')).join('\n')
  const blob = new Blob(['\ufeff'+csv], { type:'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `estadisticas-catalogo-${localDate(Date.now())}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function Analytics({ db }) {
  const [tab, setTab] = useState('summary')
  const [from, setFrom] = useState(localDate(Date.now() - 29 * DAY))
  const [to, setTo] = useState(localDate(Date.now()))
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [events, setEvents] = useState([])
  const [loadingWeb, setLoadingWeb] = useState(false)
  const [webError, setWebError] = useState('')

  async function loadWeb() {
    setLoadingWeb(true)
    setWebError('')
    const fromISO = `${from}T00:00:00`
    const toDate = new Date(`${to}T00:00:00`)
    toDate.setDate(toDate.getDate() + 1)
    const { data, error } = await supabase.from('catalog_events').select('*').gte('created_at', fromISO).lt('created_at', toDate.toISOString()).order('created_at', { ascending: false }).limit(10000)
    if (error) setWebError(error.message)
    setEvents(data || [])
    setLoadingWeb(false)
  }

  useEffect(() => { loadWeb() }, [])

  const productRows = useMemo(() => {
    const products = (db.customerCatalog || []).length ? db.customerCatalog : (db.figures || []).map((name, index) => ({ id:`figure-${index}`, name, category:'Sin categoría', active:true }))
    const stockMap = Object.fromEntries(stockRows(db).map(row => [normalize(row.figure), row]))
    const pendingMap = Object.fromEntries(pendingCutRows(db).map(row => [normalize(row.figure), row]))
    const cutMap = activeCutQty(db)
    const cutNormalized = Object.fromEntries(Object.entries(cutMap).map(([name, qty]) => [normalize(name), qty]))
    const today = new Date(`${to}T12:00:00`)
    const from30 = localDate(today.getTime() - 29 * DAY)
    const prev30Start = localDate(today.getTime() - 59 * DAY)
    const prev30End = localDate(today.getTime() - 30 * DAY)
    const deliveredStatuses = new Set(['Entregado','Cortado','Listo para cortar','En diseño','Ingresado'])

    return products.map(product => {
      const key = normalize(product.name)
      let soldPeriod = 0, sold30 = 0, soldPrevious30 = 0, revenuePeriod = 0
      let lastSale = '', orderCount = 0
      const seenOrders = new Set()
      ;(db.orders || []).filter(order => order.status !== 'Cancelado' && deliveredStatuses.has(order.status || 'Ingresado')).forEach(order => {
        const date = orderDate(order)
        ;(order.items || []).forEach(item => {
          if (normalize(item.figure) !== key) return
          const qty = safeNumber(item.qty)
          if (inRange(date, from, to)) {
            soldPeriod += qty
            revenuePeriod += qty * safeNumber(order.unitPrice || (safeNumber(order.total) / Math.max(1,(order.items || []).reduce((sum, it) => sum + safeNumber(it.qty), 0))))
            seenOrders.add(order.id || order.number)
          }
          if (inRange(date, from30, to)) sold30 += qty
          if (inRange(date, prev30Start, prev30End)) soldPrevious30 += qty
          if (date && date > lastSale) lastSale = date
        })
      })
      orderCount = seenOrders.size
      const stock = stockMap[key] || { available:0, ordered:0, total:0, min:0 }
      const pending = pendingMap[key]?.pending || 0
      const inCut = safeNumber(cutNormalized[key])
      const weeklyRate = sold30 / 4.285
      const manualMin = safeNumber(db.stockMin?.[product.name])
      const targetStock = Math.max(manualMin, Math.ceil(weeklyRate * 2))
      const projectedNet = safeNumber(stock.total) + inCut
      const suggested = Math.max(0, Math.ceil(targetStock - projectedNet))
      const rotation = rotationLabel(sold30, soldPrevious30)
      const trend = soldPrevious30 ? Math.round(((sold30 - soldPrevious30) / soldPrevious30) * 100) : sold30 ? 100 : 0
      const daysSinceSale = lastSale ? Math.max(0, Math.floor((new Date(`${to}T12:00:00`) - new Date(`${lastSale}T12:00:00`)) / DAY)) : null
      const svgCount = (db.svgLibrary || []).filter(svg => svg.productId === product.id).length
      return {
        id:product.id, name:product.name, category:product.category || 'Sin categoría', active:product.active !== false,
        soldPeriod, sold30, soldPrevious30, revenuePeriod, orderCount, lastSale, daysSinceSale,
        available:safeNumber(stock.available), ordered:safeNumber(stock.ordered), net:safeNumber(stock.total), inCut, pending,
        weeklyRate, targetStock, suggested, rotation, trend, svgCount
      }
    })
  }, [db, from, to])

  const categories = useMemo(() => [...new Set(productRows.map(row => row.category))].sort((a,b) => a.localeCompare(b,'es')), [productRows])
  const filteredRows = useMemo(() => productRows.filter(row => (!category || row.category === category) && (!search || normalize(row.name).includes(normalize(search)))), [productRows, category, search])

  const summary = useMemo(() => {
    const sold = filteredRows.reduce((sum,row) => sum + row.soldPeriod, 0)
    const revenue = filteredRows.reduce((sum,row) => sum + row.revenuePeriod, 0)
    const pending = filteredRows.reduce((sum,row) => sum + row.pending, 0)
    const suggested = filteredRows.reduce((sum,row) => sum + row.suggested, 0)
    const critical = filteredRows.filter(row => row.pending > 0 || row.net + row.inCut < row.targetStock).length
    const noSvg = filteredRows.filter(row => !row.svgCount).length
    const bestSeller = [...filteredRows].sort((a,b) => b.soldPeriod-a.soldPeriod)[0]
    const fastest = [...filteredRows].sort((a,b) => b.sold30-a.sold30)[0]
    return { sold,revenue,pending,suggested,critical,noSvg,bestSeller,fastest }
  }, [filteredRows])

  const productionSuggestions = useMemo(() => filteredRows.filter(row => row.suggested > 0).sort((a,b) => {
    if (b.pending !== a.pending) return b.pending - a.pending
    if (b.sold30 !== a.sold30) return b.sold30 - a.sold30
    return b.suggested - a.suggested
  }), [filteredRows])

  const highRotationFillers = useMemo(() => filteredRows.filter(row => row.pending === 0 && row.sold30 >= 4 && row.net + row.inCut < row.targetStock).sort((a,b) => b.sold30-a.sold30).slice(0,12), [filteredRows])
  const overstock = useMemo(() => filteredRows.filter(row => row.net + row.inCut > Math.max(row.targetStock * 2, 4)).sort((a,b) => (b.net+b.inCut)-(a.net+a.inCut)).slice(0,12), [filteredRows])

  const webMetrics = useMemo(() => {
    const visits = events.filter(event => event.event_type === 'catalog_visit')
    const visitors = new Set(visits.map(event => event.visitor_id)).size
    const sessions = new Set(visits.map(event => event.session_id)).size
    const sent = events.filter(event => event.event_type === 'order_sent').length
    const carts = new Set(events.filter(event => event.event_type === 'cart_add').map(event => event.session_id)).size
    const likes = events.filter(event => event.event_type === 'feedback' && event.rating === 'positive').length
    const dislikes = events.filter(event => event.event_type === 'feedback' && event.rating === 'negative').length
    return { visits:visits.length, visitors, sessions, sent, carts, likes, dislikes, conversion:sessions ? Math.round((sent/sessions)*100) : 0 }
  }, [events])

  const sourceRows=useMemo(()=>{const map=new Map();events.forEach(e=>{const source=e.metadata?.source||'Directo / otro';const row=map.get(source)||{visits:0,orders:0};if(e.event_type==='catalog_visit')row.visits++;if(e.event_type==='order_sent')row.orders++;map.set(source,row)});return [...map.entries()].sort((a,b)=>b[1].orders-a[1].orders)},[events])

  const viewed = topRows(events, 'product_name', ['product_view'])
  const added = topRows(events, 'product_name', ['cart_add'])
  const ordered = topRows(events, 'product_name', ['order_product'])
  const provinces = topRows(events, 'province', ['order_sent'])
  const comments = events.filter(event => event.event_type === 'feedback' && event.comment)

  return <>
    <Title title="Estadísticas del catálogo" sub="Ventas, rotación, inventario, producción sugerida y comportamiento de clientes." actions={<button className="ghost" onClick={() => downloadCsv(filteredRows)}>Descargar CSV</button>} />

    <section className="panel analytics-filters catalog-stat-filters">
      <label>Desde<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>Hasta<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <label>Categoría<select value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Buscar<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Producto..." /></label>
    </section>

    <div className="analytics-tabs" role="tablist">
      <button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>Resumen</button>
      <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>Productos</button>
      <button className={tab === 'production' ? 'active' : ''} onClick={() => setTab('production')}>Producción sugerida</button>
      <button className={tab === 'web' ? 'active' : ''} onClick={() => { setTab('web'); if (!events.length) loadWeb() }}>Clientes online</button>
    </div>

    {tab === 'summary' && <>
      <div className="cards analytics-kpis catalog-stats-kpis">
        <Kpi label="Unidades vendidas" value={summary.sold}/>
        <Kpi label="Facturación estimada" value={money(summary.revenue)}/>
        <Kpi label="Falta cortar" value={summary.pending}/>
        <Kpi label="Producción sugerida" value={summary.suggested}/>
        <Kpi label="Stock crítico" value={summary.critical}/>
        <Kpi label="Modelos sin SVG" value={summary.noSvg}/>
      </div>
      <div className="analytics-grid catalog-summary-grid">
        <StatList title="Más vendidos del período" rows={[...filteredRows].sort((a,b)=>b.soldPeriod-a.soldPeriod).filter(r=>r.soldPeriod).slice(0,10).map(r=>[r.name,r.soldPeriod])}/>
        <StatList title="Mayor facturación" rows={[...filteredRows].sort((a,b)=>b.revenuePeriod-a.revenuePeriod).filter(r=>r.revenuePeriod).slice(0,10).map(r=>[r.name,money(r.revenuePeriod)])}/>
        <StatList title="Mayor crecimiento · últimos 30 días" rows={[...filteredRows].sort((a,b)=>b.trend-a.trend).filter(r=>r.sold30).slice(0,10).map(r=>[r.name,`${r.trend>0?'+':''}${r.trend}%`])}/>
        <StatList title="Sin ventas recientes" rows={[...filteredRows].filter(r=>r.daysSinceSale === null || r.daysSinceSale >= 30).sort((a,b)=>(b.daysSinceSale??9999)-(a.daysSinceSale??9999)).slice(0,10).map(r=>[r.name,r.daysSinceSale===null?'Nunca':plural(r.daysSinceSale,'día')])}/>
      </div>
      <section className="panel catalog-stat-callout"><div><small>MODELO MÁS VENDIDO</small><b>{summary.bestSeller?.soldPeriod ? summary.bestSeller.name : 'Sin ventas en el período'}</b><span>{summary.bestSeller?.soldPeriod || 0} unidades</span></div><div><small>MAYOR ROTACIÓN · 30 DÍAS</small><b>{summary.fastest?.sold30 ? summary.fastest.name : 'Sin datos suficientes'}</b><span>{summary.fastest?.sold30 || 0} unidades</span></div></section>
    </>}

    {tab === 'web' && <section className="panel"><h3>Origen de visitas y pedidos</h3><p className="muted">Usá enlaces con <b>?src=tiktok</b>, <b>?src=instagram</b> o <b>?src=whatsapp</b>. El catálogo guarda el origen de la visita y del pedido.</p><div className="table-wrap"><table><thead><tr><th>Origen</th><th>Visitas</th><th>Pedidos enviados</th><th>Conversión</th></tr></thead><tbody>{sourceRows.map(([source,row])=><tr key={source}><td><b>{source}</b></td><td>{row.visits}</td><td>{row.orders}</td><td>{row.visits?Math.round(row.orders/row.visits*100):0}%</td></tr>)}{!sourceRows.length&&<tr><td colSpan="4">Todavía no hay datos.</td></tr>}</tbody></table></div></section>}

    {tab === 'products' && <section className="panel table-wrap catalog-stats-table"><table><thead><tr><th>Producto</th><th>Ventas</th><th>Stock</th><th>Pendiente</th><th>En corte</th><th>Rotación</th><th>Última venta</th><th>Sugerencia</th></tr></thead><tbody>
      {filteredRows.sort((a,b)=>b.soldPeriod-a.soldPeriod).map(row => <tr key={row.id}><td><b>{row.name}</b><small className="block">{row.category} · {row.svgCount} SVG</small></td><td><b>{row.soldPeriod}</b><small className="block">{row.orderCount} pedidos · {money(row.revenuePeriod)}</small></td><td><b className={row.net < 0 ? 'red-text' : 'green-text'}>{row.available}</b><small className="block">Neto comprometido: {row.net}</small></td><td className={row.pending ? 'red-text big' : ''}>{row.pending}</td><td>{row.inCut}</td><td><span className={`rotation-badge ${row.rotation.className}`}>{row.rotation.label}</span><small className="block">30 días: {row.sold30} ({row.trend>0?'+':''}{row.trend}%)</small></td><td>{row.lastSale || 'Sin ventas'}<small className="block">{row.daysSinceSale === null ? '' : `Hace ${plural(row.daysSinceSale,'día')}`}</small></td><td><b>{row.suggested ? `Producir ${row.suggested}` : 'No producir'}</b><small className="block">Ideal: {row.targetStock}</small></td></tr>)}
      {!filteredRows.length && <tr><td colSpan="8">No hay productos para los filtros seleccionados.</td></tr>}
    </tbody></table></section>}

    {tab === 'production' && <>
      <section className="panel"><div className="customer-section-title"><div><h3>Producción recomendada</h3><p>Prioriza faltantes reales, luego rotación reciente y stock ideal para dos semanas.</p></div><b>{productionSuggestions.reduce((sum,row)=>sum+row.suggested,0)} piezas</b></div>
        <div className="production-suggestion-list">{productionSuggestions.map((row,index)=><article key={row.id}><span className="suggestion-rank">{index+1}</span><div><b>{row.name}</b><small>{row.pending ? `${row.pending} pendientes` : 'Para stock'} · Rotación {row.rotation.label.toLowerCase()} · Stock proyectado {row.net+row.inCut}</small></div><strong>Producir {row.suggested}</strong></article>)}{!productionSuggestions.length&&<p className="muted">No hay producción adicional recomendada.</p>}</div>
      </section>
      <div className="analytics-grid">
        <StatList title="Buenos modelos para rellenar placas" rows={highRotationFillers.map(row=>[row.name,`Producir ${row.suggested}`])} empty="No hay modelos de alta rotación que necesiten stock."/>
        <StatList title="No usar como relleno · sobrestock" rows={overstock.map(row=>[row.name,`${row.net+row.inCut} disponibles/proyectados`])} empty="No se detectó sobrestock importante."/>
        <StatList title="Modelos pendientes de SVG" rows={filteredRows.filter(row=>!row.svgCount).slice(0,12).map(row=>[row.name,row.rotation.label])} empty="Todos los modelos filtrados tienen SVG vinculados."/>
      </div>
    </>}

    {tab === 'web' && <>
      <section className="panel analytics-filters"><button className="primary" type="button" onClick={loadWeb}>Actualizar estadísticas web</button></section>
      {webError && <div className="panel analytics-error"><b>No se pudieron leer las estadísticas web.</b><span>{webError}</span><small>Ejecutá el archivo SUPABASE_ESTADISTICAS.sql incluido en el ZIP.</small></div>}
      {loadingWeb ? <div className="panel">Cargando estadísticas…</div> : <>
        <div className="cards analytics-kpis"><Kpi label="Visitas" value={webMetrics.visits}/><Kpi label="Visitantes aproximados" value={webMetrics.visitors}/><Kpi label="Sesiones" value={webMetrics.sessions}/><Kpi label="Carritos" value={webMetrics.carts}/><Kpi label="Pedidos enviados" value={webMetrics.sent}/><Kpi label="Conversión" value={`${webMetrics.conversion}%`}/><Kpi label="Les gustó" value={webMetrics.likes}/><Kpi label="Podría mejorar" value={webMetrics.dislikes}/></div>
        <div className="analytics-grid"><StatList title="Productos más vistos" rows={viewed}/><StatList title="Más agregados al carrito" rows={added}/><StatList title="Más incluidos en pedidos" rows={ordered}/><StatList title="Provincias declaradas" rows={provinces}/></div>
        <section className="panel"><h3>Comentarios recibidos</h3>{comments.length ? <div className="feedback-comments">{comments.map(event => <article key={event.id}><b>{event.rating === 'positive' ? '👍 Le gustó' : '👎 Podría mejorar'}</b><p>{event.comment}</p><small>{new Date(event.created_at).toLocaleString('es-AR')}</small></article>)}</div> : <p className="muted">Todavía no dejaron comentarios.</p>}</section>
      </>}
    </>}
  </>
}
