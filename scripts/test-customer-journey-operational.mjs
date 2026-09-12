import assert from 'node:assert/strict'
import {JOURNEY_EVENTS,journeyMessage,shouldSendJourneyWhatsApp,eventForFinalAction,trackingUrl} from '../src/lib/customerJourney.js'
import {advanceOperationalJourney,effectiveJourneyEvent,markJourneyFinal,finalActionLabel,journeyEligible} from '../src/lib/customerJourneyOperational.js'

const enabled=(order,at='2026-09-02T10:00:00.000Z')=>({...order,journey:{enabled:true,stage:JOURNEY_EVENTS.CONFIRMED,confirmedAt:at,whatsappConfirmedStatus:'simulated-private'}})
const makeOrder=(id,number,items,extra={})=>enabled({id,number,client:`Cliente ${number}`,delivery:'2026-09-02',deliveryType:'Vía Cargo',status:'Ingresado',createdAt:'2026-09-02T10:00:00.000Z',items,...extra})
const rows=(...items)=>()=>items

// 1) Apenas hay una pieza cubierta/proyectada, el pedido entra en producción.
let db={orders:[makeOrder('a',1,[{figure:'A',qty:2,inventoryTracked:true}])],cutBatches:[]}
let result=advanceOperationalJourney(db,'2026-09-02T12:00:00.000Z',{stockRowsFn:rows({figure:'A',cut:0,inCut:1})})
assert.equal(result.orders[0].journey.stage,JOURNEY_EVENTS.PRODUCTION_CUT)

// 2) Si no hay ninguna pieza cubierta ni producción, sigue agendado.
db={orders:[makeOrder('b',2,[{figure:'B',qty:2,inventoryTracked:true}])],cutBatches:[]}
result=advanceOperationalJourney(db,'2026-09-02T12:00:00.000Z',{stockRowsFn:rows({figure:'B',cut:0,inCut:0})})
assert.equal(result.orders[0].journey.stage,JOURNEY_EVENTS.CONFIRMED)

// 3) Una placa relevante también inicia producción.
db={orders:[makeOrder('c',3,[{figure:'C',qty:2,inventoryTracked:true}])],cutBatches:[{id:'p1',journeyManaged:true,date:'2026-09-02',deliveryDates:['2026-09-02'],status:'En corte',sentToCutAt:'2026-09-02T12:00:00.000Z',items:[{figure:'C',qty:1}]}]}
result=advanceOperationalJourney(db,'2026-09-02T12:01:00.000Z',{stockRowsFn:rows({figure:'C',cut:0,inCut:1})})
assert.equal(result.orders[0].journey.stage,JOURNEY_EVENTS.PRODUCTION_CUT)

// 4) Apenas todas las piezas están listas, pasa a embalar sin espera de 3 horas.
db={orders:[makeOrder('d',4,[{figure:'D',qty:2,inventoryTracked:true}])],cutBatches:[]}
result=advanceOperationalJourney(db,'2026-09-02T12:00:00.000Z',{stockRowsFn:rows({figure:'D',cut:2,inCut:0})})
assert.equal(result.orders[0].journey.stage,JOURNEY_EVENTS.PACKING)
assert.equal(effectiveJourneyEvent(result.orders[0],'2026-09-02T12:00:01.000Z'),JOURNEY_EVENTS.PACKING)

// 5) Stock parcial terminado también significa producción iniciada.
let deficitDb={orders:[makeOrder('deficit',11,[{figure:'Falta',qty:2,inventoryTracked:true}])],cutBatches:[]}
result=advanceOperationalJourney(deficitDb,'2026-09-02T12:00:00.000Z',{stockRowsFn:rows({figure:'Falta',cut:1,inCut:0})})
assert.equal(result.orders[0].journey.stage,JOURNEY_EVENTS.PRODUCTION_CUT)

// 6) La asignación respeta el orden cronológico: una unidad no cubre dos pedidos.
let chronoDb={orders:[makeOrder('first',12,[{figure:'Uno',qty:1,inventoryTracked:true}],{delivery:'2026-09-02'}),makeOrder('second',13,[{figure:'Uno',qty:1,inventoryTracked:true}],{delivery:'2026-09-03'})],cutBatches:[]}
result=advanceOperationalJourney(chronoDb,'2026-09-02T12:00:00.000Z',{stockRowsFn:rows({figure:'Uno',cut:1,inCut:0})})
assert.equal(result.orders[0].journey.stage,JOURNEY_EVENTS.PACKING)
assert.equal(result.orders[1].journey.stage,JOURNEY_EVENTS.CONFIRMED)

// 7) Un servicio no controlado por inventario no avanza automáticamente.
let serviceDb={orders:[makeOrder('service',15,[{figure:'Servicio',qty:1,inventoryTracked:false}])],cutBatches:[]}
result=advanceOperationalJourney(serviceDb,'2026-09-02T12:00:00.000Z',{stockRowsFn:rows()})
assert.equal(result.orders[0].journey.stage,JOURNEY_EVENTS.CONFIRMED)

// 8) Despachado es exclusivamente manual y sólo desde Para embalar.
const productionOrder={...makeOrder('prod',20,[{figure:'P',qty:1,inventoryTracked:true}]),journey:{...makeOrder('prod',20,[]).journey,stage:JOURNEY_EVENTS.PRODUCTION_CUT}}
assert.notEqual(markJourneyFinal(productionOrder,'2026-09-02T16:00:00.000Z').journey.stage,JOURNEY_EVENTS.DISPATCHED)
let packingOrder={...makeOrder('pack',21,[{figure:'P',qty:1,inventoryTracked:true}]),journey:{...makeOrder('pack',21,[]).journey,stage:JOURNEY_EVENTS.PACKING}}
let final=markJourneyFinal(packingOrder,'2026-09-02T17:00:00.000Z')
assert.equal(final.journey.stage,JOURNEY_EVENTS.DISPATCHED)
assert.equal(finalActionLabel(final),'DESPACHADO')
assert.deepEqual(markJourneyFinal(final,'2026-09-02T17:01:00.000Z'),final)

// 9) Retiro en local conserva su evento interno, aunque el seguimiento público cierre en el paso final.
assert.equal(eventForFinalAction({...packingOrder,deliveryType:'Retiro en el local'}),JOURNEY_EVENTS.READY_PICKUP)

// 10) Pedidos vigentes se habilitan; vencidos no.
const legacyOrder={id:'legacy',number:99,delivery:'2026-09-02',status:'Ingresado',items:[{figure:'A',qty:1,inventoryTracked:true}]}
result=advanceOperationalJourney({orders:[legacyOrder],cutBatches:[]},'2026-09-02T20:00:00.000Z',{stockRowsFn:rows({figure:'A',cut:9,inCut:0})})
assert.equal(result.orders[0].journey.enabled,true)
assert.equal(journeyEligible({...legacyOrder,delivery:'2026-09-01'},'2026-09-02T20:00:00.000Z'),false)

// 11) Mensajería y enlace siguen intactos.
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.CONFIRMED),true)
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.PRODUCTION_CUT),false)
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.PACKING),false)
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.DISPATCHED),true)
assert.equal(journeyMessage(final,JOURNEY_EVENTS.PACKING),'')
assert.match(journeyMessage(final,JOURNEY_EVENTS.DISPATCHED,{reviewUrl:'https://catalogo.example/opiniones'}),/Esperamos que disfrutes/)
assert.equal(trackingUrl({trackingToken:'token-prueba'}),'https://tu-vida-en-tinta-catalogo-v2.vercel.app/p/token-prueba')

console.log('customer journey predeploy: reglas nuevas OK')
