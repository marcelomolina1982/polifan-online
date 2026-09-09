import fs from 'node:fs'
const file='src/AppV2.jsx';let src=fs.readFileSync(file,'utf8')
if(!src.includes('liveProductionKeys=')){
 const plain="const missing=full?keys:keys.filter(k=>!loadedRef.current.has(k))"
 const compact="const keys=pageSections(target),full=pageNeedsFullCatalog(target),missing=full?keys:keys.filter(k=>!loadedRef.current.has(k))"
 const orders="const liveOrderPages=new Set(['orders','new','sheetplanner']);const missing=full?keys:keys.filter(k=>(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
 const expanded="const liveOrderPages=new Set(['orders','new','sheetplanner']);const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):target==='operations'?new Set(['orders','movements','cutBatches']):target==='cut'?new Set(['orders','movements','stockMin','figures','cutBatches']):target==='cutbatches'?new Set(['orders','movements','cutBatches','figures']):null;const missing=full?keys:keys.filter(k=>Boolean(liveProductionKeys?.has(k))||(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
 const compactExpanded="const keys=pageSections(target),full=pageNeedsFullCatalog(target),liveOrderPages=new Set(['orders','new','sheetplanner']),liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):target==='operations'?new Set(['orders','movements','cutBatches']):target==='cut'?new Set(['orders','movements','stockMin','figures','cutBatches']):target==='cutbatches'?new Set(['orders','movements','cutBatches','figures']):null,missing=full?keys:keys.filter(k=>Boolean(liveProductionKeys?.has(k))||(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
 if(src.includes(compact))src=src.replace(compact,compactExpanded)
 else if(src.includes(plain))src=src.replace(plain,expanded)
 else if(src.includes(orders))src=src.replace(orders,expanded)
 else throw new Error('live refresh: no se encontró carga de secciones')
}
if(!src.includes("target==='operations'?new Set(['orders','movements','cutBatches'])"))throw new Error('live refresh: falta operations')
fs.writeFileSync(file,src);console.log('LIVE PRODUCTION REFRESH OK')
