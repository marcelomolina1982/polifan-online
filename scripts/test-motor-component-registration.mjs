import fs from 'node:fs'
const motor=fs.readFileSync('src/pages/MotorDefinitivo.jsx','utf8')
if(!motor.includes("unit.repairComponent||unit.component||'complete'"))throw new Error('Motor: Registrar corte perdió base/tapa')
if(!motor.includes("plan.partialExtras||[plan.partialExtra]"))throw new Error('Motor: Registrar corte perdió piezas residuales')
if(/plan\.summary\.map\(x=>\(\{figure:x\.figure,component:'complete'/.test(motor))throw new Error('Motor: fuerza piezas como completas')
console.log('MOTOR COMPONENT REGISTRATION OK · base/tapa preservadas')
