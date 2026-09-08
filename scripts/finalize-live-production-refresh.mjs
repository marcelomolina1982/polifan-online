import fs from 'node:fs'

const file='src/AppV2.jsx'
let src=fs.readFileSync(file,'utf8')
const base="const liveOrderPages=new Set(['orders','new','sheetplanner']);const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):null;const missing=full?keys:keys.filter(k=>Boolean(liveProductionKeys?.has(k))||(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
const expanded="const liveOrderPages=new Set(['orders','new','sheetplanner']);const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):target==='cut'?new Set(['orders','movements','stockMin','figures','cutBatches']):target==='cutbatches'?new Set(['orders','cutBatches','figures']):null;const missing=full?keys:keys.filter(k=>Boolean(liveProductionKeys?.has(k))||(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
if(src.includes(base))src=src.replace(base,expanded)
const hasCut=src.includes("target==='cut'?new Set(['orders','movements','stockMin','figures','cutBatches'])")
const hasCutBatches=src.includes("target==='cutbatches'?new Set(['orders','cutBatches','figures'])")
if(!hasCut||!hasCutBatches)throw new Error('live refresh: política operativa incompleta')
fs.writeFileSync(file,src)
console.log('LIVE PRODUCTION REFRESH OK · validación idempotente de Para cortar y En corte')
