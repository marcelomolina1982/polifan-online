const clean=v=>String(v??'').trim()

export const JOURNEY_EVENTS={
  CONFIRMED:'confirmed',
  PRODUCTION_CUT:'production_cut',
  PACKING:'packing',
  DISPATCHED:'dispatched',
  READY_PICKUP:'ready_pickup'
}

export const TRACKING_STAGES=[
  {key:JOURNEY_EVENTS.CONFIRMED,label:'Pedido agendado'},
  {key:JOURNEY_EVENTS.PRODUCTION_CUT,label:'En producción / corte'},
  {key:JOURNEY_EVENTS.PACKING,label:'Para embalar'},
  {key:JOURNEY_EVENTS.DISPATCHED,label:'Despachado'}
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

export function shouldSendJourneyWhatsApp(event){
  return [JOURNEY_EVENTS.CONFIRMED,JOURNEY_EVENTS.DISPATCHED,JOURNEY_EVENTS.READY_PICKUP].includes(event)
}

export function journeyMessage(order={},event,{trackingBaseUrl,reviewUrl}={}){
  const nombre=customerFirstName(order),numero=clean(order.number)||'—'
  const seguimiento=trackingUrl(order,trackingBaseUrl)
  const trackLine=seguimiento?`\n\nPodés seguir el avance de tu pedido acá:\n${seguimiento}`:''
  const reviewLine=clean(reviewUrl)?`\n\nCuando recibas tu pedido, te invitamos a dejarnos una reseña y contarnos tu experiencia. Tu opinión nos ayuda muchísimo a seguir creciendo:\n${clean(reviewUrl)}`:''

  if(event===JOURNEY_EVENTS.CONFIRMED)return `Hola ${nombre} 💜\n\nTu pedido #${numero} de Tu Vida en Tinta ya fue agendado correctamente.\n\nTe adjuntamos el comprobante pedido.jpg. Por favor, revisá que los diseños, cantidades y modalidad de entrega estén correctos. Si ves cualquier irregularidad, escribinos por este mismo WhatsApp antes de que avancemos con la producción.${trackLine}\n\nMuchas gracias por elegirnos y confiar en nosotros.`

  if(event===JOURNEY_EVENTS.PRODUCTION_CUT||event===JOURNEY_EVENTS.PACKING)return ''

  const despedida=`\n\nEsperamos que disfrutes de tu pedido tanto como nosotros disfrutamos de realizarlo para vos. Muchas gracias por elegirnos y por confiar en Tu Vida en Tinta. 💜${reviewLine}\n\n¡Gracias por dejarnos ser parte de algo especial para vos!`

  if(event===JOURNEY_EVENTS.READY_PICKUP)return `Hola ${nombre} 💜\n\nTu pedido #${numero} ya está terminado, controlado y listo para retirar.${despedida}`

  if(event===JOURNEY_EVENTS.DISPATCHED){
    if(deliveryMode(order)==='via-cargo')return `Hola ${nombre} 💜\n\nTu pedido #${numero} ya fue despachado por Vía Cargo hacia la sucursal de destino.${despedida}`
    return `Hola ${nombre} 💜\n\nTu pedido #${numero} ya fue despachado y va camino a tu domicilio.${despedida}`
  }
  return ''
}

export function trackingState(order={},currentEvent=JOURNEY_EVENTS.CONFIRMED){
  const finalKey=currentEvent===JOURNEY_EVENTS.READY_PICKUP?JOURNEY_EVENTS.DISPATCHED:currentEvent
  const activeIndex=Math.max(0,TRACKING_STAGES.findIndex(stage=>stage.key===finalKey))
  return TRACKING_STAGES.map((stage,index)=>({...stage,state:index<activeIndex?'done':index===activeIndex?'active':'pending'}))
}

export function simulateJourneyEvent(outbox=[],order,event,now=new Date().toISOString(),options={}){
  const orderId=clean(order?.id)||`number:${clean(order?.number)}`
  const key=`${orderId}:${event}`
  const existing=outbox.find(row=>row.key===key)
  if(existing)return {outbox,entry:existing,duplicate:true}
  const sendWhatsApp=shouldSendJourneyWhatsApp(event)
  const entry={
    key,orderId,event,recipient:clean(order?.phone||order?.whatsapp),
    message:sendWhatsApp?journeyMessage(order,event,options):'',
    sendWhatsApp,status:'simulated',createdAt:now,providerMessageId:null,lastError:null,
    attachments:event===JOURNEY_EVENTS.CONFIRMED?[{kind:'order-receipt',filename:'pedido.jpg'}]:[],
    tracking:trackingState(order,event)
  }
  return {outbox:[...outbox,entry],entry,duplicate:false}
}

export function eventForFinalAction(order={}){
  return deliveryMode(order)==='pickup'?JOURNEY_EVENTS.READY_PICKUP:JOURNEY_EVENTS.DISPATCHED
}
