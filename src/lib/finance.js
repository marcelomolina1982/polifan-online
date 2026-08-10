export const SHEET_COST = 8233
export const FIGURES_PER_SHEET = 10
export const MATERIAL_COST_PER_FIGURE = SHEET_COST / FIGURES_PER_SHEET
export const LABOR_COST_PER_FIGURE = 300
export const GLUE_CONTAINER_COST = 9800
export const GLUE_YIELD_FIGURES = 200
export const GLUE_COST_PER_FIGURE = GLUE_CONTAINER_COST / GLUE_YIELD_FIGURES
export const PRODUCTION_COST_PER_FIGURE = MATERIAL_COST_PER_FIGURE + LABOR_COST_PER_FIGURE + GLUE_COST_PER_FIGURE

// Costos de embalaje calculados con los consumos informados para la caja 40×30×30:
// burbuja $16.000 / 25 m²; cinta común $1.090 / 40 m;
// film negro $19.995 / 160 m; cinta FRÁGIL $1.616 / 40 m.
// Para los demás tamaños, la burbuja escala por superficie de caja y las cintas/film
// escalan por los recorridos geométricos equivalentes.
export const PACKAGING_OPTIONS = [
  {key:'30x20x20',name:'Caja 30×20×20 cm',capacity:6,boxCost:1500,bubbleCost:372.36,packingTapeCost:84.48,blackFilmCost:249.94,fragileTapeCost:72.72,totalCost:2279.50},
  {key:'40x30x30',name:'Caja 40×30×30 cm',capacity:12,boxCost:1700,bubbleCost:768.00,packingTapeCost:114.45,blackFilmCost:349.91,fragileTapeCost:105.04,totalCost:3037.40},
  {key:'50x40x30',name:'Caja 50×40×30 cm',capacity:24,boxCost:2100,bubbleCost:1093.82,packingTapeCost:138.98,blackFilmCost:399.90,fragileTapeCost:121.20,totalCost:3853.89},
  {key:'50x40x40',name:'Caja 50×40×40 cm',capacity:36,boxCost:2100,bubbleCost:1303.27,packingTapeCost:144.43,blackFilmCost:449.89,fragileTapeCost:137.36,totalCost:4134.95},
  {key:'60x40x40',name:'Caja 60×40×40 cm',capacity:48,boxCost:2500,bubbleCost:1489.45,packingTapeCost:168.95,blackFilmCost:499.88,fragileTapeCost:145.44,totalCost:4803.72}
]

// Compatibilidad con pantallas viejas que todavía importen PACKAGING_COST.
export const PACKAGING_COST = PACKAGING_OPTIONS.find(x=>x.key==='40x30x30').totalCost

export function orderPieces(order){
  return (order?.items||[]).reduce((sum,item)=>sum+Number(item.qty||0),0)
}

export function singlePackagingFor(quantity){
  const qty=Math.max(0,Number(quantity)||0)
  return PACKAGING_OPTIONS.find(box=>qty<=box.capacity)||PACKAGING_OPTIONS[PACKAGING_OPTIONS.length-1]
}

export function packagingForPieces(quantity){
  let remaining=Math.max(0,Number(quantity)||0)
  if(!remaining) return {parts:[],summary:'Sin caja asignada',total:0}
  const parts=[]
  while(remaining>48){
    const box=PACKAGING_OPTIONS[PACKAGING_OPTIONS.length-1]
    parts.push({...box,qty:1})
    remaining-=48
  }
  if(remaining>0) parts.push({...singlePackagingFor(remaining),qty:1})
  const grouped=[]
  parts.forEach(part=>{
    const found=grouped.find(x=>x.key===part.key)
    if(found) found.qty+=1
    else grouped.push({...part})
  })
  const total=grouped.reduce((sum,part)=>sum+(part.totalCost*part.qty),0)
  const summary=grouped.map(part=>`${part.qty>1?part.qty+' × ':''}${part.name}`).join(' + ')
  return {parts:grouped,summary,total}
}

export function profitPerPiece(quantity,orderTotal=0){
  const qty=Number(quantity||0)
  if(qty<=0) return 0
  const revenue=Number(orderTotal||0)
  if(revenue>0) return (revenue/qty)-PRODUCTION_COST_PER_FIGURE
  // Respaldo para registros viejos sin total: precios comerciales vigentes por escala.
  const salePerPiece=qty<=5?6000:qty<=11?(25000/6):(40000/12)
  return salePerPiece-PRODUCTION_COST_PER_FIGURE
}

export function estimatedOrderProfit(order){
  const pieces=orderPieces(order)
  const revenue=Math.max(0,Number(order?.total||0))
  const productionCost=pieces*PRODUCTION_COST_PER_FIGURE
  const base=(revenue||0)-productionCost
  const packagingDetail=order?.shippingPackaging==='Sí' ? packagingForPieces(pieces) : {parts:[],summary:'Sin embalaje',total:0}
  const packaging=packagingDetail.total
  return {
    pieces,
    revenue,
    perPiece:profitPerPiece(pieces,revenue),
    materialCost:pieces*MATERIAL_COST_PER_FIGURE,
    laborCost:pieces*LABOR_COST_PER_FIGURE,
    glueCost:pieces*GLUE_COST_PER_FIGURE,
    productionCost,
    base,
    packaging,
    packagingDetail,
    total:base-packaging
  }
}
