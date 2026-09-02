const clean=v=>String(v??'').trim()

export const JOURNEY_EVENTS={
  CONFIRMED:'confirmed',
  PRODUCTION:'production',
  CUT_COMPLETE:'cut_complete',
  PACKING:'packing',
  DISPATCHED:'dispatched',
  READY_PICKUP:'ready_pickup'
}

export const TRACKING_STAGES=[
  {key:'confirmed',label:'Pedido agendado'},
  {key:'production',label:'En producción'},
  {key:'cut_complete',label:'En corte'},
  {key:'packing',label:'Para embalar'},
  {key:'dispatched',label:'Despachado'}
]

export function customerName(order={}){
  const full=clean(order.client)||[order.firstName,order.lastName].map(clean).filter(Boolean).join(' ')
  return full||'cliente'
}

export function customerFirstName(order={}){
  return customerName(order).split(/\s+/).filter(Boolean)[0]||'cliente'
}

export function deliveryMode(order={}){
  const raw=[order.deliveryType,order.carrier,order.shippingMethod,order.deliveryMethod].map(clean).join(' ').toLowerCase()
  if(raw.includes('via cargo')||raw.includes('vía cargo'))return 'via-cargo'
  if(raw.includes('retiro'))return 'pickup'
  return 'logistics'
}

export function trackingUrl(order={},baseUrl='https://seguimiento.tuvidaentinta.com'){
  const token=clean(order.trackingToken||order.customerTrackingToken)
  if(!token)return ''
  return `${String(baseUrl).replace(/\/$/,'')}/p/${encodeURIComponent(token)}`
}

export function journeyMessage(order={},event,{trackingBaseUrl,reviewUrl}={}){
  const nombre=customerFirstName(order),numero=clean(order.number)||'—'
  const seguimiento=trackingUrl(order,trackingBaseUrl)
  const trackLine=seguimiento?`\n\nPodés seguir el estado de tu pedido acá:\n${seguimiento}`:''
  const reviewLine=clean(reviewUrl)?`\n\nCuando recibas tu pedido, si quedaste conforme nos ayudaría muchísimo que nos dejes una reseña acá:\n${clean(reviewUrl)}`:''

  if(event===JOURNEY_EVENTS.CONFIRMED)return `Hola ${nombre} 💜 Tu pedido #${numero} de Tu Vida en Tinta ya fue agendado correctamente y quedó en nuestra cola de producción.\n\nTe adjuntamos el comprobante pedido.jpg. Por favor revisalo y controlá que diseños, cantidades y modalidad de entrega estén correctos. Si ves cualquier irregularidad, escribinos por este mismo WhatsApp así la corregimos antes de avanzar con la producción.${trackLine}\n\nGracias por confiar en nosotros.`
  if(event===JOURNEY_EVENTS.PRODUCTION)return `Hola ${nombre} 💜 Tu pedido #${numero} ya ingresó a producción. Vamos a ir actualizando su avance para que puedas seguirlo.${trackLine}`
  if(event===JOURNEY_EVENTS.CUT_COMPLETE)return `Hola ${nombre} 💜 Tenemos novedades de tu pedido #${numero}: todas las piezas ya fueron cortadas y ahora pasan a la etapa de pegado, control y embalaje. ¡Cada vez falta menos!${trackLine}`
  if(event===JOURNEY_EVENTS.PACKING)return `Hola ${nombre} 💜 Tu pedido #${numero} ya está en la etapa final de control y embalaje. En cuanto sea despachado te avisamos por acá.${trackLine}`
  if(event===JOURNEY_EVENTS.READY_PICKUP)return `Hola ${nombre} 💜 Tu pedido #${numero} ya está terminado, controlado y listo para retirar. Gracias por elegir Tu Vida en Tinta y por confiar en nuestro trabajo.${reviewLine}`
  if(event===JOURNEY_EVENTS.DISPATCHED){
    if(deliveryMode(order)==='via-cargo')return `Hola ${nombre} 💜 Tu pedido #${numero} ya fue despachado por Vía Cargo hacia la sucursal de destino. Gracias por elegir Tu Vida en Tinta. Disfrutamos preparando tu pedido y esperamos que disfrutes muchísimo recibirlo.${trackLine}${reviewLine}`
    return `Hola ${nombre} 💜 Tu pedido #${numero} ya fue despachado y va camino a tu domicilio. Gracias por elegir Tu Vida en Tinta. Disfrutamos preparando tu pedido y esperamos que disfrutes muchísimo recibirlo.${trackLine}${reviewLine}`
  }
  return ''
}

export function trackingState(order={},currentEvent=JOURNEY_EVENTS.CONFIRMED){
  const finalKey=currentEvent===JOURNEY_EVENTS.READY_PICKUP?'dispatched':currentEvent
  const activeIndex=Math.max(0,TRACKING_STAGES.findIndex(stage=>stage.key===finalKey))
  return TRACKING_STAGES.map((stage,index)=>({...stage,state:index<activeIndex?'done':index===activeIndex?'active':'pending'}))
}

export function simulateJourneyEvent(outbox=[],order,event,now=new Date().toISOString(),options={}){
  const orderId=clean(order?.id)||`number:${clean(order?.number)}`
  const key=`${orderId}:${event}`
  const existing=outbox.find(row=>row.key===key)
  if(existing)return {outbox,entry:existing,duplicate:true}
  const entry={
    key,orderId,event,recipient:clean(order?.phone||order?.whatsapp),message:journeyMessage(order,event,options),status:'simulated',createdAt:now,providerMessageId:null,lastError:null,
    attachments:event===JOURNEY_EVENTS.CONFIRMED?[{kind:'order-receipt',filename:'pedido.jpg'}]:[],
    tracking:trackingState(order,event)
  }
  return {outbox:[...outbox,entry],entry,duplicate:false}
}

export function eventForFinalAction(order={}){
  return deliveryMode(order)==='pickup'?JOURNEY_EVENTS.READY_PICKUP:JOURNEY_EVENTS.DISPATCHED
}
