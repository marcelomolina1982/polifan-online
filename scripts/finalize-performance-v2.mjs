import fs from 'node:fs'

function replaceOnce(source,needle,replacement,label){
  const first=source.indexOf(needle)
  if(first<0)throw new Error(`performance-v2: no se encontró ${label}`)
  if(source.indexOf(needle,first+needle.length)>=0)throw new Error(`performance-v2: ${label} aparece más de una vez`)
  return source.replace(needle,replacement)
}

// 1) Inventario: no recalcular todo el stock en cada tecla/click del buscador.
const stockPath='src/pages/StockBase.jsx'
let stock=fs.readFileSync(stockPath,'utf8')
stock=replaceOnce(
  stock,
  "  const rows=stockRows(db).filter(r=>r.figure.toLowerCase().includes(search.toLowerCase()))",
  "  const allStockRows=useMemo(()=>stockRows(db),[db])\n  const rows=useMemo(()=>allStockRows.filter(r=>r.figure.toLowerCase().includes(search.toLowerCase())),[allStockRows,search])",
  'cálculo principal de StockBase'
)
stock=replaceOnce(
  stock,
  "  const rowByFigure=useMemo(()=>Object.fromEntries(stockRows(db).map(r=>[r.figure,r])),[db])",
  "  const rowByFigure=useMemo(()=>Object.fromEntries(allStockRows.map(r=>[r.figure,r])),[allStockRows])",
  'segundo cálculo duplicado de StockBase'
)
fs.writeFileSync(stockPath,stock)

// 2) Inventario/Para cortar: la reparación histórica era O(placas × piezas × movimientos)
// y se ejecutaba varias veces para el MISMO snapshot de db. Cacheamos sólo por identidad
// del snapshot; al guardar/cargar AppV2 crea un db nuevo y la caché se invalida sola.
const invPath='src/lib/inventory.js'
let inv=fs.readFileSync(invPath,'utf8')
inv=replaceOnce(
  inv,
  "const CUT_REPAIR_CUTOFF='2026-08-14T23:59:59'",
  "const CUT_REPAIR_CUTOFF='2026-08-14T23:59:59'\nconst finishedProductionCache=new WeakMap()",
  'declaración de caché de producción terminada'
)
inv=replaceOnce(
  inv,
  "function missingFinishedBatchProduction(db){\n  const complete={},components={}",
  "function missingFinishedBatchProduction(db){\n  const cached=finishedProductionCache.get(db)\n  if(cached)return cached\n  const complete={},components={}",
  'entrada de missingFinishedBatchProduction'
)
inv=replaceOnce(
  inv,
  "  return {complete,components}\n}\n\nexport function manualBalance(db){",
  "  const result={complete,components}\n  finishedProductionCache.set(db,result)\n  return result\n}\n\nexport function manualBalance(db){",
  'salida de missingFinishedBatchProduction'
)
fs.writeFileSync(invPath,inv)

console.log('✓ Performance V2: inventario memoizado y reparación histórica reutilizada sin cambiar resultados.')
