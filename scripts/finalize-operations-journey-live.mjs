import fs from 'node:fs'

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
// Parche estructural: cualquier política de `missing` dentro de ensurePage pasa a
// refrescar siempre orders/movements/cutBatches al abrir Centro operativo o Generar placas.
if(!app.includes("liveProductionKeys=(target==='sheetplanner'||target==='operations')")){
  const anchor="    const missing=full?keys:keys.filter("
  const pos=app.indexOf(anchor)
  if(pos<0)throw new Error('operations journey live: no se encontró cálculo missing en ensurePage')
  const lineEnd=app.indexOf('\n',pos)
  if(lineEnd<0)throw new Error('operations journey live: línea missing incompleta')
  const current=app.slice(pos,lineEnd)
  const replacement="    const liveProductionKeys=(target==='sheetplanner'||target==='operations')?new Set(['orders','movements','cutBatches']):null\n"+
    current.replace('keys.filter(',"keys.filter(k=>Boolean(liveProductionKeys?.has(k))||(").replace(/\)\s*$/,'))')
  app=app.slice(0,pos)+replacement+app.slice(lineEnd)
}
fs.writeFileSync(appFile,app)

const opsFile='src/pages/OperationsHub.jsx'
let ops=fs.readFileSync(opsFile,'utf8')
ops=ops.replaceAll("onSave({...db,orders:result.orders,_onlyKeys:['orders']})","onSave({...db,orders:result.orders})")
if(ops.includes("_onlyKeys:['orders']"))throw new Error('operations journey live: quedó _onlyKeys inválido en Centro operativo')
fs.writeFileSync(opsFile,ops)

if(!app.includes("liveProductionKeys=(target==='sheetplanner'||target==='operations')"))throw new Error('operations journey live: Centro operativo no refresca producción real')
if(!ops.includes('advanceOperationalJourney'))throw new Error('operations journey live: no quedó reconciliación operativa')
console.log('OPERATIONS JOURNEY LIVE OK · Centro operativo refresca orders/movements/cutBatches y persiste cambios reales')
