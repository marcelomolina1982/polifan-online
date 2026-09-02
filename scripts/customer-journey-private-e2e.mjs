import assert from 'node:assert/strict'
import {JOURNEY_EVENTS,eventForFinalAction,simulateJourneyEvent,trackingState} from '../src/lib/customerJourney.js'

const opts={trackingBaseUrl:'https://prueba.tuvidaentinta.com/seguimiento',reviewUrl:'https://reviews.example/test'}
const events=[JOURNEY_EVENTS.CONFIRMED,JOURNEY_EVENTS.PRODUCTION,JOURNEY_EVENTS.CUT_COMPLETE,JOURNEY_EVENTS.PACKING]
const cases=[
  {id:'fake-via',number:9001,client:'Lucía Souto',phone:'1100000001',trackingToken:'private_fake_via',deliveryType:'Vía Cargo',carrier:'Via Cargo'},
  {id:'fake-log',number:9002,client:'Mariela Gómez',phone:'1100000002',trackingToken:'private_fake_log',deliveryType:'Logística GBA/CABA'},
  {id:'fake-pickup',number:9003,client:'Andrea Paz',phone:'1100000003',trackingToken:'private_fake_pickup',deliveryType:'Retiro en local'}
]

for(const order of cases){
  let outbox=[]
  for(const event of [...events,eventForFinalAction(order)]){
    const result=simulateJourneyEvent(outbox,order,event,'2026-09-02T12:00:00.000Z',opts)
    assert.equal(result.duplicate,false)
    assert.equal(result.entry.status,'simulated')
    assert.match(result.entry.message,new RegExp(`Hola ${order.client.split(' ')[0]}`))
    outbox=result.outbox
  }
  assert.equal(outbox.length,5)
  assert.equal(outbox[0].attachments[0]?.filename,'pedido.jpg')
  assert.equal(outbox.slice(1).every(x=>x.attachments.length===0),true)
  const duplicate=simulateJourneyEvent(outbox,order,JOURNEY_EVENTS.CONFIRMED,'2026-09-02T12:05:00.000Z',opts)
  assert.equal(duplicate.duplicate,true)
  assert.equal(duplicate.outbox.length,5)
  const final=outbox.at(-1)
  assert.match(final.message,/reseña/)
  assert.deepEqual(trackingState(order,eventForFinalAction(order)).map(x=>x.state),['done','done','done','done','active'])
}

// Corte parcial: mientras no exista CUT_COMPLETE no se genera aviso de corte terminado.
const partial=cases[0]
let partialOutbox=[]
for(const event of [JOURNEY_EVENTS.CONFIRMED,JOURNEY_EVENTS.PRODUCTION]) partialOutbox=simulateJourneyEvent(partialOutbox,partial,event,undefined,opts).outbox
assert.equal(partialOutbox.some(x=>x.event===JOURNEY_EVENTS.CUT_COMPLETE),false)

console.log('customer journey private E2E simulation: OK')
