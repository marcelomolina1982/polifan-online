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
function deliveryAfter48Hours(lastProductionDate){
  const due=dateFromISO(lastProductionDate)
  due.setDate(due.getDate()+2)
  if(due.getDay()===0) due.setDate(due.getDate()+1)
  return localISO(due)
}
/**
 * Calcula el último día necesario de producción para una solicitud nueva.
 * - Comienza después del último día cerrado, o desde hoy si todavía no se cerró ninguno.
 * - Nunca usa domingos ni fechas cerradas.
 * - Respeta las piezas ya programadas y el límite diario.
 * - La entrega estimada queda hasta 48 horas después del último día de corte.
 */
export function estimateDeliveryRange(orders,newPieces,shipping=false,closedDates=[]){
  const closed=closedDates||[]
  const lastClosed=latestClosedProductionDate(closed)
  const today=localISO(new Date())
  let cursor
  if(lastClosed){
    cursor=nextOpenProductionDate(dateFromISO(lastClosed),closed)
  }else{
    cursor=dateFromISO(today)
    if(cursor.getDay()===0 || isProductionClosed(localISO(cursor),closed)) cursor=nextOpenProductionDate(cursor,closed)
  }

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
        const assigned=Math.min(available,remaining)
        remaining-=assigned
        lastProductionDate=date
      }
    }
    if(remaining>0) cursor=nextOpenProductionDate(cursor,closed)
  }

  if(Number(newPieces||0)<=0) lastProductionDate=localISO(cursor)
  const due=deliveryAfter48Hours(lastProductionDate)
  return {
    from:lastProductionDate,
    to:due,
    productionDate:lastProductionDate,
    deliveryDate:due,
    lastClosed,
    pending:(orders||[]).filter(o=>!['Entregado','Cancelado'].includes(o.status)).reduce((s,o)=>s+orderPieces(o),0)
  }
}
export function productionStatus(pieces){ const v=Number(pieces)||0; if(v>DAILY_PIECE_LIMIT)return'over';if(v===DAILY_PIECE_LIMIT)return'full';if(v>=75)return'near';return'available' }
