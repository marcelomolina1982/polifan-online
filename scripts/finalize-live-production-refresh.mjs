import fs from 'node:fs'

const file='src/AppV2.jsx'
let src=fs.readFileSync(file,'utf8')

const before="const liveOrderPages=new Set(['orders','new','sheetplanner']);const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):null;const missing=full?keys:keys.filter(k=>Boolean(liveProductionKeys?.has(k))||(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
const after="const liveOrderPages=new Set(['orders','new','sheetplanner']);const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):target==='cut'?new Set(['orders','movements','stockMin','figures','cutBatches']):target==='cutbatches'?new Set(['orders','cutBatches','figures']):null;const missing=full?keys:keys.filter(k=>Boolean(liveProductionKeys?.has(k))||(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"

if(!src.includes(before))throw new Error('live refresh: no se encontró política operativa esperada')
src=src.replace(before,after)
fs.writeFileSync(file,src)

if(!src.includes("target==='cut'?new Set(['orders','movements','stockMin','figures','cutBatches'])"))throw new Error('live refresh: Para cortar no quedó forzado a datos frescos')
if(!src.includes("target==='cutbatches'?new Set(['orders','cutBatches','figures'])"))throw new Error('live refresh: En corte no quedó forzado a datos frescos')
console.log('LIVE PRODUCTION REFRESH OK · Para cortar y En corte siempre leen Supabase al entrar')
