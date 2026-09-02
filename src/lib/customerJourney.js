const clean=v=>String(v??'').trim()

export const JOURNEY_EVENTS={
  CONFIRMED:'confirmed',
  CUT_COMPLETE:'cut_complete',
  DISPATCHED:'dispatched',
  READY_PICKUP:'ready_pickup'
}

export function customerName(order={}){
  return clean(order.client)||[order.firstName,order.lastName].map(clean).filter(Boolean).join(' ')||'cliente'
}

export function deliveryMode(order={}){
  const raw=[order.deliveryType,order.carrier,order.shippingMethod,order.deliveryMethod].map(clean).join(' ').toLowerCase()
  if(raw.includes('via cargo')||raw.includes('vía cargo'))return 'via-cargo'
  if(raw.includes('retiro'))return 'pickup'
  return 'logistics'
}

export function journeyMessage(order={},event){
  const nombre=customerName(order),numero=clean(order.number)||'—'
  if(event===JOURNEY_EVENTS.CONFIRMED)return `Hola ${nombre} 💜 Tu pedido #${numero} de Tu Vida en Tinta ya fue agendado correctamente y quedó en nuestra cola de producción. Te vamos a mantener al tanto a medida que avance. Gracias por confiar en nosotros.`
  if(event===JOURNEY_EVENTS.CUT_COMPLETE)return `Hola ${nombre} 💜 Tenemos novedades de tu pedido #${numero}: todas las piezas ya fueron cortadas y ahora pasan a la etapa de pegado, control y embalaje. ¡Cada vez falta menos!`
  if(event===JOURNEY_EVENTS.READY_PICKUP)return `Hola ${nombre} 💜 Tu pedido #${numero} ya está terminado, controlado y listo para retirar. Gracias por elegir Tu Vida en Tinta y por confiar en nuestro trabajo.`
  if(event===JOURNEY_EVENTS.DISPATCHED){
    if(deliveryMode(order)==='via-cargo')return `Hola ${nombre} 💜 Tu pedido #${numero} ya fue despachado por Vía Cargo hacia la sucursal de destino. Gracias por elegir Tu Vida en Tinta. Disfrutamos preparando tu pedido y esperamos que disfrutes muchísimo recibirlo.`
    return `Hola ${nombre} 💜 Tu pedido #${numero} ya fue despachado y va camino a tu domicilio. Gracias por elegir Tu Vida en Tinta. Disfrutamos preparando tu pedido y esperamos que disfrutes muchísimo recibirlo.`
  }
  return ''
}

export function simulateJourneyEvent(outbox=[],order,event,now=new Date().toISOString()){
  const orderId=clean(order?.id)||`number:${clean(order?.number)}`
  const key=`${orderId}:${event}`
  const existing=outbox.find(row=>row.key===key)
  if(existing)return {outbox,entry:existing,duplicate:true}
  const entry={
    key,orderId,event,recipient:clean(order?.phone||order?.whatsapp),message:journeyMessage(order,event),status:'simulated',createdAt:now,providerMessageId:null,lastError:null
  }
  return {outbox:[...outbox,entry],entry,duplicate:false}
}

export function eventForFinalAction(order={}){
  return deliveryMode(order)==='pickup'?JOURNEY_EVENTS.READY_PICKUP:JOURNEY_EVENTS.DISPATCHED
}
