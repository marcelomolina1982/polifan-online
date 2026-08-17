import './prepare-v25.0.22.mjs'
import fs from 'node:fs'

const file='src/pages/MotorDefinitivo.jsx'
let text=fs.readFileSync(file,'utf8')

function replaceAll(oldText,newText,label){
  if(!text.includes(oldText)){
    if(text.includes(newText)) return
    throw new Error(`v25.0.23 patch: no se encontró ${label}`)
  }
  text=text.split(oldText).join(newText)
}

replaceAll('Sparrow V1.10 · Global Recompact v25.0.22 · Objetivo 70%+','Sparrow V1.11 · Geometry Fit v25.0.23 · Objetivo 70%+','título')
replaceAll('Sparrow V1.10 recibe la placa completa, reserva 3 mm en los cuatro bordes y recompone globalmente la mejor placa para intentar 12+ sin perder la solución certificada anterior.','Sparrow V1.11 usa la placa completa de 1220 × 580 mm, reserva 3 mm en los cuatro bordes y prioriza una búsqueda intensiva de 12 completas con rotación fina, swaps globales y fallback seguro a la mejor placa certificada.','aviso')
replaceAll('objetivo mínimo ≥70% · gap 2,5 mm · Balanced Growth 11→16 + recompacción global 12+ · fallback seguro','objetivo mínimo ≥70% · gap 2,5 mm · foco 12 completas · swaps 1×2/2×3 · crecimiento 11→16 · fallback seguro','criterio')
replaceAll('Sparrow V1.10 · Global Recompact · 11→16 · borde 3 mm','Sparrow V1.11 · Geometry Fit · foco 12 · 11→16 · borde 3 mm','arquitectura')
replaceAll('V1.10 certificando…','V1.11 certificando…','certificación')
replaceAll("clientBuild:'v25.0.22-global-recompact',clientEngineVersion:'Sparrow V1.10 Global Recompact'","clientBuild:'v25.0.23-geometry-fit-12focus',clientEngineVersion:'Sparrow V1.11 Geometry Fit'",'payload versión')
replaceAll('Sparrow V1.10 · ${plan.units.length} diseños','Sparrow V1.11 · ${plan.units.length} diseños','nota placa')

// Telemetría extra para entender el espacio visual de la derecha. Sparrow minimiza strip-width;
// mostramos explícitamente cuánto queda libre sin confundirlo con un borde bloqueado.
const needle='<small className="block">Niveles: {Array.isArray(plan.attempts)?[...new Set(plan.attempts.map(a=>a.completeFigures).filter(Boolean))].join(\' → \'):\'-\'}</small>'
const addition=needle+'<small className="block">Ancho libre derecho: {Number.isFinite(Number(plan.unusedRightMm))?Number(plan.unusedRightMm).toFixed(0):Math.max(0,1220-Number(plan.stripWidthMm||plan.usedWidthMm||1220)).toFixed(0)} mm · strip-packing compacto</small>'
if(text.includes(needle)&&!text.includes('Ancho libre derecho:')) text=text.replace(needle,addition)

// Guardar telemetría nueva del backend en el plan.
replaceAll('recompactLevelsTried:Array.isArray(data.recompactLevelsTried)?data.recompactLevelsTried:[],runtimeSolver:data.runtimeSolver||null','recompactLevelsTried:Array.isArray(data.recompactLevelsTried)?data.recompactLevelsTried:[],unusedRightMm:Number(data.unusedRightMm),stripWidthMm:Number(data.stripWidthMm),target12Focused:Boolean(data.target12Focused),runtimeSolver:data.runtimeSolver||null','telemetría ancho libre')

fs.writeFileSync(file,text)
console.log('v25.0.23: Sparrow V1.11 Geometry Fit UI preparada')
