import fs from 'node:fs'
const motor=fs.readFileSync('src/pages/MotorDefinitivo.jsx','utf8')
if(!motor.includes("unit.repairComponent||'complete'"))throw new Error('Motor: Registrar corte perdió el tipo base/tapa')
if(!motor.includes("plan.partialExtras||[plan.partialExtra]"))throw new Error('Motor: Registrar corte perdió piezas residuales')
if(/plan\.summary\.map\(x=>\(\{figure:x\.figure,component:'complete'/.test(motor))throw new Error('Motor: todavía fuerza piezas como figuras completas')
console.log('MOTOR COMPONENT REGISTRATION OK · base/tapa preservadas')
