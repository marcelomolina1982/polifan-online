import assert from 'node:assert/strict'
import {JOURNEY_EVENTS,deliveryMode,eventForFinalAction,journeyMessage,simulateJourneyEvent} from '../src/lib/customerJourney.js'

const base={id:'o-150',number:150,client:'Lucía',phone:'1122334455'}
const via={...base,deliveryType:'Vía Cargo',carrier:'Via Cargo'}
const logistics={...base,id:'o-151',number:151,deliveryType:'Logística GBA/CABA'}
const pickup={...base,id:'o-152',number:152,deliveryType:'Retiro en local'}

assert.equal(deliveryMode(via),'via-cargo')
assert.equal(deliveryMode(logistics),'logistics')
assert.equal(deliveryMode(pickup),'pickup')
assert.match(journeyMessage(via,JOURNEY_EVENTS.CONFIRMED),/cola de producción/)
assert.match(journeyMessage(via,JOURNEY_EVENTS.CUT_COMPLETE),/pegado, control y embalaje/)
assert.match(journeyMessage(via,JOURNEY_EVENTS.DISPATCHED),/Vía Cargo hacia la sucursal de destino/)
assert.match(journeyMessage(logistics,JOURNEY_EVENTS.DISPATCHED),/camino a tu domicilio/)
assert.match(journeyMessage(pickup,JOURNEY_EVENTS.READY_PICKUP),/listo para retirar/)
assert.equal(eventForFinalAction(via),JOURNEY_EVENTS.DISPATCHED)
assert.equal(eventForFinalAction(pickup),JOURNEY_EVENTS.READY_PICKUP)

const first=simulateJourneyEvent([],via,JOURNEY_EVENTS.CONFIRMED,'2026-09-02T00:00:00.000Z')
assert.equal(first.duplicate,false)
assert.equal(first.outbox.length,1)
assert.equal(first.entry.status,'simulated')
const second=simulateJourneyEvent(first.outbox,via,JOURNEY_EVENTS.CONFIRMED,'2026-09-02T00:01:00.000Z')
assert.equal(second.duplicate,true)
assert.equal(second.outbox.length,1)
assert.equal(second.entry.createdAt,'2026-09-02T00:00:00.000Z')

console.log('customer journey simulation: OK')
