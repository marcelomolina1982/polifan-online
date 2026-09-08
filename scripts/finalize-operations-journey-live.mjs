import fs from 'node:fs'

// La modificación de AppV2 se hace en finalize-customer-journey-v2. A esta altura
// del build la política live puede incluir también Para cortar / En corte, por eso
// validamos capacidades en vez de exigir una cadena histórica exacta.
const appFile='src/AppV2.jsx'
const app=fs.readFileSync(appFile,'utf8')
const hasOperations=app.includes("target==='operations'")
const hasCoreProduction=app.includes("new Set(['orders','movements','cutBatches'])")
if(!hasOperations||!hasCoreProduction){
  throw new Error('operations journey live: Centro operativo no refresca producción real')
}

const opsFile='src/pages/OperationsHub.jsx'
let ops=fs.readFileSync(opsFile,'utf8')
ops=ops.replaceAll("onSave({...db,orders:result.orders,_onlyKeys:['orders']})","onSave({...db,orders:result.orders})")
if(ops.includes("_onlyKeys:['orders']"))throw new Error('operations journey live: quedó _onlyKeys inválido en Centro operativo')
if(!ops.includes('advanceOperationalJourney'))throw new Error('operations journey live: no quedó reconciliación operativa')
fs.writeFileSync(opsFile,ops)

console.log('OPERATIONS JOURNEY LIVE OK · validación compatible con política live actual')
