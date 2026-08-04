import React from 'react'
import { Title, Kpi, Badge } from '../components/UI'
import { money } from '../lib/format'
import { stockRows } from '../lib/inventory'
import { DAILY_PIECE_LIMIT, orderPieces, productionStatus, sheetsForPieces } from '../lib/production'

const localISO=()=>{
  const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10)
}

export default function Dashboard({db,go}){
  const today=localISO()
  const activeOrders=db.orders.filter(o=>!['Entregado','Cancelado'].includes(o.status))
  const todayOrders=db.orders.filter(o=>o.delivery===today && o.status!=='Cancelado')
  const pendingPieces=activeOrders.flatMap(o=>o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
  const todayRevenue=db.orders.filter(o=>(o.date||'')===today && o.status!=='Cancelado').reduce((a,o)=>a+Number(o.total||0),0)
  const month = new Date().getMonth()+1
  const year = new Date().getFullYear()
  const monthly = db.orders.filter(o=>{
    const d=new Date((o.date||o.createdAt||'').slice(0,10)+'T12:00:00')
    return d.getMonth()+1===month && d.getFullYear()===year && o.status!=='Cancelado'
  })
  const revenue=monthly.reduce((a,o)=>a+Number(o.total||0),0)
  const monthlyExpenses=(db.expenses||[]).filter(e=>{
    const d=new Date((e.date||'').slice(0,10)+'T12:00:00')
    return d.getMonth()+1===month && d.getFullYear()===year
  }).reduce((a,e)=>a+Number(e.amount||0),0)
  const netProfit=revenue-monthlyExpenses
  const stockData=stockRows(db)
  const lowRows=stockData.filter(s=>s.total<=s.min)
  const low=lowRows.length
  const todayPieces=todayOrders.reduce((sum,o)=>sum+orderPieces(o),0)
  const webPending=Number(db.webRequests?.filter?.(r=>r.status==='Pendiente de pago').length||0)
  const packed=db.orders.filter(o=>o.status==='Embalado').length
  const unpaid=db.orders.filter(o=>!['Entregado','Cancelado'].includes(o.status) && Number(o.paid||0)<Number(o.total||0)).length
  const alerts=[
    todayPieces>=DAILY_PIECE_LIMIT ? {tone:'danger',title:'Capacidad de hoy completa',text:`${todayPieces} piezas programadas para hoy.`} : todayPieces>=75 ? {tone:'warning',title:'Producción cerca del límite',text:`${todayPieces} de ${DAILY_PIECE_LIMIT} piezas para hoy.`} : null,
    low ? {tone:'warning',title:'Stock para reponer',text:`${low} artículo${low===1?'':'s'} llegaron al mínimo.`} : null,
    unpaid ? {tone:'info',title:'Pedidos con saldo pendiente',text:`${unpaid} pedido${unpaid===1?'':'s'} todavía no están completamente cobrados.`} : null
  ].filter(Boolean)
  const productionByDate=Object.entries(db.orders.filter(o=>o.delivery && o.status!=='Cancelado').reduce((acc,o)=>{
    acc[o.delivery]=(acc[o.delivery]||0)+orderPieces(o); return acc
  },{})).sort(([a],[b])=>a.localeCompare(b)).filter(([date])=>date>=today).slice(0,10)

  return <>
    <Title title="Panel principal" sub="Todo lo importante del negocio en una sola pantalla." actions={<button className="primary" onClick={()=>go('new')}>＋ Nuevo pedido</button>}/>
    {alerts.length>0&&<div className="business-alerts">{alerts.map((a,i)=><div className={'business-alert '+a.tone} key={i}><b>{a.title}</b><span>{a.text}</span></div>)}</div>}
    <div className="cards dashboard-cards">
      <Kpi label="Pedidos activos" value={activeOrders.length}/>
      <Kpi label="Solicitudes web" value={webPending}/>
      <Kpi label="Entregas para hoy" value={todayOrders.length}/>
      <Kpi label="Producción de hoy" value={`${todayPieces} / ${DAILY_PIECE_LIMIT}`}/>
      <Kpi label="Piezas pendientes" value={pendingPieces}/>
      <Kpi label="Ventas de hoy" value={money(todayRevenue)}/>
      <Kpi label="Facturación del mes" value={money(revenue)}/>
      <Kpi label="Gastos del mes" value={money(monthlyExpenses)}/>
      <Kpi label="Ganancia libre" value={money(netProfit)}/>
      <Kpi label="Listos / embalados" value={packed}/>
      <Kpi label="Stock para reponer" value={low}/>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h3>Capacidad de corte por día</h3><small>Máximo recomendado: {DAILY_PIECE_LIMIT} piezas = 9 planchas.</small></div><div className="row-actions"><button className="ghost" onClick={()=>go('calendar')}>Ver calendario</button><button className="ghost" onClick={()=>go('new')}>Agregar pedido</button></div></div>
      <div className="production-days">
        {productionByDate.map(([date,pieces])=>{const status=productionStatus(pieces); return <div className={'production-day '+status} key={date}>
          <div><b>{new Date(date+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'2-digit'})}</b><small>{sheetsForPieces(pieces)} planchas</small></div>
          <div className="day-capacity"><strong>{pieces} / {DAILY_PIECE_LIMIT}</strong><span>{status==='over'?`Exceso: ${pieces-DAILY_PIECE_LIMIT}`:status==='full'?'Día completo':`Libres: ${DAILY_PIECE_LIMIT-pieces}`}</span></div>
        </div>})}
        {!productionByDate.length&&<p className="empty-message">No hay fechas de entrega futuras cargadas.</p>}
      </div>
    </div>

        <div className="grid2">
      <div className="panel">
        <div className="panel-heading"><h3>Entregas de hoy</h3><button className="ghost" onClick={()=>go('orders')}>Ver todos</button></div>
        <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Piezas</th><th>Estado</th></tr></thead>
        <tbody>{todayOrders.slice().sort((a,b)=>String(a.number).localeCompare(String(b.number))).map(o=><tr key={o.id}><td>#{o.number}</td><td><b>{o.client}</b></td><td>{(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)}</td><td><Badge status={o.status}/></td></tr>)}</tbody></table>
        {!todayOrders.length&&<p className="empty-message">No hay pedidos programados para hoy.</p>}</div>
      </div>
      <div className="panel">
        <h3>Accesos rápidos</h3>
        <div className="quick">
          <button onClick={()=>go('orders')}>Buscar pedidos</button>
          <button onClick={()=>go('cut')}>Lista para cortar</button>
          <button onClick={()=>go('clients')}>Historial de clientes</button>
          <button onClick={()=>go('stock')}>Control de stock</button>
          <button onClick={()=>go('expenses')}>Registrar gastos</button>
          <button onClick={()=>go('monthly')}>Resumen mensual</button>
        </div>
      </div>
    </div>
    <div className="panel">
      <h3>Últimos pedidos cargados</h3>
      <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Entrega</th><th>Estado</th><th>Total</th></tr></thead>
      <tbody>{db.orders.slice().reverse().slice(0,10).map(o=><tr key={o.id}><td>#{o.number}</td><td>{o.client}</td><td>{o.delivery||'Sin fecha'}</td><td><Badge status={o.status}/></td><td>{money(o.total)}</td></tr>)}</tbody></table></div>
    </div>
  </>
}
