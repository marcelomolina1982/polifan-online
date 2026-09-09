import { describe, expect, it } from 'vitest'
import { advanceOperationalJourney, effectiveJourneyEvent, markJourneyFinal } from './customerJourneyOperational'
import { JOURNEY_EVENTS } from './customerJourney'

const NOW = new Date('2026-09-09T18:00:00-03:00')

function order(overrides = {}) {
  return {
    id: 'test-order-1', number: 'TEST-1', status: 'Confirmado', delivery: '2026-09-10',
    deliveryType: 'Retiro en local', items: [{ figure: 'Arcoiris', qty: 1 }],
    customerJourneyEnabled: true,
    journey: { stage: JOURNEY_EVENTS.CONFIRMED, confirmedAt: '2026-09-09T12:00:00-03:00' },
    ...overrides,
  }
}

function dbWith(o, extra = {}) {
  return { orders: [o], movements: [], cutBatches: [], ...extra }
}

describe('customer journey safety', () => {
  it('does not mutate the input database', () => {
    const db = dbWith(order())
    const before = JSON.stringify(db)
    advanceOperationalJourney(db, NOW)
    expect(JSON.stringify(db)).toBe(before)
  })

  it('does not enter production from an unrelated matching-figure cut batch', () => {
    const o = order()
    const db = dbWith(o, { cutBatches: [{ id: 'other-date', status: 'En corte', journeyManaged: true, delivery: '2026-09-12', items: [{ figure: 'Arcoiris', qty: 20 }] }] })
    const next = advanceOperationalJourney(db, NOW)
    expect(next.orders[0].journey.stage).toBe(JOURNEY_EVENTS.CONFIRMED)
  })

  it('keeps the three-hour packing gate after production cut completion', () => {
    const cutAt = '2026-09-09T16:00:00-03:00'
    const o = order({ journey: { stage: JOURNEY_EVENTS.PRODUCTION_CUT, productionAt: '2026-09-09T14:00:00-03:00', cutCompletedAt: cutAt } })
    expect(effectiveJourneyEvent(o, NOW)).toBe(JOURNEY_EVENTS.PRODUCTION_CUT)
    const after = new Date('2026-09-09T19:01:00-03:00')
    expect(effectiveJourneyEvent(o, after)).toBe(JOURNEY_EVENTS.PACKING)
  })

  it('allows final manual action only from packing', () => {
    const confirmed = order()
    expect(markJourneyFinal(confirmed, NOW).journey.stage).toBe(JOURNEY_EVENTS.CONFIRMED)
    const packing = order({ journey: { stage: JOURNEY_EVENTS.PACKING, packingAt: '2026-09-09T17:00:00-03:00' } })
    const final = markJourneyFinal(packing, NOW)
    expect([JOURNEY_EVENTS.DISPATCHED, JOURNEY_EVENTS.READY_PICKUP]).toContain(final.journey.stage)
  })
})
