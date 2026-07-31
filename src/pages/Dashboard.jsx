import React from 'react'
import { Title, Kpi, Badge } from '../components/UI'
import { money } from '../lib/format'
import { stockRows } from '../lib/inventory'

export default function Dashboard({db,go}){
  const active = db.orders.filter(o=>!['Entregado','Cancelado'].includes(o.status)).length
  const toCut = db.orders.filter(o=>['Ingresado','En diseño','Listo para cortar'].includes(o.status))
    .flatMap(o=>o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
  const month = new Date().getMonth()+1
  const year = new Date().getFullYear()
  const monthly = db.orders.filter(o=>{
    const d=new Date(o.date||o.createdAt)
    return d.getMonth()+1===month && d.getFullYear()===year && o.status!=='Cancelado'
  })
  const revenue=monthly.reduce((a,o)=>a+Number(o.total||0),0)
  const low=stockRows(db).filter(s=>s.total<=s.min).length

  return <>
    <Title title="Panel principal" sub="Resumen general de pedidos, cortes y stock." actions={<button className="primary" onClick={()=>go('new')}>＋ Nuevo pedido</button>}/>
    <div className="cards">
      <Kpi label="Pedidos activos" value={active}/>
      <Kpi label="Piezas para cortar" value={toCut}/>
      <Kpi label="Facturación del mes" value={money(revenue)}/>
      <Kpi label="Stock para reponer" value={low}/>
    </div>
    <div className="grid2">
      <div className="panel">
        <h3>Últimos pedidos</h3>
        <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Total</th></tr></thead>
        <tbody>{db.orders.slice().reverse().slice(0,8).map(o=><tr key={o.id}><td>#{o.number}</td><td>{o.client}</td><td><Badge status={o.status}/></td><td>{money(o.total)}</td></tr>)}</tbody></table></div>
      </div>
      <div className="panel">
        <h3>Accesos rápidos</h3>
        <div className="quick">
          <button onClick={()=>go('orders')}>Ver pedidos</button>
          <button onClick={()=>go('cut')}>Lista para cortar</button>
          <button onClick={()=>go('stock')}>Stock permanente</button>
          <button onClick={()=>go('monthly')}>Resumen mensual</button>
        </div>
      </div>
    </div>
  </>
}

