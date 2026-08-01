export const PACKAGING_COST = 3000

export function orderPieces(order){
  return (order?.items||[]).reduce((sum,item)=>sum+Number(item.qty||0),0)
}

export function profitPerPiece(quantity){
  const qty=Number(quantity||0)
  if(qty<=0) return 0
  if(qty<=5) return 4900
  if(qty<=11) return 3100
  return 2300
}

export function estimatedOrderProfit(order){
  const pieces=orderPieces(order)
  const base=pieces*profitPerPiece(pieces)
  const packaging=order?.shippingPackaging==='Sí' ? PACKAGING_COST : 0
  return {pieces,perPiece:profitPerPiece(pieces),base,packaging,total:base-packaging}
}
