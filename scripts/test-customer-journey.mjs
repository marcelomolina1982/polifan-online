import assert from 'node:assert/strict'
import {JOURNEY_EVENTS,TRACKING_STAGES,customerFirstName,deliveryMode,eventForFinalAction,journeyMessage,simulateJourneyEvent,trackingState,trackingUrl} from '../src/lib/customerJourney.js'

const base={id:'o-150',number:150,client:'Lucía Souto',phone:'1122334455',trackingToken:'trk_private_150'}
const via={...base,deliveryType:'Vía Cargo',carrier:'Via Cargo'}
const logistics={...base,id:'o-151',number:151,client:'Mariela Gómez',deliveryType:'Logística GBA/CABA',trackingToken:'trk_private_151'}
const pickup={...base,id:'o-152',number:152,client:'Andrea Paz',deliveryType:'Retiro en local',trackingToken:'trk_private_152'}
const opts={trackingBaseUrl:'https://prueba.tuvidaentinta.com/seguimiento',reviewUrl:'https://reviews.example/test'}

assert.equal(customerFirstName(via),'Lucía')
assert.equal(customerFirstName(logistics),'Mariela')
assert.equal(deliveryMode(via),'via-cargo')
assert.equal(deliveryMode(logistics),'logistics')
assert.equal(deliveryMode(pickup),'pickup')
assert.equal(trackingUrl(via,opts.trackingBaseUrl),'https://prueba.tuvidaentinta.com/seguimiento/p/trk_private_150')
assert.equal(TRACKING_STAGES.length,5)

const confirmed=journeyMessage(via,JOURNEY_EVENTS.CONFIRMED,opts)
assert.match(confirmed,/Hola Lucía/)
assert.match(confirmed,/pedido\.jpg/)
assert.match(confirmed,/revisalo/)
assert.match(confirmed,/irregularidad/)
assert.match(confirmed,/trk_private_150/)

assert.match(journeyMessage(via,JOURNEY_EVENTS.PRODUCTION,opts),/Hola Lucía/)
assert.match(journeyMessage(via,JOURNEY_EVENTS.CUT_COMPLETE,opts),/pegado, control y embalaje/)
assert.match(journeyMessage(via,JOURNEY_EVENTS.PACKING,opts),/control y embalaje/)
assert.match(journeyMessage(via,JOURNEY_EVENTS.DISPATCHED,opts),/Vía Cargo hacia la sucursal de destino/)
assert.match(journeyMessage(via,JOURNEY_EVENTS.DISPATCHED,opts),/reseña/)
assert.match(journeyMessage(logistics,JOURNEY_EVENTS.DISPATCHED,opts),/camino a tu domicilio/)
assert.match(journeyMessage(pickup,JOURNEY_EVENTS.READY_PICKUP,opts),/listo para retirar/)
assert.equal(eventForFinalAction(via),JOURNEY_EVENTS.DISPATCHED)
assert.equal(eventForFinalAction(pickup),JOURNEY_EVENTS.READY_PICKUP)

const packed=trackingState(via,JOURNEY_EVENTS.PACKING)
assert.deepEqual(packed.map(x=>x.state),['done','done','done','active','pending'])
const dispatched=trackingState(via,JOURNEY_EVENTS.DISPATCHED)
assert.deepEqual(dispatched.map(x=>x.state),['done','done','done','done','active'])

const first=simulateJourneyEvent([],via,JOURNEY_EVENTS.CONFIRMED,'2026-09-02T00:00:00.000Z',opts)
assert.equal(first.duplicate,false)
assert.equal(first.outbox.length,1)
assert.equal(first.entry.status,'simulated')
assert.deepEqual(first.entry.attachments,[{kind:'order-receipt',filename:'pedido.jpg'}])
assert.match(first.entry.message,/Hola Lucía/)
const second=simulateJourneyEvent(first.outbox,via,JOURNEY_EVENTS.CONFIRMED,'2026-09-02T00:01:00.000Z',opts)
assert.equal(second.duplicate,true)
assert.equal(second.outbox.length,1)
assert.equal(second.entry.createdAt,'2026-09-02T00:00:00.000Z')

console.log('customer journey private simulation: OK')
