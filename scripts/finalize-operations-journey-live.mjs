import fs from 'node:fs'

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
const oldLive="const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):null"
const newLive="const liveProductionKeys=(target==='sheetplanner'||target==='operations')?new Set(['orders','movements','cutBatches']):null"
if(app.includes(oldLive))app=app.replace(oldLive,newLive)
else if(!app.includes(newLive))throw new Error('operations journey live: no se encontró política de refresco V2')
fs.writeFileSync(appFile,app)

const opsFile='src/pages/OperationsHub.jsx'
let ops=fs.readFileSync(opsFile,'utf8')
const oldSave="onSave({...db,orders:result.orders,_onlyKeys:['orders']})"
const newSave="onSave({...db,orders:result.orders})"
if(ops.includes(oldSave))ops=ops.replaceAll(oldSave,newSave)
if(ops.includes("_onlyKeys:['orders']"))throw new Error('operations journey live: quedó _onlyKeys inválido en Centro operativo')
fs.writeFileSync(opsFile,ops)

if(!app.includes("target==='sheetplanner'||target==='operations'"))throw new Error('operations journey live: Centro operativo no refresca producción real')
if(!ops.includes('advanceOperationalJourney'))throw new Error('operations journey live: no quedó reconciliación operativa')
console.log('OPERATIONS JOURNEY LIVE OK · Centro operativo refresca orders/movements/cutBatches y persiste sólo cambios reales')
