import React,{useMemo,useState} from 'react'
import Dashboard from './Dashboard'
import {Badge} from '../components/UI'
import {orderPieces,todayArgentinaISO,DAILY_PIECE_LIMIT} from '../lib/production'
import {stockRows} from '../lib/inventory'

export default function DashboardRefresh({db,go}){
  const [query,setQuery]=useState('')
  const today=todayArgentinaISO()
  const orders=db.orders||[]
  const todayOrders=orders.filter(o=>o.delivery===today&&o.status!=='Cancelado')
  const todayPieces=todayOrders.reduce((sum,o)=>sum+orderPieces(o),0)
  const overdue=orders.filter(o=>o.delivery&&o.delivery<today&&!['Cancelado','Entregado'].includes(o.status))
  const lowStock=stockRows(db).filter(row=>row.total<=row.min)
  const results=useMemo(()=>{
    const q=query.trim().toLocaleLowerCase('es')
    if(q.length<2)return[]
    return orders.filter(o=>[
      o.number,o.client,o.firstName,o.lastName,o.phone,o.dni,o.locality,
      ...(o.items||[]).map(i=>i.figure)
    ].filter(Boolean).join(' ').toLocaleLowerCase('es').includes(q)).slice(0,5)
  },[query,orders])
  const free=Math.max(0,DAILY_PIECE_LIMIT-todayPieces)
  return <>
    <section className="v25-topbar">
      <div className="v25-search">
        <span>⌕</span>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar pedido, cliente, teléfono, DNI o figura…"/>
        {query&&<button onClick={()=>setQuery('')}>×</button>}
      </div>
      {results.length>0&&<div className="v25-results">{results.map(o=><button key={o.id} onClick={()=>go('orders')}><div><b>#{o.number} · {o.client||[o.firstName,o.lastName].filter(Boolean).join(' ')||'Sin nombre'}</b><small>{orderPieces(o)} piezas · {o.delivery||'sin fecha de entrega'}</small></div><Badge status={o.status}/></button>)}</div>}
    </section>

    <section className="v25-focus">
      <button className="v25-focus-card primary" onClick={()=>go('cut')}><span>✂</span><div><small>PRODUCCIÓN</small><b>Preparar corte</b><em>Ir directo a piezas pendientes</em></div><i>›</i></button>
      <button className="v25-focus-card" onClick={()=>go('sheetplanner')}><span>⚙</span><div><small>MOTOR</small><b>Generar placas</b><em>Smart-4 listo para trabajar</em></div><i>›</i></button>
      <button className="v25-focus-card" onClick={()=>go('operations')}><span>📦</span><div><small>HOY</small><b>{todayOrders.length} despachos</b><em>{todayPieces} piezas programadas</em></div><i>›</i></button>
      <button className="v25-focus-card" onClick={()=>go('stock')}><span>◇</span><div><small>INVENTARIO</small><b>{lowStock.length?`${lowStock.length} alertas`:'Stock en orden'}</b><em>Control de piezas disponibles</em></div><i>›</i></button>
    </section>

    {(overdue.length>0||todayPieces>=80)&&<section className="v25-alerts">
      {overdue.length>0&&<button className="danger" onClick={()=>go('orders')}><span>⏰</span><div><b>{overdue.length} pedido{overdue.length===1?'':'s'} con fecha vencida</b><small>Revisar estado o nueva fecha de entrega</small></div><i>›</i></button>}
      {todayPieces>=80&&<button className="warning" onClick={()=>go('calendar')}><span>⚠</span><div><b>Capacidad de hoy: {todayPieces}/{DAILY_PIECE_LIMIT}</b><small>{todayPieces>DAILY_PIECE_LIMIT?`Exceso de ${todayPieces-DAILY_PIECE_LIMIT} piezas`:`Quedan ${free} lugares disponibles`}</small></div><i>›</i></button>}
    </section>}

    <Dashboard db={db} go={go}/>
  </>
}
