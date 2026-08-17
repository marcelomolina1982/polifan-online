import fs from 'node:fs'

const file='src/pages/MotorDefinitivo.jsx'
let text=fs.readFileSync(file,'utf8')

function patch(oldText,newText,label){
  if(text.includes(newText)) return
  if(!text.includes(oldText)) throw new Error(`v25.0.21 patch: no se encontró ${label}`)
  text=text.replace(oldText,newText)
}

patch("const LAB_STORAGE='polifan-motor-lab-last-plan-v3'","const LAB_STORAGE='polifan-motor-lab-last-plan-v7-sparrow-v19-balanced-growth'",'LAB_STORAGE')
patch("const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v1'","const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v5-sparrow-v19-balanced-growth'",'ACTIVE_JOB_STORAGE')

patch("V1.7 certificando…","V1.9 certificando…",'texto de certificación')
patch("const payload={widthCm:121.4,heightCm:58,gapCm:.3,targetDensity:75,kits:industrial.kits}","const payload={widthCm:122,heightCm:58,gapCm:.25,targetDensity:70,kits:industrial.kits,clientBuild:'v25.0.21-balanced-growth',clientEngineVersion:'Sparrow V1.9 Balanced Growth',maxGrowthTarget:16}",'payload Sparrow')
patch("Sparrow + V1.7 · ${plan.units.length} diseños","Sparrow V1.9 · ${plan.units.length} diseños",'nota de placa')
patch('Generar placas · Motor Sparrow + Certificador V1.7','Generar placas · Sparrow V1.9 · Balanced Growth v25.0.21 · Objetivo 70%+','título')
patch('La placa real es 1220 × 580 mm. Sparrow diseña dentro de 1214 mm útiles para reservar 3 mm a cada lateral.','La placa real es 1220 × 580 mm. Sparrow V1.9 recibe la placa completa y anida dentro de 1214 × 574 mm útiles, reservando 3 mm en los cuatro bordes.','aviso de borde')
patch('objetivo ≥75%, sin descartar 11/12 válidas','objetivo mínimo ≥70% · gap 2,5 mm · Balanced Growth reparte tiempo entre 11/12/13/14/15/16 y conserva base 10','criterio productivo')
patch('Sparrow asíncrono · V1.7 certifica','Sparrow V1.9 · Balanced Growth · niveles 11→16 · borde 3 mm','arquitectura')
patch("plan.density>=75?'green-text':''","plan.density>=70?'green-text':''",'umbral de color')
patch("plan.density>=75?'Objetivo ≥75% alcanzado':'Mejor placa válida encontrada'","plan.density>=70?'Objetivo ≥70% alcanzado':'Mejor placa válida encontrada'",'umbral visible')

patch("fixedHoleFill:Boolean(data.fixedHoleFill),multiplier,produced}","fixedHoleFill:Boolean(data.fixedHoleFill),selectorVersion:data.selectorVersion||'-',engine:data.engine||data.selectionStrategy||'sparrow-jagua-rs',completeFigures:Number(data.completeFigures||selectedUnits.length),requiredGapMm:Number(data.requiredGapMm||0),labGapMm:Number(data.labGapMm||0),productiveTargetReached:Boolean(data.productiveTargetReached||data.targetDensityReached),attempts:Array.isArray(data.attempts)?data.attempts:[],growthContinuesAfterMiss:Boolean(data.growthContinuesAfterMiss),runtimeSolver:data.runtimeSolver||null,asyncRuntimeVersion:data.asyncRuntimeVersion||'-',multiplier,produced}",'telemetría plan')

patch("{Number.isFinite(plan.density)&&<small className={'block '+(plan.density>=70?'green-text':'')}>{plan.density>=70?'Objetivo ≥70% alcanzado':'Mejor placa válida encontrada'}</small>}","{Number.isFinite(plan.density)&&<small className={'block '+(plan.density>=70?'green-text':'')}>{plan.density>=70?'Objetivo ≥70% alcanzado':'Mejor placa válida encontrada'}</small>}<small className=\"block\">Motor: {plan.selectorVersion||'-'} · completas: {plan.completeFigures||plan.units.length}</small><small className=\"block\">Runtime: {plan.runtimeSolver?.module||'-'}.{plan.runtimeSolver?.name||'-'} · {plan.asyncRuntimeVersion||'-'}</small><small className=\"block\">Intentos: {Array.isArray(plan.attempts)?plan.attempts.length:0} · gap motor: {plan.labGapMm||'-'} mm · requerido: {plan.requiredGapMm||'-'} mm</small><small className=\"block\">Niveles: {Array.isArray(plan.attempts)?[...new Set(plan.attempts.map(a=>a.completeFigures).filter(Boolean))].join(' → '):'-'}</small>",'telemetría visible')

fs.writeFileSync(file,text)
console.log('v25.0.21: Sparrow V1.9 Balanced Growth + telemetría preparados')
