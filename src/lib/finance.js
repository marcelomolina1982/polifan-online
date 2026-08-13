export const SHEET_COST = 8233
export const FIGURES_PER_SHEET = 10
export const MATERIAL_COST_PER_FIGURE = SHEET_COST / FIGURES_PER_SHEET
export const LABOR_COST_PER_FIGURE = 300
export const GLUE_CONTAINER_COST = 8200
export const GLUE_YIELD_FIGURES = 100
export const GLUE_COST_PER_FIGURE = GLUE_CONTAINER_COST / GLUE_YIELD_FIGURES
export const PRODUCTION_COST_PER_FIGURE = MATERIAL_COST_PER_FIGURE + LABOR_COST_PER_FIGURE + GLUE_COST_PER_FIGURE

export const PACKAGING_OPTIONS = [
  {key:'30x20x20',name:'Caja 30×20×20 cm',capacity:6,boxCost:1500,bubbleCost:372.36,packingTapeCost:84.48,blackFilmCost:249.94,fragileTapeCost:72.72,totalCost:2279.50},
  {key:'40x30x30',name:'Caja 40×30×30 cm',capacity:12,boxCost:1700,bubbleCost:768.00,packingTapeCost:114.45,blackFilmCost:349.91,fragileTapeCost:105.04,totalCost:3037.40},
  {key:'50x40x30',name:'Caja 50×40×30 cm',capacity:24,boxCost:2100,bubbleCost:1093.82,packingTapeCost:138.98,blackFilmCost:399.90,fragileTapeCost:121.20,totalCost:3853.89},
  {key:'50x40x40',name:'Caja 50×40×40 cm',capacity:36,boxCost:2100,bubbleCost:1303.27,packingTapeCost:144.43,blackFilmCost:449.89,fragileTapeCost:137.36,totalCost:4134.95},
  {key:'60x40x40',name:'Caja 60×40×40 cm',capacity:48,boxCost:2500,bubbleCost:1489.45,packingTapeCost:168.95,blackFilmCost:499.88,fragileTapeCost:145.44,totalCost:4803.72}
]
export const PACKAGING_COST = PACKAGING_OPTIONS.find(x=>x.key==='40x30x30').totalCost

export function financeConfig(settings={}){
  const sheetCost=Number(settings.sheetCost??SHEET_COST),figuresPerSheet=Math.max(1,Number(settings.figuresPerSheet??FIGURES_PER_SHEET)),laborPerFigure=Number(settings.laborPerFigure??LABOR_COST_PER_FIGURE),glueContainerCost=Number(settings.glueContainerCost??GLUE_CONTAINER_COST),glueYieldFigures=Math.max(1,Number(settings.glueYieldFigures??GLUE_YIELD_FIGURES))
  const materialPerFigure=sheetCost/figuresPerSheet,gluePerFigure=glueContainerCost/glueYieldFigures,productionPerFigure=materialPerFigure+laborPerFigure+gluePerFigure
  return {sheetCost,figuresPerSheet,laborPerFigure,glueContainerCost,glueYieldFigures,materialPerFigure,gluePerFigure,productionPerFigure,boxes:settings.boxes||{}}
}
export function orderPieces(order){return (order?.items||[]).filter(item=>item?.inventoryTracked!==false&&item?.manualItem!==true).reduce((sum,item)=>sum+Number(item.qty||0),0)}
export function singlePackagingFor(quantity){const qty=Math.max(0,Number(quantity)||0);return PACKAGING_OPTIONS.find(box=>qty<=box.capacity)||PACKAGING_OPTIONS[PACKAGING_OPTIONS.length-1]}
export function packagingForPieces(quantity,settings={}){
  let remaining=Math.max(0,Number(quantity)||0);if(!remaining)return {parts:[],summary:'Sin caja asignada',total:0}
  const boxes=PACKAGING_OPTIONS.map(box=>({...box,totalCost:Number(settings?.boxes?.[box.key]??box.totalCost)})),parts=[]
  while(remaining>48){const box=boxes[boxes.length-1];parts.push({...box,qty:1});remaining-=48}
  if(remaining>0){const base=singlePackagingFor(remaining);const box=boxes.find(x=>x.key===base.key)||base;parts.push({...box,qty:1})}
  const grouped=[];parts.forEach(part=>{const found=grouped.find(x=>x.key===part.key);if(found)found.qty+=1;else grouped.push({...part})})
  const total=grouped.reduce((sum,part)=>sum+(part.totalCost*part.qty),0),summary=grouped.map(part=>`${part.qty>1?part.qty+' × ':''}${part.name}`).join(' + ')
  return {parts:grouped,summary,total}
}
export function profitPerPiece(quantity,orderTotal=0,settings={}){const qty=Number(quantity||0);if(qty<=0)return 0;const cfg=financeConfig(settings),revenue=Number(orderTotal||0);if(revenue>0)return(revenue/qty)-cfg.productionPerFigure;const salePerPiece=qty<=5?6000:qty<=11?(25000/6):(40000/12);return salePerPiece-cfg.productionPerFigure}
export function estimatedOrderProfit(order,settings={}){
  const cfg=financeConfig(settings),pieces=orderPieces(order),revenue=Math.max(0,Number(order?.total||0)),materialCost=pieces*cfg.materialPerFigure,laborCost=pieces*cfg.laborPerFigure,glueCost=pieces*cfg.gluePerFigure,productionCost=materialCost+laborCost+glueCost,base=revenue-productionCost
  const packagingDetail=order?.shippingPackaging==='Sí'?packagingForPieces(pieces,settings):{parts:[],summary:'Sin embalaje',total:0},packaging=packagingDetail.total
  return {pieces,revenue,perPiece:profitPerPiece(pieces,revenue,settings),materialCost,laborCost,glueCost,productionCost,base,packaging,packagingDetail,total:base-packaging}
}
