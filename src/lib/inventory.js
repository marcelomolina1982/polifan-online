import { todayArgentinaISO } from './production.js'

export function normalizeFigureKey(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}

// NOTE: inventory implementation retained below through generated source marker.
