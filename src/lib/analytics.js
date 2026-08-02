import { supabase } from '../supabase'

const VISITOR_KEY = 'tvet_catalog_visitor_id'
const SESSION_KEY = 'tvet_catalog_session_id'

function randomId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${value}`
}

export function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = randomId('visitor')
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return randomId('visitor')
  }
}

export function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = randomId('session')
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return randomId('session')
  }
}

export async function trackCatalogEvent(eventType, details = {}) {
  try {
    const { error } = await supabase.from('catalog_events').insert({
      event_type: eventType,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      product_id: details.productId || null,
      product_name: details.productName || null,
      category: details.category || null,
      quantity: Number(details.quantity || 0),
      locality: details.locality?.trim() || null,
      province: details.province?.trim() || null,
      postal_code: details.postalCode?.trim() || null,
      rating: details.rating || null,
      comment: details.comment?.trim().slice(0, 500) || null,
      metadata: details.metadata || {}
    })
    if (error) console.warn('No se pudo registrar la estadística:', error.message)
  } catch (error) {
    console.warn('No se pudo registrar la estadística:', error)
  }
}
