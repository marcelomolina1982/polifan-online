import fs from 'node:fs'
const file='src/lib/customerJourneyOperational.js'
let src=fs.readFileSync(file,'utf8')
const already=src.includes('stockCoveredAt')&&src.includes("source:'finished_stock'")
if(already){
  console.log('TRACKING STOCK READY OK · lógica actual ya incorporada')
  process.exit(0)
}
const needle=`    if(!journey.productionAt&&batches.length&&projectedState.complete){`
const block=`    if(!journey.productionAt&&finishedState.complete){
      const packingAt=now
      if(journey.stage!==JOURNEY_EVENTS.PACKING){
        journey={...journey,stage:JOURNEY_EVENTS.PACKING,packingAt,stockCoveredAt:journey.stockCoveredAt||now}
        transitions.push({orderId:id,event:JOURNEY_EVENTS.PACKING,at:packingAt,reason:'finished_stock_coverage'})
      }
    }
    if(!journey.productionAt&&journey.stage!==JOURNEY_EVENTS.PACKING&&batches.length&&projectedState.complete){`
if(!src.includes(needle))throw new Error('tracking stock-ready: no se encontró reconciliación esperada ni lógica nueva incorporada')
src=src.replace(needle,block)
fs.writeFileSync(file,src)
if(!src.includes("reason:'finished_stock_coverage'"))throw new Error('tracking stock-ready: parche incompleto')
console.log('TRACKING STOCK READY OK')
