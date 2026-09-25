import { pendingCutByDelivery, normalizeFigureKey, physicalStockBalance, activeCutQty } from './inventory.js'
import { todayArgentinaISO } from './production.js'

// Snapshot usado por Lista de corte/auditoría. Se conserva separado de la
// planificación por componentes para no volver a colapsar tapa/base/completo.
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

function orderAlreadyLeftProduction(order){
  const stage=String(order?.journey?.stage||'').trim().toLowerCase()
  return stage==='dispatched'||Boolean(order?.journey?.dispatchedAt)||Boolean(order?.journey?.finalAt)
}

function dbForCutPlanning(db){
  // Un pedido despachado ya consumió físicamente sus piezas. Algunos pedidos
  // históricos conservan status="Ingresado" aunque journey ya esté despachado;
  // si se los deja así, Para cortar vuelve a pedir esas mismas figuras.
  return {
    ...db,
    orders:(db.orders||[]).map(order=>
      orderAlreadyLeftProduction(order)&&order.status!=='Cancelado'
        ? {...order,status:'Entregado'}
        : order
    )
  }
}

function auditRowsForGroup(group){
  const byFigure={}
  ;(group.rows||[]).forEach(row=>{
    const figure=String(row.figure||'').trim()
    const key=normalizeFigureKey(figure)
    if(!key)return
    if(!byFigure[key])byFigure[key]={figure,ordered:0,covered:0,pending:0}
    const pending=Math.max(0,Number(row.qty||row.pending||0))
    const orderedRaw=Number(row.ordered)
    const coveredRaw=Number(row.covered)
    byFigure[key].pending+=pending
    if(Number.isFinite(orderedRaw))byFigure[key].ordered+=Math.max(0,orderedRaw)
    if(Number.isFinite(coveredRaw))byFigure[key].covered+=Math.max(0,coveredRaw)
  })
  return Object.values(byFigure).map(row=>{
    // pendingCutByDelivery puede entregar ordered/covered en la fila. Si una
    // versión anterior no los entrega, no inventamos stock: mostramos al menos
    // el faltante real que originó la lista de corte.
    if(row.ordered===0&&row.covered===0)row.ordered=row.pending
    else if(row.ordered===0)row.ordered=row.covered+row.pending
    else if(row.covered===0)row.covered=Math.max(0,row.ordered-row.pending)
    return row
  }).sort((a,b)=>b.pending-a.pending||a.figure.localeCompare(b.figure,'es',{sensitivity:'base'}))
}

// La planificación de corte conserva el componente que realmente falta
// (figura completa, tapa o base) y reserva stock cronológicamente.
export function pendingCutPlan(db){
  const today=todayArgentinaISO()
  const planningDb=dbForCutPlanning(db)
  return pendingCutByDelivery(planningDb).map(group=>({
    ...group,
    overdue:Boolean(group.date&&group.date<today),
    auditRows:auditRowsForGroup(group),
    rows:(group.rows||[]).map(row=>({
      ...row,
      figure:row.figure,
      qty:Number(row.qty||0),
      component:row.component||'complete'
    }))
  }))
}

export function pendingCutRowsUnified(db){
  const totals={}
  pendingCutPlan(db).forEach(group=>group.rows.forEach(row=>{
    const component=row.component||'complete'
    const key=`${row.figure}|${component}`
    if(!totals[key])totals[key]={figure:row.figure,component,pending:0}
    totals[key].pending+=Number(row.qty||0)
  }))
  return Object.values(totals)
    .filter(row=>row.pending>0)
    .sort((a,b)=>b.pending-a.pending||a.figure.localeCompare(b.figure,'es',{sensitivity:'base'}))
}
