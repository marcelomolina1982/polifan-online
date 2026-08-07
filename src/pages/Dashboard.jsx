import React from 'react'
import { Title, Badge } from '../components/UI'
import { money } from '../lib/format'
import { stockRows, isOrderCommitted } from '../lib/inventory'
import { DAILY_PIECE_LIMIT, orderPieces, productionStatus, sheetsForPieces, todayArgentinaISO, argentinaNow } from '../lib/production'

const pct=(value,total)=>Math.max(0,Math.min(100,total?Math.round((value/total)*100):0))
const dateLabel=(date,opts={})=>new Date(date+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'short',...opts})

function StatCard({icon,label,value,detail,tone='purple',onClick}){
  return <button type="button" className={'dash-stat '+tone} onClick={onClick}>
    <span className="dash-stat-icon">{icon}</span>
    <span className="dash-stat-copy"><small>{label}</small><strong>{value}</strong>{detail&&<em>{detail}</em>}</span>
  </button>
}

export default function Dashboard({db,go}){
  const today=todayArgentinaISO()
  const activeOrders=db.orders.filter(o=>isOrderCommitted(o,today))
  const todayOrders=db.orders.filter(o=>o.delivery===today && o.status!=='Cancelado')
  const pendingPieces=activeOrders.reduce((sum,o)=>sum+orderPieces(o),0)
  const todayRevenue=db.orders.filter(o=>(o.date||'')===today && o.status!=='Cancelado').reduce((a,o)=>a+Number(o.total||0),0)
  const [yearText,monthText]=argentinaNow().date.split('-')
  const month = Number(monthText)
  const year = Number(yearText)
  const monthly = db.orders.filter(o=>{
    const raw=(o.date||o.createdAt||'').slice(0,10)
    if(!raw) return false
    const d=new Date(raw+'T12:00:00')
    return d.getMonth()+1===month && d.getFullYear()===year && o.status!=='Cancelado'
  })
  const revenue=monthly.reduce((a,o)=>a+Number(o.total||0),0)
  const monthlyExpenses=(db.expenses||[]).filter(e=>{
    const raw=(e.date||'').slice(0,10)
    if(!raw) return false
    const d=new Date(raw+'T12:00:00')
    return d.getMonth()+1===month && d.getFullYear()===year
  }).reduce((a,e)=>a+Number(e.amount||0),0)
  const netProfit=revenue-monthlyExpenses
  const lowRows=stockRows(db).filter(s=>s.total<=s.min)
  const todayPieces=todayOrders.reduce((sum,o)=>sum+orderPieces(o),0)
  const webPending=Number(db.webRequests?.filter?.(r=>r.status==='Pendiente de pago').length||0)
  const packed=db.orders.filter(o=>['Listo','Embalado'].includes(o.status)).length
  const unpaid=db.orders.filter(o=>isOrderCommitted(o,today) && Number(o.paid||0)<Number(o.total||0)).length
  const todayProgress=pct(todayPieces,DAILY_PIECE_LIMIT)
  const todayFree=Math.max(0,DAILY_PIECE_LIMIT-todayPieces)
  const monthlyOrders=monthly.length
  const avgTicket=monthlyOrders?Math.round(revenue/monthlyOrders):0

  const productionByDate=Object.entries(db.orders.filter(o=>o.delivery && o.status!=='Cancelado').reduce((acc,o)=>{
    acc[o.delivery]=(acc[o.delivery]||0)+orderPieces(o); return acc
  },{})).sort(([a],[b])=>a.localeCompare(b)).filter(([date])=>date>=today).slice(0,7)

  const alerts=[
    todayPieces>=DAILY_PIECE_LIMIT ? {tone:'danger',icon:'⚠',title:'Capacidad de hoy completa',text:`Hay ${todayPieces} piezas programadas. Revisá el calendario antes de sumar más.` ,action:'calendar'} : todayPieces>=70 ? {tone:'warning',icon:'⏳',title:'Producción cerca del límite',text:`Quedan ${todayFree} lugares disponibles para hoy.`,action:'calendar'} : null,
    webPending ? {tone:'info',icon:'🛒',title:'Solicitudes esperando confirmación',text:`Tenés ${webPending} solicitud${webPending===1?'':'es'} web pendiente${webPending===1?'':'s'} de pago.`,action:'webrequests'} : null,
    lowRows.length ? {tone:'warning',icon:'📦',title:'Stock para reponer',text:`${lowRows.length} artículo${lowRows.length===1?'':'s'} llegaron al mínimo.`,action:'stock'} : null,
    unpaid ? {tone:'neutral',icon:'💳',title:'Saldos pendientes',text:`${unpaid} pedido${unpaid===1?'':'s'} todavía no están completamente cobrados.`,action:'orders'} : null
  ].filter(Boolean)

  const nextDeliveries=db.orders
    .filter(o=>o.delivery && o.delivery>=today && o.status!=='Cancelado')
    .sort((a,b)=>String(a.delivery).localeCompare(String(b.delivery)) || String(a.number).localeCompare(String(b.number)))
    .slice(0,6)

  return <>
    <Title title="Panel principal" sub="Una vista rápida de ventas, producción y tareas pendientes." actions={<div className="dash-title-actions"><button className="ghost" onClick={()=>go('calendar')}>🗓 Ver calendario</button><button className="primary" onClick={()=>go('new')}>＋ Nuevo pedido</button></div>}/>

    <section className="dash-hero">
      <div className="dash-hero-copy">
        <span className="dash-eyebrow">RESUMEN DE HOY</span>
        <h2>{todayPieces>=DAILY_PIECE_LIMIT?'Producción completa para hoy':todayPieces>=70?'Día con alta carga de trabajo':'Producción bajo control'}</h2>
        <p>{todayPieces} de {DAILY_PIECE_LIMIT} piezas programadas. {todayPieces<DAILY_PIECE_LIMIT?`Todavía podés aceptar ${todayFree} piezas para hoy.`:'Revisá las próximas fechas antes de sumar nuevos pedidos.'}</p>
        <div className="dash-progress" aria-label={`Producción ${todayProgress}%`}><span style={{width:`${todayProgress}%`}}/></div>
        <div className="dash-hero-meta"><b>{todayProgress}% ocupado</b><span>{sheetsForPieces(todayPieces)} planchas aproximadas</span><span>{todayOrders.length} entregas</span></div>
      </div>
      <div className="dash-hero-number"><small>PIEZAS HOY</small><strong>{todayPieces}</strong><span>de {DAILY_PIECE_LIMIT}</span></div>
    </section>

    <div className="dash-stats-grid">
      <StatCard icon="📋" label="Pedidos activos" value={activeOrders.length} detail={`${pendingPieces} piezas pendientes`} tone="purple" onClick={()=>go('orders')}/>
      <StatCard icon="🛒" label="Solicitudes web" value={webPending} detail="Esperando pago" tone="pink" onClick={()=>go('webrequests')}/>
      <StatCard icon="💵" label="Facturación del mes" value={money(revenue)} detail={`${monthlyOrders} pedidos · ticket ${money(avgTicket)}`} tone="green" onClick={()=>go('monthly')}/>
      <StatCard icon="✨" label="Ganancia libre" value={money(netProfit)} detail={`Gastos: ${money(monthlyExpenses)}`} tone="blue" onClick={()=>go('expenses')}/>
      <StatCard icon="📦" label="Listos / embalados" value={packed} detail="Preparados para salir" tone="orange" onClick={()=>go('orders')}/>
      <StatCard icon="⚠" label="Stock bajo" value={lowRows.length} detail={lowRows.length?'Requiere reposición':'Todo en orden'} tone={lowRows.length?'red':'teal'} onClick={()=>go('stock')}/>
    </div>

    {alerts.length>0&&<section className="dash-alert-section">
      <div className="dash-section-heading"><div><span className="dash-eyebrow">ATENCIÓN</span><h3>Lo que necesita tu mirada</h3></div></div>
      <div className="dash-alert-grid">{alerts.map((a,i)=><button type="button" className={'dash-alert '+a.tone} key={i} onClick={()=>go(a.action)}><span>{a.icon}</span><div><b>{a.title}</b><small>{a.text}</small></div><i>›</i></button>)}</div>
    </section>}

    <div className="dash-main-grid">
      <section className="panel dash-production-panel">
        <div className="panel-heading"><div><span className="dash-eyebrow">PRÓXIMOS DÍAS</span><h3>Capacidad de producción</h3><small>Máximo recomendado: {DAILY_PIECE_LIMIT} piezas por día.</small></div><button className="ghost" onClick={()=>go('calendar')}>Calendario completo</button></div>
        <div className="dash-production-list">
          {productionByDate.map(([date,pieces])=>{const status=productionStatus(pieces); const progress=pct(pieces,DAILY_PIECE_LIMIT); return <button type="button" className={'dash-production-row '+status} key={date} onClick={()=>go('calendar')}>
            <div className="dash-date"><b>{dateLabel(date)}</b><small>{sheetsForPieces(pieces)} planchas aprox.</small></div>
            <div className="dash-mini-progress"><span style={{width:`${progress}%`}}/></div>
            <div className="dash-capacity"><strong>{pieces}/{DAILY_PIECE_LIMIT}</strong><small>{pieces>DAILY_PIECE_LIMIT?`Exceso ${pieces-DAILY_PIECE_LIMIT}`:pieces===DAILY_PIECE_LIMIT?'Completo':`${DAILY_PIECE_LIMIT-pieces} libres`}</small></div>
          </button>})}
          {!productionByDate.length&&<div className="dash-empty"><span>🗓</span><b>No hay fechas futuras cargadas</b><small>Cuando agregues pedidos aparecerán acá.</small></div>}
        </div>
      </section>

      <section className="panel dash-actions-panel">
        <span className="dash-eyebrow">ACCESOS RÁPIDOS</span><h3>¿Qué necesitás hacer?</h3>
        <div className="dash-action-list">
          <button onClick={()=>go('new')}><span>＋</span><div><b>Crear pedido</b><small>Cargar una nueva venta</small></div></button>
          <button onClick={()=>go('cut')}><span>✂</span><div><b>Lista para cortar</b><small>Ver piezas pendientes</small></div></button>
          <button onClick={()=>go('clients')}><span>👥</span><div><b>Buscar cliente</b><small>Historial y datos</small></div></button>
          <button onClick={()=>go('expenses')}><span>💰</span><div><b>Registrar movimiento</b><small>Ingreso o gasto</small></div></button>
        </div>
      </section>
    </div>

    <div className="dash-bottom-grid">
      <section className="panel">
        <div className="panel-heading"><div><span className="dash-eyebrow">AGENDA</span><h3>Próximas entregas</h3></div><button className="ghost" onClick={()=>go('orders')}>Ver pedidos</button></div>
        <div className="dash-deliveries">
          {nextDeliveries.map(o=><div className="dash-delivery" key={o.id}>
            <div className="dash-delivery-date"><strong>{new Date(o.delivery+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit'})}</strong><small>{new Date(o.delivery+'T12:00:00').toLocaleDateString('es-AR',{month:'short'}).replace('.','')}</small></div>
            <div className="dash-delivery-main"><b>#{o.number} · {o.client}</b><small>{orderPieces(o)} piezas · {o.locality||o.province||'Sin localidad'}</small></div>
            <Badge status={o.status}/>
          </div>)}
          {!nextDeliveries.length&&<div className="dash-empty compact"><span>📭</span><b>No hay entregas próximas</b></div>}
        </div>
      </section>

      <section className="panel dash-today-panel">
        <div className="panel-heading"><div><span className="dash-eyebrow">HOY</span><h3>Entregas programadas</h3></div><button className="ghost" onClick={()=>go('orders')}>Ver todos</button></div>
        <div className="dash-today-list">
          {todayOrders.slice().sort((a,b)=>String(a.number).localeCompare(String(b.number))).slice(0,6).map(o=><div className="dash-today-order" key={o.id}><div><b>#{o.number} · {o.client}</b><small>{orderPieces(o)} piezas</small></div><Badge status={o.status}/></div>)}
          {!todayOrders.length&&<div className="dash-empty compact"><span>☀️</span><b>No hay entregas para hoy</b><small>Podés usar el día para adelantar producción.</small></div>}
        </div>
      </section>
    </div>
  </>
}
