import { pendingCutByDelivery, normalizeFigureKey, manualBalance, looseComponentBalance, activeCutQty } from './inventory'

// Snapshot usado por Lista de corte/auditoría. Se conserva separado de la
// planificación por componentes para no volver a colapsar tapa/base/completo.
export function productionStockSnapshot(db){
  const raw=manualBalance(db)
  const loose=looseComponentBalance(db)
  const inCut=activeCutQty(db)
  const labels={}
  const rows={}
  const names=new Set([...Object.keys(raw),...Object.keys(loose),...Object.keys(inCut)])
  names.forEach(name=>{
    const key=normalizeFigureKey(name)
    if(!key)return
    if(!labels[key])labels[key]=String(name).trim()
    if(!rows[key])rows[key]={key,figure:labels[key],physical:0,inCut:0}
    const paired=Math.min(Number(loose[name]?.tapa||0),Number(loose[name]?.base||0))
    rows[key].physical+=Math.max(0,Number(raw[name]||0)+paired)
    rows[key].inCut+=Math.max(0,Number(inCut[name]||0))
  })
  return Object.values(rows)
}

// La planificación de corte conserva el componente que realmente falta
// (figura completa, tapa o base) y reserva stock cronológicamente.
export function pendingCutPlan(db){
  return pendingCutByDelivery(db).map(group=>({
    ...group,
    overdue:false,
    auditRows:[],
    rows:(group.rows||[]).map(row=>({
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
