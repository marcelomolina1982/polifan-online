import fs from 'node:fs'

// La modificación de AppV2 se hace en finalize-customer-journey-v2, donde ya existe
// la política live generada por las etapas anteriores. Este paso sólo valida y limpia
// el save del Centro operativo para no depender del formato intermedio del build.
const appFile='src/AppV2.jsx'
const app=fs.readFileSync(appFile,'utf8')
if(!app.includes("liveProductionKeys=(target==='sheetplanner'||target==='operations')")||!app.includes("new Set(['orders','movements','cutBatches'])")){
  throw new Error('operations journey live: Centro operativo no refresca producción real')
}

const opsFile='src/pages/OperationsHub.jsx'
let ops=fs.readFileSync(opsFile,'utf8')
ops=ops.replaceAll("onSave({...db,orders:result.orders,_onlyKeys:['orders']})","onSave({...db,orders:result.orders})")
if(ops.includes("_onlyKeys:['orders']"))throw new Error('operations journey live: quedó _onlyKeys inválido en Centro operativo')
if(!ops.includes('advanceOperationalJourney'))throw new Error('operations journey live: no quedó reconciliación operativa')
fs.writeFileSync(opsFile,ops)

console.log('OPERATIONS JOURNEY LIVE OK · validación idempotente completada')
