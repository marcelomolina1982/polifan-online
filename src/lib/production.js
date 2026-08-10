export const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'
export const DAILY_PIECE_LIMIT = 90
export const PIECES_PER_SHEET = 10

export const orderPieces = order => (order?.items || []).filter(item=>item?.inventoryTracked!==false && item?.manualItem!==true).reduce((sum,item)=>sum+Number(item.qty||0),0)
export const sheetsForPieces = pieces => Math.ceil(Math.max(0,Number(pieces)||0)/PIECES_PER_SHEET)
export const daysForPieces = pieces => Math.ceil(Math.max(0,Number(pieces)||0)/DAILY_PIECE_LIMIT)

function argentinaParts(value=new Date()){
  const date=value instanceof Date?value:new Date(value)
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:ARGENTINA_TIME_ZONE,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(date)
  return Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,part.value]))
}

export function argentinaNow(){
  const p=argentinaParts(new Date())
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,compactDate:`${p.year.slice(-2)}${p.month}${p.day}`,compactTime:`${p.hour}${p.minute}${p.second}`}
}

export const todayArgentinaISO = () => argentinaNow().date
export const dateFromISO = value => new Date(String(value).slice(0,10)+'T12:00:00-03:00')
export const localISO = value => {
  if(typeof value==='string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0,10)
  const p=argentinaParts(value instanceof Date?value:new Date(value))
  return `${p.year}-${p.month}-${p.day}`
}
export const isSunday = value => dateFromISO(localISO(value)).getDay()===0

export function formatArgentinaLongDate(value,{includeYear=false,capitalize=true}={}){
  if(!value) return ''
  const text=new Intl.DateTimeFormat('es-AR',{
    timeZone:ARGENTINA_TIME_ZONE,weekday:'long',day:'numeric',month:'long',...(includeYear?{year:'numeric'}:{})
  }).format(dateFromISO(value))
  return capitalize?text.charAt(0).toUpperCase()+text.slice(1):text
}

export function nextProductionDay(date){
  const d=dateFromISO(localISO(date))
  do{d.setDate(d.getDate()+1)}while(d.getDay()===0)
  return d
}
export function addProductionDays(date,count){ let d=dateFromISO(localISO(date)); let remaining=Math.max(0,count); while(remaining>0){d=nextProductionDay(d);remaining--} return d }
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
  let d=dateFromISO(localISO(date))
  do{d=nextProductionDay(d)}while(isProductionClosed(localISO(d),closedDates))
  return d
}
function normalizeOpenDate(date,closedDates=[]){
  let d=dateFromISO(localISO(date))
  if(d.getDay()===0) d=nextProductionDay(d)
  while(isProductionClosed(localISO(d),closedDates)) d=nextOpenProductionDate(d,closedDates)
  return d
}
function firstPlanningDate(closedDates=[]){
  const today=dateFromISO(todayArgentinaISO())
  const lastClosed=latestClosedProductionDate(closedDates)
  if(!lastClosed) return normalizeOpenDate(today,closedDates)
  const afterClosed=nextOpenProductionDate(dateFromISO(lastClosed),closedDates)
  return normalizeOpenDate(afterClosed>today?afterClosed:today,closedDates)
}

export function estimateProductionAvailability(orders,newPieces,closedDates=[]){
  const closed=[...new Set(closedDates||[])].filter(Boolean).sort()
  const lastClosed=latestClosedProductionDate(closed)
  let cursor=firstPlanningDate(closed)
  let remaining=Math.max(0,Number(newPieces)||0)
  let productionDate=localISO(cursor)
  let safety=0
  if(remaining===0){
    while(safety<730){
      safety++
      const date=localISO(cursor)
      const used=piecesScheduledForDate(orders,date)
      if(cursor.getDay()!==0 && !isProductionClosed(date,closed) && used<DAILY_PIECE_LIMIT){productionDate=date;break}
      cursor=nextOpenProductionDate(cursor,closed)
    }
  }
  while(remaining>0 && safety<730){
    safety++
    const date=localISO(cursor)
    if(cursor.getDay()!==0 && !isProductionClosed(date,closed)){
      const used=piecesScheduledForDate(orders,date)
      const available=Math.max(0,DAILY_PIECE_LIMIT-used)
      if(available>0){remaining-=Math.min(available,remaining);productionDate=date}
    }
    if(remaining>0) cursor=nextOpenProductionDate(cursor,closed)
  }
  return {productionDate,availableFrom:productionDate,from:productionDate,to:productionDate,deliveryDate:productionDate,deliveryTo:productionDate,lastClosed,pending:(orders||[]).filter(o=>!['Entregado','Cancelado'].includes(o.status)).reduce((s,o)=>s+orderPieces(o),0)}
}

export function estimateDeliveryRange(orders,newPieces,shipping=false,closedDates=[]){
  return estimateProductionAvailability(orders,newPieces,closedDates)
}

export function productionStatus(pieces){ const v=Number(pieces)||0; if(v>DAILY_PIECE_LIMIT)return'over';if(v===DAILY_PIECE_LIMIT)return'full';if(v>=75)return'near';return'available' }
