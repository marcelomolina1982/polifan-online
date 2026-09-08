import fs from 'node:fs'

// El Customer Journey ya vive en el código fuente actual. Este predeploy no vuelve
// a ejecutar la cadena histórica de finalizers: sólo valida que las piezas críticas
// existan antes de permitir un deploy.
const operational=fs.readFileSync('src/lib/customerJourneyOperational.js','utf8')
const operations=fs.readFileSync('src/pages/OperationsHub.jsx','utf8')
const motor=fs.readFileSync('src/pages/MotorDefinitivo.jsx','utf8')
const cuts=fs.readFileSync('src/pages/CutBatches.jsx','utf8')
const data=fs.readFileSync('src/lib/v2Data.js','utf8')

if(!operational.includes('advanceOperationalJourney')||!operational.includes('stockCoveredAt'))throw new Error('journey predeploy: falta reconciliación operativa por stock')
if(!motor.includes('advanceOperationalJourney'))throw new Error('journey predeploy: Motor no reconcilia seguimiento al registrar corte')
if(!cuts.includes('advanceOperationalJourney'))throw new Error('journey predeploy: En corte no reconcilia seguimiento')
if(!operations.includes('advanceOperationalJourney'))throw new Error('journey predeploy: Centro operativo no reconcilia seguimiento')
if(!data.includes("sheetplanner:['orders','movements'"))throw new Error('journey predeploy: Generar placas no carga movimientos')
console.log('CUSTOMER JOURNEY PREDEPLOY OK · fuente actual validada sin regeneradores históricos')
