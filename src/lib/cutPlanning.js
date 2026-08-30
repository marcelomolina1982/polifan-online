import { normalizeFigureKey, stockRows } from './inventory'
import { todayArgentinaISO } from './production'

function orderDate(order){return String(order?.delivery||'').slice(0,10)}
export function isActiveProductionOrder(order){return Boolean(order)&&!['Cancelado','Entregado'].includes(order.status)}

export function pendingCutPlan(db){
  const today=todayArgentinaISO()
  const inventoryRows=stockRows(db)
  const available={}
  const labels={}
  const activeOrders=(db.orders||[]).filter(isActiveProductionOrder)
  const overdueOrders=activeOrders.filter(o=>orderDate(o)&&orderDate(o)<today)

  inventoryRows.forEach(row=>{
    const key=normalizeFigureKey(row.figure)
    if(!key)return
    // Lo que ya existe físicamente o ya está efectivamente en corte no debe volver a cortarse.
    available[key]=(available[key]||0)+Math.max(0,Number(row.cut||0))+Math.max(0,Number(row.inCut||0))
    if(!labels[key])labels[key]=row.figure
  })

  // stockRows mantiene la compatibilidad histórica descontando pedidos vencidos del físico.
  // Para planificar producción, un pedido vencido ACTIVO sigue pendiente: restauramos esa
  // demanda antes de reservar todos los pedidos cronológicamente.
  overdueOrders.forEach(order=>{
    ;(order.items||[]).forEach(item=>{
      if(!item?.figure||item.inventoryTracked===false||Number(item.qty||0)<=0)return
      const key=normalizeFigureKey(item.figure)
      if(!key)return
      available[key]=(available[key]||0)+Number(item.qty||0)
      if(!labels[key])labels[key]=String(item.figure).trim()
    })
  })

  const groups={}
  activeOrders
    .slice()
    .sort((a,b)=>(orderDate(a)||'9999-12-31').localeCompare(orderDate(b)||'9999-12-31')||String(a.number||'').localeCompare(String(b.number||'')))
    .forEach(order=>{
      const date=orderDate(order)
      const key=date||'sin-fecha'
      if(!groups[key])groups[key]={key,date,overdue:Boolean(date&&date<today),orders:[],rows:{},audit:{}}
      groups[key].orders.push(order.number)
      ;(order.items||[]).forEach(item=>{
        if(!item?.figure||item.inventoryTracked===false||Number(item.qty||0)<=0)return
        const figureKey=normalizeFigureKey(item.figure)
        if(!figureKey)return
        const figure=labels[figureKey]||String(item.figure).trim()
        const qty=Math.max(0,Number(item.qty||0))
        const before=Math.max(0,Number(available[figureKey]||0))
        const covered=Math.min(before,qty)
        available[figureKey]=before-covered
        const pending=qty-covered
        if(!groups[key].audit[figureKey])groups[key].audit[figureKey]={figure,ordered:0,covered:0,pending:0,stockBefore:before}
        const audit=groups[key].audit[figureKey]
        audit.ordered+=qty
        audit.covered+=covered
        audit.pending+=pending
        if(pending>0)groups[key].rows[figure]=(groups[key].rows[figure]||0)+pending
      })
    })

  return Object.values(groups)
    .map(group=>({
      key:group.key,
      date:group.date,
      overdue:group.overdue,
      orders:[...new Set(group.orders)].filter(Boolean),
      rows:Object.entries(group.rows).map(([figure,qty])=>({figure,qty:Number(qty||0)})).filter(row=>row.qty>0).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'})),
      auditRows:Object.values(group.audit).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'})),
    }))
    .filter(group=>group.rows.length||group.auditRows.length)
    .sort((a,b)=>(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31'))
}

export function pendingCutRowsUnified(db){
  const totals={}
  pendingCutPlan(db).forEach(group=>group.rows.forEach(row=>{totals[row.figure]=(totals[row.figure]||0)+Number(row.qty||0)}))
  return Object.entries(totals).map(([figure,pending])=>({figure,pending})).filter(row=>row.pending>0).sort((a,b)=>b.pending-a.pending)
}
