import assert from 'node:assert/strict'
import {JOURNEY_EVENTS,journeyMessage,shouldSendJourneyWhatsApp,eventForFinalAction} from '../src/lib/customerJourney.js'
import {advanceOperationalJourney,effectiveJourneyEvent,markJourneyFinal,finalActionLabel,journeyStageLabel} from '../src/lib/customerJourneyOperational.js'

const enabled=(order,at='2026-09-02T10:00:00.000Z')=>({...order,journey:{enabled:true,stage:JOURNEY_EVENTS.CONFIRMED,confirmedAt:at,whatsappConfirmedStatus:'simulated-private'}})
const makeOrder=(id,number,items,extra={})=>enabled({id,number,client:`Cliente ${number}`,delivery:'2026-09-02',deliveryType:'Vía Cargo',status:'Ingresado',createdAt:'2026-09-02T10:00:00.000Z',items,...extra})
const rows=(...items)=>()=>items

// 1) Placa con pedidos mezclados: cada pedido avanza sólo cuando su demanda completa queda cubierta.
let db={orders:[
  makeOrder('a',1,[{figure:'A',qty:2,inventoryTracked:true}]),
  makeOrder('b',2,[{figure:'B',qty:2,inventoryTracked:true}])
],cutBatches:[]}
let result=advanceOperationalJourney(db,'2026-09-02T12:00:00.000Z',{stockRowsFn:rows({figure:'A',cut:0,inCut:2},{figure:'B',cut:0,inCut:0})})
assert.equal(result.orders[0].journey.stage,JOURNEY_EVENTS.CONFIRMED)

db.cutBatches=[{id:'p1',journeyManaged:true,date:'2026-09-02',deliveryDates:['2026-09-02'],status:'En corte',sentToCutAt:'2026-09-02T12:00:00.000Z',items:[{figure:'A',qty:2},{figure:'B',qty:1}]}]
result=advanceOperationalJourney(db,'2026-09-02T12:01:00.000Z',{stockRowsFn:rows({figure:'A',cut:0,inCut:2},{figure:'B',cut:0,inCut:1})})
db={...db,orders:result.orders}
assert.equal(db.orders[0].journey.stage,JOURNEY_EVENTS.PRODUCTION_CUT)
assert.equal(db.orders[1].journey.stage,JOURNEY_EVENTS.CONFIRMED)

db.cutBatches.push({id:'p2',journeyManaged:true,date:'2026-09-02',deliveryDates:['2026-09-02'],status:'En corte',sentToCutAt:'2026-09-02T12:10:00.000Z',items:[{figure:'B',qty:1}]})
result=advanceOperationalJourney(db,'2026-09-02T12:11:00.000Z',{stockRowsFn:rows({figure:'A',cut:0,inCut:2},{figure:'B',cut:0,inCut:2})})
db={...db,orders:result.orders}
assert.equal(db.orders[1].journey.stage,JOURNEY_EVENTS.PRODUCTION_CUT)

// 2) Corte parcial / varias placas: terminar una placa no inicia el reloj del pedido incompleto.
db.cutBatches[0]={...db.cutBatches[0],status:'Terminada',finishedAt:'2026-09-02T13:00:00.000Z'}
result=advanceOperationalJourney(db,'2026-09-02T13:00:00.000Z',{stockRowsFn:rows({figure:'A',cut:2,inCut:0},{figure:'B',cut:1,inCut:1})})
db={...db,orders:result.orders}
assert.equal(db.orders[0].journey.cutCompletedAt,'2026-09-02T13:00:00.000Z')
assert.equal(db.orders[1].journey.cutCompletedAt,undefined)

db.cutBatches[1]={...db.cutBatches[1],status:'Terminada',finishedAt:'2026-09-02T13:30:00.000Z'}
result=advanceOperationalJourney(db,'2026-09-02T13:30:00.000Z',{stockRowsFn:rows({figure:'A',cut:2,inCut:0},{figure:'B',cut:2,inCut:0})})
db={...db,orders:result.orders}
assert.equal(db.orders[1].journey.cutCompletedAt,'2026-09-02T13:30:00.000Z')

// 3) Las 3 horas salen de la hora persistida, no de un timer del navegador.
assert.equal(effectiveJourneyEvent(db.orders[1],'2026-09-02T16:29:59.000Z'),JOURNEY_EVENTS.PRODUCTION_CUT)
assert.equal(effectiveJourneyEvent(db.orders[1],'2026-09-02T16:30:00.000Z'),JOURNEY_EVENTS.PACKING)
const reloadedOrder=JSON.parse(JSON.stringify(db.orders[1]))
assert.equal(effectiveJourneyEvent(reloadedOrder,'2026-09-02T16:31:00.000Z'),JOURNEY_EVENTS.PACKING)
result=advanceOperationalJourney({...db,orders:[reloadedOrder]},'2026-09-02T16:31:00.000Z',{stockRowsFn:rows({figure:'B',cut:2,inCut:0})})
assert.equal(result.orders[0].journey.stage,JOURNEY_EVENTS.PACKING)
assert.equal(result.orders[0].journey.packingAt,'2026-09-02T16:30:00.000Z')

// 4) Centro operativo: no se puede finalizar antes de Para embalar; una vez finalizado es idempotente.
const tooEarly=markJourneyFinal({...db.orders[0],journey:{...db.orders[0].journey,cutCompletedAt:'2026-09-02T15:00:00.000Z'}},'2026-09-02T16:00:00.000Z')
assert.notEqual(tooEarly.journey.stage,JOURNEY_EVENTS.DISPATCHED)
let final=markJourneyFinal(reloadedOrder,'2026-09-02T17:00:00.000Z')
assert.equal(final.journey.stage,JOURNEY_EVENTS.DISPATCHED)
assert.equal(finalActionLabel(final),'DESPACHADO')
const repeated=markJourneyFinal(final,'2026-09-02T17:01:00.000Z')
assert.deepEqual(repeated,final)

// 5) Retiro usa acción final específica.
const pickup={...reloadedOrder,deliveryType:'Retiro en el local'}
assert.equal(eventForFinalAction(pickup),JOURNEY_EVENTS.READY_PICKUP)
assert.equal(finalActionLabel(pickup),'LISTO PARA RETIRAR')

// 6) Pedidos y placas anteriores quedan fuera del nuevo Customer Journey.
const legacyOrder={id:'legacy',number:99,delivery:'2026-09-02',status:'Ingresado',items:[{figure:'A',qty:1,inventoryTracked:true}]}
const legacyBatch={id:'legacy-batch',date:'2026-09-02',status:'Terminada',finishedAt:'2026-09-02T10:00:00.000Z',items:[{figure:'A',qty:9}]}
result=advanceOperationalJourney({orders:[legacyOrder],cutBatches:[legacyBatch]},'2026-09-02T20:00:00.000Z',{stockRowsFn:rows({figure:'A',cut:9,inCut:0})})
assert.equal(result.changed,false)
assert.equal(result.orders[0].journey,undefined)
assert.equal(effectiveJourneyEvent(result.orders[0]),null)
assert.equal(journeyStageLabel(null),'Seguimiento anterior')

// 7) WhatsApp sólo en confirmación y acción final; etapas internas quedan silenciosas.
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.CONFIRMED),true)
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.PRODUCTION_CUT),false)
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.PACKING),false)
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.DISPATCHED),true)
assert.equal(journeyMessage(final,JOURNEY_EVENTS.PRODUCTION_CUT),'')
assert.equal(journeyMessage(final,JOURNEY_EVENTS.PACKING),'')
const message=journeyMessage(final,JOURNEY_EVENTS.DISPATCHED,{reviewUrl:'https://catalogo.example/opiniones'})
assert.match(message,/Esperamos que disfrutes de tu pedido tanto como nosotros disfrutamos de realizarlo para vos/)
assert.match(message,/https:\/\/catalogo\.example\/opiniones/)

console.log('customer journey predeploy: 7/7 OK')
