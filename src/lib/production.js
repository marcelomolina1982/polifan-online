export const DAILY_PIECE_LIMIT = 120
export const PIECES_PER_SHEET = 10

export const orderPieces = order => (order?.items || []).reduce((sum,item)=>sum+Number(item.qty||0),0)
export const sheetsForPieces = pieces => Math.ceil(Math.max(0,Number(pieces)||0)/PIECES_PER_SHEET)
export const daysForPieces = pieces => Math.ceil(Math.max(0,Number(pieces)||0)/DAILY_PIECE_LIMIT)

export function piecesScheduledForDate(orders,date,excludeOrderId=null){
  if(!date) return 0
  return (orders||[])
    .filter(order=>order.delivery===date && order.id!==excludeOrderId && order.status!=='Cancelado')
    .reduce((sum,order)=>sum+orderPieces(order),0)
}

export function productionStatus(pieces){
  const value=Number(pieces)||0
  if(value>DAILY_PIECE_LIMIT) return 'over'
  if(value===DAILY_PIECE_LIMIT) return 'full'
  if(value>=90) return 'near'
  return 'available'
}
