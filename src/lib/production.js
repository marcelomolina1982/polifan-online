export const DAILY_PIECE_LIMIT = 90
export const PIECES_PER_SHEET = 10
export const orderPieces = order => (order?.items || []).reduce((sum,item)=>sum+Number(item.qty||0),0)
export const sheetsForPieces = pieces => Math.ceil(Math.max(0,Number(pieces)||0)/PIECES_PER_SHEET)
export const daysForPieces = pieces => Math.ceil(Math.max(0,Number(pieces)||0)/DAILY_PIECE_LIMIT)
export const isSunday = value => { const d=value instanceof Date?value:new Date(String(value).slice(0,10)+'T12:00:00'); return d.getDay()===0 }
export const localISO = d => { const x=new Date(d); x.setMinutes(x.getMinutes()-x.getTimezoneOffset()); return x.toISOString().slice(0,10) }
export const dateFromISO = value => new Date(String(value).slice(0,10)+'T12:00:00')
export function nextProductionDay(date){ const d=new Date(date); do{d.setDate(d.getDate()+1)}while(d.getDay()===0); return d }
export function addProductionDays(date,count){ let d=new Date(date); let remaining=Math.max(0,count); while(remaining>0){d=nextProductionDay(d);remaining--} return d }
export function piecesScheduledForDate(orders,date,excludeOrderId=null){
  if(!date) return 0
  return (orders||[]).filter(order=>order.delivery===date && order.id!==excludeOrderId && order.status!=='Cancelado').reduce((sum,order)=>sum+orderPieces(order),0)
}
export function latestClosedProductionDate(closedDates=[]){
  const valid=(closedDates||[]).filter(Boolean).sort()
  return valid.length?valid[valid.length-1]:''
}
export function isProductionClosed(date,closedDates=[]){ return (closedDates||[]).includes(date) }
export function nextOpenProductionDate(date,closedDates=[]){
  let d=new Date(date)
  do{d=nextProductionDay(d)}while(isProductionClosed(localISO(d),closedDates))
  return d
}
function normalizeOpenDate(date,closedDates=[]){
  let d=new Date(date)
  if(d.getDay()===0) d=nextProductionDay(d)
  while(isProductionClosed(localISO(d),closedDates)) d=nextOpenProductionDate(d,closedDates)
  return d
}
function firstPlanningDate(closedDates=[]){
  const today=dateFromISO(localISO(new Date()))
  const lastClosed=latestClosedProductionDate(closedDates)
  if(!lastClosed) return normalizeOpenDate(today,closedDates)
  const afterClosed=nextOpenProductionDate(dateFromISO(lastClosed),closedDates)
  return normalizeOpenDate(afterClosed>today?afterClosed:today,closedDates)
}
function moveSundayToMonday(date){
  const d=new Date(date)
  if(d.getDay()===0) d.setDate(d.getDate()+1)
  return d
}
function deliveryWindowAfter72Hours(lastProductionDate){
  const start=dateFromISO(lastProductionDate)
  start.setDate(start.getDate()+3)
  const normalizedStart=moveSundayToMonday(start)
  const end=new Date(normalizedStart)
  end.setDate(end.getDate()+2)
  const normalizedEnd=moveSundayToMonday(end)
  return {start:localISO(normalizedStart),end:localISO(normalizedEnd)}
}
/**
 * Motor único de planificación usado por el catálogo, WhatsApp y solicitudes web.
 * - Parte del primer día abierto posterior al último cierre manual (nunca antes de hoy).
 * - Usa el espacio libre real de cada fecha hasta 90 piezas.
 * - Omite domingos y fechas cerradas.
 * - La entrega aproximada comienza 72 horas calendario después del último día de corte.
 * - Muestra una ventana de tres días: por ejemplo, martes a jueves.
 */
export function estimateDeliveryRange(orders,newPieces,shipping=false,closedDates=[]){
  const closed=[...new Set(closedDates||[])].filter(Boolean).sort()
  const lastClosed=latestClosedProductionDate(closed)
  let cursor=firstPlanningDate(closed)
  let remaining=Math.max(0,Number(newPieces)||0)
  let lastProductionDate=localISO(cursor)
  let safety=0

  while(remaining>0 && safety<730){
    safety++
    const date=localISO(cursor)
    if(cursor.getDay()!==0 && !isProductionClosed(date,closed)){
      const used=piecesScheduledForDate(orders,date)
      const available=Math.max(0,DAILY_PIECE_LIMIT-used)
      if(available>0){
        remaining-=Math.min(available,remaining)
        lastProductionDate=date
      }
    }
    if(remaining>0) cursor=nextOpenProductionDate(cursor,closed)
  }

  const deliveryWindow=deliveryWindowAfter72Hours(lastProductionDate)
  return {
    from:lastProductionDate,
    to:deliveryWindow.end,
    productionDate:lastProductionDate,
    deliveryDate:deliveryWindow.start,
    deliveryTo:deliveryWindow.end,
    lastClosed,
    pending:(orders||[]).filter(o=>!['Entregado','Cancelado'].includes(o.status)).reduce((s,o)=>s+orderPieces(o),0)
  }
}
export function productionStatus(pieces){ const v=Number(pieces)||0; if(v>DAILY_PIECE_LIMIT)return'over';if(v===DAILY_PIECE_LIMIT)return'full';if(v>=75)return'near';return'available' }
