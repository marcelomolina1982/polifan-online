import fs from 'node:fs'
const motor=fs.readFileSync('src/pages/MotorDefinitivo.jsx','utf8')
if(!motor.includes("unit.repairComponent||unit.component||'complete'"))throw new Error('Motor: Registrar corte perdió base/tapa')
if(!motor.includes("plan.partialExtras||[plan.partialExtra]"))throw new Error('Motor: Registrar corte perdió piezas residuales')
if(/plan\.summary\.map\(x=>\(\{figure:x\.figure,component:'complete'/.test(motor))throw new Error('Motor: fuerza piezas como completas')
console.log('MOTOR COMPONENT REGISTRATION OK · base/tapa preservadas')

if(!motor.includes("sourceJobId:plan.jobId"))throw new Error('Motor: el lote perdió sourceJobId')
if(!motor.includes("String(b.sourceJobId||'')===String(plan.jobId)"))throw new Error('Motor: falta idempotencia por sourceJobId')
if(!motor.includes("qty:Number(i.qty)*Math.max(1,multiplier)"))throw new Error('Motor: el movimiento no respeta multiplicador')
if(!motor.includes("isIronNestTransientError(error)"))throw new Error('Motor: timeout/red vuelve a perder el trabajo activo')
const transientCatch=motor.match(/catch\(error\)\{if\(isIronNestTransientError\(error\)\)\{([\s\S]*?)\}else\{/)
if(!transientCatch||/clearActiveJob\(|clearGenerationSession\(/.test(transientCatch[1]))throw new Error('Motor: la rama transitoria borra el trabajo recuperable')
console.log('MOTOR SAFETY OK · sourceJobId, idempotencia, multiplicador y recuperación preservados')
