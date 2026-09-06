import { pendingCutByDelivery } from './inventory'

// La planificación de corte debe conservar el componente que realmente falta
// (figura completa, tapa o base). inventory.pendingCutByDelivery es la fuente
// de verdad porque también reserva el stock cronológicamente entre pedidos.
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
