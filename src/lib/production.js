export const DAILY_PIECE_LIMIT = 90
export const PIECES_PER_SHEET = 10
export const orderPieces = order => (order?.items || []).reduce((sum,item)=>sum+Number(item.qty||0),0)
export const sheetsForPieces = pieces => Math.ceil(Math.max(0,Number(pieces)||0)/PIECES_PER_SHEET)
export const daysForPieces = pieces => Math.ceil(Math.max(0,Number(pieces)||0)/DAILY_PIECE_LIMIT)
export const isSunday = value => { const d=value instanceof Date?value:new Date(String(value).slice(0,10)+'T12:00:00'); return d.getDay()===0 }
export const localISO = d => { const x=new Date(d); x.setMinutes(x.getMinutes()-x.getTimezoneOffset()); return x.toISOString().slice(0,10) }
export function nextProductionDay(date){ const d=new Date(date); do{d.setDate(d.getDate()+1)}while(d.getDay()===0); return d }
export function addProductionDays(date,count){ let d=new Date(date); let remaining=Math.max(0,count); while(remaining>0){d=nextProductionDay(d);remaining--} return d }
export function estimateDeliveryRange(orders,newPieces,shipping=false){
  const pending=(orders||[]).filter(o=>!['Entregado','Cancelado'].includes(o.status)).reduce((s,o)=>s+orderPieces(o),0)
  const days=Math.max(1,Math.ceil((pending+Number(newPieces||0))/DAILY_PIECE_LIMIT))
  const start=addProductionDays(new Date(),days)
  const extra=shipping?2:1
  return {from:localISO(start),to:localISO(addProductionDays(start,extra)),pending,days}
}
export function piecesScheduledForDate(orders,date,excludeOrderId=null){
  if(!date) return 0
  return (orders||[]).filter(order=>order.delivery===date && order.id!==excludeOrderId && order.status!=='Cancelado').reduce((sum,order)=>sum+orderPieces(order),0)
}
export function productionStatus(pieces){ const v=Number(pieces)||0; if(v>DAILY_PIECE_LIMIT)return'over';if(v===DAILY_PIECE_LIMIT)return'full';if(v>=75)return'near';return'available' }
