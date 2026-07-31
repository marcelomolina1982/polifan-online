export function pricePerUnit(qty){
  if(qty <= 5) return 6000
  if(qty <= 11) return 25000/6
  return 40000/12
}

export function money(n){
  return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n||0)
}

export function today(){
  return new Date().toISOString().slice(0,10)
}
