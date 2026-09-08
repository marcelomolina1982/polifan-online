import fs from 'node:fs'
const app=fs.readFileSync('src/AppV2.jsx','utf8')
if(!app.includes("target==='operations'?new Set(['orders','movements','cutBatches'])"))throw new Error('operations journey live: Centro operativo no refresca producción real')
const opsFile='src/pages/OperationsHub.jsx'
let ops=fs.readFileSync(opsFile,'utf8')
ops=ops.replaceAll("onSave({...db,orders:result.orders,_onlyKeys:['orders']})","onSave({...db,orders:result.orders})")
if(ops.includes("_onlyKeys:['orders']"))throw new Error('operations journey live: quedó _onlyKeys inválido en Centro operativo')
if(!ops.includes('advanceOperationalJourney'))throw new Error('operations journey live: no quedó reconciliación operativa')
fs.writeFileSync(opsFile,ops)
console.log('OPERATIONS JOURNEY LIVE OK · validación idempotente completada')
