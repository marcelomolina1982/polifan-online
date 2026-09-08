import fs from 'node:fs'

// Las integraciones de Motor/En corte/Centro operativo se aplican en las etapas
// posteriores del build. Aquí sólo validamos el núcleo, sin regenerar código viejo.
const operational=fs.readFileSync('src/lib/customerJourneyOperational.js','utf8')
if(!operational.includes('advanceOperationalJourney')||!operational.includes('stockCoveredAt'))throw new Error('journey predeploy: falta reconciliación operativa por stock')
if(!operational.includes('projectedState.complete')||!operational.includes('finishedState.complete'))throw new Error('journey predeploy: faltan coberturas terminada/proyectada')
console.log('CUSTOMER JOURNEY PREDEPLOY OK · núcleo actual validado sin regeneradores históricos')
