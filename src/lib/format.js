export function pricePerUnit(qty){
  if(qty <= 5) return 6000
  if(qty <= 11) return 25000/6
  return 40000/12
}

export function regularOrderTotal(qty){
  const quantity = Number(qty) || 0
  if(quantity <= 0) return 0
  if(quantity <= 5) return quantity * 6000
  if(quantity <= 11) return 25000 + (quantity - 6) * (25000/6)
  return 40000 + (quantity - 12) * (40000/12)
}

export function money(n){
  return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n||0)
}

export function today(){
  return new Date().toISOString().slice(0,10)
}
