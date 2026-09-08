import fs from 'node:fs'
const file='src/lib/customerJourneyOperational.js'
let src=fs.readFileSync(file,'utf8')

// La cadena histórica de predeploy puede regenerar este módulo antes de llegar acá.
// Por eso no dependemos de una línea exacta: detectamos la reconciliación real que
// decide cuándo un pedido entra a producción y anteponemos la cobertura por stock.
const hasStockReady=src.includes('stockCoveredAt')&&(src.includes("source:'finished_stock'")||src.includes("reason:'finished_stock_coverage'"))
if(hasStockReady){
  console.log('TRACKING STOCK READY OK · lógica actual ya incorporada')
  process.exit(0)
}

const productionRx=/if\s*\(\s*!journey\.productionAt\s*&&\s*(?:batches|relevantBatches)\.length\s*&&\s*projectedState\.complete\s*\)\s*\{/
const match=src.match(productionRx)
if(!match)throw new Error('tracking stock-ready: no se encontró la transición real a producción; se aborta sin publicar una lógica dudosa')

const block=`if(!journey.productionAt&&finishedState.complete&&!journey.cutCompletedAt){
      const packingAt=journey.packingAt||now
      if(journey.stage!==JOURNEY_EVENTS.PACKING){
        journey={...journey,stage:JOURNEY_EVENTS.PACKING,packingAt,stockCoveredAt:journey.stockCoveredAt||now}
        transitions.push({orderId:id,event:JOURNEY_EVENTS.PACKING,at:packingAt,source:'finished_stock'})
      }
    }
    else ${match[0]}`
src=src.replace(productionRx,block)
fs.writeFileSync(file,src)

if(!src.includes('stockCoveredAt')||!src.includes("source:'finished_stock'"))throw new Error('tracking stock-ready: parche incompleto')
console.log('TRACKING STOCK READY OK · compatible con predeploy histórico')
