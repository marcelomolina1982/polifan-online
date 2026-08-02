import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { Title, Kpi } from '../components/UI'

const DAY = 86400000
const localDate = date => {
  const copy = new Date(date)
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset())
  return copy.toISOString().slice(0, 10)
}

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

export default function Analytics() {
  const [from, setFrom] = useState(localDate(Date.now() - 29 * DAY))
  const [to, setTo] = useState(localDate(Date.now()))
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    const fromISO = `${from}T00:00:00`
    const toDate = new Date(`${to}T00:00:00`)
    toDate.setDate(toDate.getDate() + 1)
    const { data, error: queryError } = await supabase.from('catalog_events').select('*').gte('created_at', fromISO).lt('created_at', toDate.toISOString()).order('created_at', { ascending: false }).limit(10000)
    if (queryError) setError(queryError.message)
    setEvents(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const metrics = useMemo(() => {
    const visits = events.filter(event => event.event_type === 'catalog_visit')
    const visitors = new Set(visits.map(event => event.visitor_id)).size
    const sessions = new Set(visits.map(event => event.session_id)).size
    const sent = events.filter(event => event.event_type === 'order_sent').length
    const carts = new Set(events.filter(event => event.event_type === 'cart_add').map(event => event.session_id)).size
    const likes = events.filter(event => event.event_type === 'feedback' && event.rating === 'positive').length
    const dislikes = events.filter(event => event.event_type === 'feedback' && event.rating === 'negative').length
    return { visits: visits.length, visitors, sessions, sent, carts, likes, dislikes, conversion: sessions ? Math.round((sent / sessions) * 100) : 0 }
  }, [events])

  const viewed = topRows(events, 'product_name', ['product_view'])
  const added = topRows(events, 'product_name', ['cart_add'])
  const ordered = topRows(events, 'product_name', ['order_product'])
  const provinces = topRows(events, 'province', ['order_sent'])
  const localities = topRows(events, 'locality', ['order_sent'])
  const postalCodes = topRows(events, 'postal_code', ['order_sent'])
  const comments = events.filter(event => event.event_type === 'feedback' && event.comment)

  return <>
    <Title title="Estadísticas del catálogo" sub="Visitas, interés, pedidos enviados y opiniones de tus clientes." />
    <section className="panel analytics-filters">
      <label>Desde<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>Hasta<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <button className="primary" type="button" onClick={load}>Actualizar</button>
    </section>
    {error && <div className="panel analytics-error"><b>No se pudieron leer las estadísticas.</b><span>{error}</span><small>Ejecutá primero el archivo SUPABASE_ESTADISTICAS.sql incluido en el ZIP.</small></div>}
    {loading ? <div className="panel">Cargando estadísticas…</div> : <>
      <div className="cards analytics-kpis">
        <Kpi label="Visitas" value={metrics.visits}/><Kpi label="Visitantes aproximados" value={metrics.visitors}/><Kpi label="Sesiones" value={metrics.sessions}/><Kpi label="Carritos con productos" value={metrics.carts}/><Kpi label="Pedidos enviados" value={metrics.sent}/><Kpi label="Conversión" value={`${metrics.conversion}%`}/><Kpi label="Les gustó" value={metrics.likes}/><Kpi label="Podría mejorar" value={metrics.dislikes}/>
      </div>
      <div className="analytics-grid"><StatList title="Productos más vistos" rows={viewed}/><StatList title="Más agregados al carrito" rows={added}/><StatList title="Más incluidos en pedidos" rows={ordered}/><StatList title="Provincias declaradas" rows={provinces}/><StatList title="Localidades declaradas" rows={localities}/><StatList title="Códigos postales" rows={postalCodes}/></div>
      <section className="panel"><h3>Comentarios recibidos</h3>{comments.length ? <div className="feedback-comments">{comments.map(event => <article key={event.id}><b>{event.rating === 'positive' ? '👍 Le gustó' : '👎 Podría mejorar'}</b><p>{event.comment}</p><small>{new Date(event.created_at).toLocaleString('es-AR')}</small></article>)}</div> : <p className="muted">Todavía no dejaron comentarios.</p>}</section>
      <p className="analytics-privacy">“Visitantes aproximados” usa un identificador aleatorio guardado en el navegador. La provincia, localidad y el código postal solo se registran cuando la persona los escribe al enviar un pedido.</p>
    </>}
  </>
}
