import { normalizeFigureKey, physicalStockBalance, activeCutQty } from './inventory'
import { todayArgentinaISO } from './production'

function orderDate(order){return String(order?.delivery||'').slice(0,10)}
export function isActiveProductionOrder(order,today=todayArgentinaISO()){
  if(!order||['Cancelado','Entregado'].includes(order.status))return false
  const date=orderDate(order)
  return !date||date>=today
}

export function productionStockSnapshot(db){
  const physical=physicalStockBalance(db)
  const inCut=activeCutQty(db)
  const labels={}
  const rows={}
  const names=new Set([...Object.keys(physical),...Object.keys(inCut)])

  names.forEach(name=>{
    const key=normalizeFigureKey(name)
    if(!key)return
    if(!labels[key])labels[key]=String(name).trim()
    if(!rows[key])rows[key]={key,figure:labels[key],physical:0,inCut:0}
    rows[key].physical+=Math.max(0,Number(physical[name]||0))
    rows[key].inCut+=Math.max(0,Number(inCut[name]||0))
  })

  return Object.values(rows)
}

export function pendingCutPlan(db){
  const today=todayArgentinaISO()
  const snapshot=productionStockSnapshot(db)
  const available={}
  const labels={}
  const activeOrders=(db.orders||[]).filter(order=>isActiveProductionOrder(order,today))

  snapshot.forEach(row=>{
    available[row.key]=(available[row.key]||0)+Number(row.physical||0)+Number(row.inCut||0)
    if(!labels[row.key])labels[row.key]=row.figure
  })

  // Producción operativa: sólo entregas de hoy en adelante.
  // El inventario disponible se reserva cronológicamente; una pieza sólo cubre un pedido.
  const groups={}
  activeOrders
    .slice()
    .sort((a,b)=>(orderDate(a)||'9999-12-31').localeCompare(orderDate(b)||'9999-12-31')||String(a.number||'').localeCompare(String(b.number||'')))
    .forEach(order=>{
      const date=orderDate(order)
      const key=date||'sin-fecha'
      if(!groups[key])groups[key]={key,date,overdue:false,orders:[],rows:{},audit:{}}
      groups[key].orders.push(order.number)
      ;(order.items||[]).forEach(item=>{
        if(!item?.figure||item.inventoryTracked===false||Number(item.qty||0)<=0)return
        const figureKey=normalizeFigureKey(item.figure)
        if(!figureKey)return
        const figure=labels[figureKey]||String(item.figure).trim()
        if(!labels[figureKey])labels[figureKey]=figure
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
