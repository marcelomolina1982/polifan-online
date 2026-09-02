import assert from 'node:assert/strict'
import {JOURNEY_EVENTS,journeyMessage,shouldSendJourneyWhatsApp,eventForFinalAction} from '../src/lib/customerJourney.js'
import {advanceOperationalJourney,effectiveJourneyEvent,markJourneyFinal,finalActionLabel} from '../src/lib/customerJourneyOperational.js'

const start='2026-09-02T12:00:00.000Z'
const order={id:'o1',number:9001,client:'Lucía Souto',delivery:'2026-09-02',deliveryType:'Vía Cargo',status:'Ingresado',items:[{figure:'Minnie',qty:2,inventoryTracked:true}]}
let db={orders:[order],cutBatches:[],customerCatalog:[{name:'Minnie'}],__stockRows:[{figure:'Minnie',cut:0,inCut:0}]}

let result=advanceOperationalJourney(db,start,{stockRowsFn:x=>x.__stockRows})
assert.equal(result.changed,true)
db={...db,orders:result.orders}
assert.equal(effectiveJourneyEvent(db.orders[0],start),JOURNEY_EVENTS.CONFIRMED)

db={...db,cutBatches:[{id:'b1',date:'2026-09-02',deliveryDates:['2026-09-02'],status:'En corte',sentToCutAt:start,items:[{figure:'Minnie',qty:2}]}],__stockRows:[{figure:'Minnie',cut:0,inCut:2}]}
result=advanceOperationalJourney(db,'2026-09-02T12:05:00.000Z',{stockRowsFn:x=>x.__stockRows})
db={...db,orders:result.orders}
assert.equal(db.orders[0].journey.stage,JOURNEY_EVENTS.PRODUCTION_CUT)
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.PRODUCTION_CUT),false)
assert.equal(journeyMessage(db.orders[0],JOURNEY_EVENTS.PRODUCTION_CUT),'')

db={...db,cutBatches:[{...db.cutBatches[0],status:'Terminada',finishedAt:'2026-09-02T13:00:00.000Z'}],__stockRows:[{figure:'Minnie',cut:2,inCut:0}]}
result=advanceOperationalJourney(db,'2026-09-02T13:00:00.000Z',{stockRowsFn:x=>x.__stockRows})
db={...db,orders:result.orders}
assert.equal(db.orders[0].journey.stage,JOURNEY_EVENTS.PRODUCTION_CUT)
assert.equal(db.orders[0].journey.cutCompletedAt,'2026-09-02T13:00:00.000Z')
assert.equal(effectiveJourneyEvent(db.orders[0],'2026-09-02T15:59:59.000Z'),JOURNEY_EVENTS.PRODUCTION_CUT)
assert.equal(effectiveJourneyEvent(db.orders[0],'2026-09-02T16:00:00.000Z'),JOURNEY_EVENTS.PACKING)
assert.equal(shouldSendJourneyWhatsApp(JOURNEY_EVENTS.PACKING),false)

result=advanceOperationalJourney(db,'2026-09-02T16:00:00.000Z',{stockRowsFn:x=>x.__stockRows})
db={...db,orders:result.orders}
assert.equal(db.orders[0].journey.stage,JOURNEY_EVENTS.PACKING)

const final=markJourneyFinal(db.orders[0],'2026-09-02T17:30:00.000Z')
assert.equal(final.journey.stage,JOURNEY_EVENTS.DISPATCHED)
assert.equal(finalActionLabel(final),'DESPACHADO')
const message=journeyMessage(final,JOURNEY_EVENTS.DISPATCHED,{reviewUrl:'https://catalogo.example/opiniones'})
assert.match(message,/Esperamos que disfrutes de tu pedido tanto como nosotros disfrutamos de realizarlo para vos/)
assert.match(message,/https:\/\/catalogo\.example\/opiniones/)
assert.equal(eventForFinalAction({...order,deliveryType:'Retiro en local'}),JOURNEY_EVENTS.READY_PICKUP)
assert.equal(finalActionLabel({...order,deliveryType:'Retiro en local'}),'LISTO PARA RETIRAR')

console.log('customer journey operational lab: OK')
