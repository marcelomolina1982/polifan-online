import React from 'react'
import { estimatedOrderProfit } from '../lib/finance'
import { money } from '../lib/format'

export default function OrdersFinance({db}){
  const rows=(db.orders||[])
    .filter(o=>o.status!=='Cancelado')
    .slice()
    .sort((a,b)=>String(a.delivery||'9999-12-31').localeCompare(String(b.delivery||'9999-12-31')) || String(b.number||'').localeCompare(String(a.number||'')))

  if(!rows.length) return null

  return <div className="panel table-wrap">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:12,flexWrap:'wrap'}}>
      <div>
        <h3 style={{margin:'0 0 4px'}}>Rentabilidad interna por pedido</h3>
        <small style={{color:'#667085'}}>Solo visible en administración. No se incluye en comprobantes ni etiquetas del cliente.</small>
      </div>
    </div>
    <table>
      <thead><tr><th>Pedido</th><th>Cliente</th><th>Piezas</th><th>Caja / embalaje</th><th>Costo producción</th><th>Costo embalaje</th><th>Venta</th><th>Ganancia</th></tr></thead>
      <tbody>{rows.map(o=>{
        const p=estimatedOrderProfit(o)
        return <tr key={o.id}>
          <td><b>#{o.number}</b><small className="block">{o.delivery||'Sin fecha'}</small></td>
          <td><b>{o.client}</b></td>
          <td>{p.pieces}</td>
          <td><b>{p.packagingDetail.summary}</b></td>
          <td>{money(p.productionCost)}</td>
          <td>{p.packaging?money(p.packaging):'—'}</td>
          <td>{money(p.revenue)}</td>
          <td><b className={p.total<0?'red-text':'green-text'}>{money(p.total)}</b></td>
        </tr>
      })}</tbody>
    </table>
  </div>
}
