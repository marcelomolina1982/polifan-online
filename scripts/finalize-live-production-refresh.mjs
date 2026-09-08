import fs from 'node:fs'
const file='src/AppV2.jsx';let src=fs.readFileSync(file,'utf8')
const plain="const missing=full?keys:keys.filter(k=>!loadedRef.current.has(k))"
const orders="const liveOrderPages=new Set(['orders','new','sheetplanner']);const missing=full?keys:keys.filter(k=>(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
const expanded="const liveOrderPages=new Set(['orders','new','sheetplanner']);const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):target==='operations'?new Set(['orders','movements','cutBatches']):target==='cut'?new Set(['orders','movements','stockMin','figures','cutBatches']):target==='cutbatches'?new Set(['orders','cutBatches','figures']):null;const missing=full?keys:keys.filter(k=>Boolean(liveProductionKeys?.has(k))||(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
if(src.includes(plain))src=src.replace(plain,expanded);else if(src.includes(orders))src=src.replace(orders,expanded);else if(!src.includes("target==='operations'?new Set(['orders','movements','cutBatches'])"))throw new Error('live refresh: política AppV2 desconocida')
fs.writeFileSync(file,src)
console.log('LIVE PRODUCTION REFRESH OK · sheetplanner/operations/cut/cutbatches frescos')
