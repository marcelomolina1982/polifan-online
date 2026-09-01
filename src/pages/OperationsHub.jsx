import React,{useMemo} from 'react'
import {Title,Badge} from '../components/UI'
import {todayArgentinaISO,orderPieces} from '../lib/production'
import {dispatchGroups,productionColumns,packagingNeeds,normalizeDeliveryType} from '../lib/operations'
import {pendingCutPlan} from '../lib/cutPlanning'

function dateLabel(value){
  if(!value)return 'Sin fecha'
  const [y,m,d]=String(value).split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR',{weekday:'short',day:'2-digit',month:'2-digit'}).format(new Date(y,m-1,d))
}
function addDaysIso(iso,days){
  const [y,m,d]=iso.split('-').map(Number),date=new Date(y,m-1,d,12)
  date.setDate(date.getDate()+days)
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')
}

export default function OperationsHub({db,go}){
  const today=todayArgentinaISO(),end=addDaysIso(today,7)
  const cutGroups=useMemo(()=>pendingCutPlan(db).filter(g=>g.rows.length),[db])
  const columns=useMemo(()=>productionColumns(db),[db])
  const dispatch=useMemo(()=>dispatchGroups(db,today),[db,today])
  const boxes=useMemo(()=>packagingNeeds(db,{from:today,days:7}),[db,today])
  const active=useMemo(()=>(db.orders||[]).filter(o=>!['Cancelado','Entregado'].includes(o.status)),[db.orders])
  const todayOrders=active.filter(o=>o.delivery===today)
  const todayPieces=todayOrders.reduce((s,o)=>s+orderPieces(o),0)
  const pendingCutPieces=cutGroups.reduce((sum,g)=>sum+g.rows.reduce((s,r)=>s+Number(r.qty||0),0),0)
  const overdueGroups=cutGroups.filter(g=>g.overdue)
  const overdueOrderCount=new Set(overdueGroups.flatMap(g=>g.orders||[])).size
  const readyToday=todayOrders.filter(o=>String(o.status||'').toLowerCase().includes('listo')).length
  const upcoming=active.filter(o=>o.delivery&&o.delivery>=today&&o.delivery<=end).sort((a,b)=>String(a.delivery).localeCompare(String(b.delivery))||Number(a.number||0)-Number(b.number||0))
  const upcomingByDate=useMemo(()=>{
    const map=new Map()
    upcoming.forEach(o=>{
      if(!map.has(o.delivery))map.set(o.delivery,[])
      map.get(o.delivery).push(o)
    })
    return [...map.entries()].map(([date,orders])=>({date,orders,pieces:orders.reduce((s,o)=>s+orderPieces(o),0),ready:orders.filter(o=>String(o.status||'').toLowerCase().includes('listo')).length}))
  },[upcoming])

  return <>
    <Title title="Centro operativo" sub="Lo que realmente requiere atención hoy: entregas, corte pendiente, atrasados y próximos despachos." actions={<div className="actions"><button className="ghost" onClick={()=>go?.('orders')}>Ver pedidos</button><button className="ghost" onClick={()=>go?.('cut')}>Para cortar</button><button className="primary" onClick={()=>go?.('sheetplanner')}>Generar placas</button></div>}/>

    {overdueOrderCount>0&&<div className="notice" style={{borderColor:'#ef4444'}}><b>⚠ {overdueOrderCount} pedidos atrasados todavía activos</b><span>Siguen incluidos en la prioridad de corte hasta que estén Entregados o Cancelados.</span></div>}

    <div className="cards">
      <div className="kpi"><small>Entregas de hoy</small><b>{todayOrders.length} pedidos</b><span>{todayPieces} piezas</span></div>
      <div className="kpi"><small>Falta cortar real</small><b>{pendingCutPieces} piezas</b><span>Mismo cálculo que Para cortar y Motor</span></div>
      <div className="kpi"><small>Atrasados activos</small><b>{overdueOrderCount}</b><span>Pedidos que requieren prioridad</span></div>
      <div className="kpi"><small>Listos para hoy</small><b>{readyToday} / {todayOrders.length}</b><span>{columns.Corte.length} pedidos actualmente en corte</span></div>
    </div>

    <section className="panel">
      <div className="panel-heading"><div><h3>Prioridad de corte</h3><small>Sale de la misma fuente de verdad que usa Generar placas; no cuenta stock ya disponible ni piezas ya en corte.</small></div><button className="ghost" onClick={()=>go?.('cut')}>Ver detalle</button></div>
      <div className="delivery-groups">
        {cutGroups.slice(0,5).map(g=>{const pieces=g.rows.reduce((s,r)=>s+Number(r.qty||0),0);return <div className="dispatch-card" key={g.key}><small>{g.overdue?'⚠ ATRASADO':'ENTREGA'}</small><h4>{dateLabel(g.date)}</h4><b>{pieces} piezas a cortar</b><span className="block">Pedidos: {(g.orders||[]).map(n=>'#'+n).join(', ')||'-'}</span><span className="block">{g.rows.slice(0,4).map(r=>`${r.figure} × ${r.qty}`).join(' · ')}{g.rows.length>4?' · …':''}</span></div>})}
        {!cutGroups.length&&<div className="dash-empty"><b>No hay piezas pendientes para cortar.</b></div>}
      </div>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h3>Despachos de hoy</h3><small>Pedidos que tienen fecha de entrega hoy, separados por modalidad real.</small></div><button className="ghost" onClick={()=>window.print()}>Imprimir vista</button></div>
      <div className="dispatch-grid">{Object.entries(dispatch).map(([type,orders])=><div className="dispatch-card" key={type}><h4>{type}</h4><b>{orders.length} pedido{orders.length===1?'':'s'}</b>{orders.map(o=><div className="dispatch-order" key={o.id}><span><b>#{o.number} · {o.client}</b><small>{orderPieces(o)} piezas · {o.locality||o.province||''}</small></span><Badge status={o.status}/></div>)}</div>)}{!Object.keys(dispatch).length&&<div className="dash-empty"><b>No hay despachos para hoy.</b></div>}</div>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h3>Próximos 7 días</h3><small>Agenda real de entregas activas. Sirve para ver dónde se concentra el trabajo antes de que llegue la fecha.</small></div><button className="ghost" onClick={()=>go?.('calendar')}>Abrir calendario</button></div>
      <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Pedidos</th><th>Piezas</th><th>Listos</th><th>Modalidades</th></tr></thead><tbody>{upcomingByDate.map(row=><tr key={row.date}><td><b>{dateLabel(row.date)}</b></td><td>{row.orders.length}</td><td className="big">{row.pieces}</td><td>{row.ready} / {row.orders.length}</td><td>{[...new Set(row.orders.map(normalizeDeliveryType))].join(' · ')}</td></tr>)}{!upcomingByDate.length&&<tr><td colSpan="5">No hay entregas programadas para los próximos 7 días.</td></tr>}</tbody></table></div>
    </section>

    <section className="panel">
      <h3>Cajas necesarias para los próximos 7 días</h3>
      <small>Calculadas sólo para pedidos activos que requieren embalaje de envío.</small>
      <div className="table-wrap"><table><thead><tr><th>Embalaje</th><th>Cantidad necesaria</th></tr></thead><tbody>{boxes.map(row=><tr key={row.name}><td><b>{row.name}</b></td><td className="big">{row.qty}</td></tr>)}{!boxes.length&&<tr><td colSpan="2">No hay cajas previstas para los próximos 7 días.</td></tr>}</tbody></table></div>
    </section>
  </>
}
