import './prepare-v25.0.23.mjs'
import fs from 'node:fs'

const file='src/pages/MotorDefinitivo.jsx'
let text=fs.readFileSync(file,'utf8')

function rep(a,b,label){
  if(text.includes(b)) return
  if(!text.includes(a)) throw new Error(`v25.0.24 patch: no se encontró ${label}`)
  text=text.split(a).join(b)
}

rep('Sparrow V1.11 · Geometry Fit v25.0.23 · Objetivo 70%+','Sparrow V1.12 · Area First v25.0.24 · Objetivo 70%+','título')
rep('Sparrow V1.11 usa la placa completa de 1220 × 580 mm, reserva 3 mm en los cuatro bordes y prioriza una búsqueda intensiva de 12 completas con rotación fina, swaps globales y fallback seguro a la mejor placa certificada.','Sparrow V1.12 usa la placa completa de 1220 × 580 mm, reserva 3 mm en los cuatro bordes, garantiza un mínimo de 10 completas y desde ahí maximiza el porcentaje real de placa ocupada. La cantidad de figuras es secundaria.','aviso')
rep('objetivo mínimo ≥70% · gap 2,5 mm · foco 12 completas · swaps 1×2/2×3 · crecimiento 11→16 · fallback seguro','mínimo 10 completas · objetivo ≥70% de placa · gap 2,5 mm · ocupación primero · cantidad secundaria · fallback seguro','criterio')
rep('Sparrow V1.11 · Geometry Fit · foco 12 · 11→16 · borde 3 mm','Sparrow V1.12 · Area First · mínimo 10 · maximiza ocupación · borde 3 mm','arquitectura')
rep('V1.11 certificando…','V1.12 certificando…','certificación')
rep("clientBuild:'v25.0.23-geometry-fit-12focus',clientEngineVersion:'Sparrow V1.11 Geometry Fit'","clientBuild:'v25.0.24-area-first',clientEngineVersion:'Sparrow V1.12 Area First'",'payload')
rep('Sparrow V1.11 · ${plan.units.length} diseños','Sparrow V1.12 · ${plan.units.length} diseños','nota')

const old='Motor: {plan.selectorVersion||\'-\'} · completas: {plan.completeFigures||plan.units.length}'
const neu='Motor: {plan.selectorVersion||\'-\'} · completas: {plan.completeFigures||plan.units.length} · prioridad: {plan.optimizationPriority===\'plate-area-first\'?\'ocupación de placa\':\'geométrica\'}'
if(text.includes(old)) text=text.replace(old,neu)

rep('target12Focused:Boolean(data.target12Focused),runtimeSolver:data.runtimeSolver||null','target12Focused:Boolean(data.target12Focused),optimizationPriority:data.optimizationPriority||\'-\',countIsSecondary:Boolean(data.countIsSecondary),runtimeSolver:data.runtimeSolver||null','telemetría area-first')

fs.writeFileSync(file,text)
console.log('v25.0.24: Sparrow V1.12 Area First UI preparada')
