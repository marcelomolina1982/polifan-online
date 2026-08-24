import fs from 'node:fs'

const file='src/pages/MotorDefinitivo.jsx'
let text=fs.readFileSync(file,'utf8')

function patch(oldText,newText,label){
  if(text.includes(newText)) return
  if(!text.includes(oldText)){
    console.log(`v25.0.22: ${label} ya no coincide con esta rama; se omite sin romper el build`)
    return
  }
  text=text.replace(oldText,newText)
}

patch("const LAB_STORAGE='polifan-motor-lab-last-plan-v3'","const LAB_STORAGE='polifan-motor-lab-last-plan-v8-sparrow-v110-recompact'",'LAB_STORAGE')
patch("const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v1'","const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v6-sparrow-v110-recompact'\nconst DAILY_PLATE_KEY='polifan-motor-lab-daily-plate-v1'",'ACTIVE_JOB_STORAGE')
patch("function clearActiveJob(){try{localStorage.removeItem(ACTIVE_JOB_STORAGE)}catch{}}","function clearActiveJob(){try{localStorage.removeItem(ACTIVE_JOB_STORAGE)}catch{}}\nfunction nextDailyPlateNumber(){\n  const day=today()\n  try{\n    const row=JSON.parse(localStorage.getItem(DAILY_PLATE_KEY)||'null')\n    const next=row?.day===day?Number(row.number||0)+1:1\n    localStorage.setItem(DAILY_PLATE_KEY,JSON.stringify({day,number:next}))\n    return next\n  }catch{return 1}\n}",'numeración diaria')
patch("a.download=String(name||'placa.svg').replace(/\\.svg$/i,'')+'__SPARROW_CERTIFICADO.svg'","a.download=String(name||'Pedido-Placa').replace(/\\.svg$/i,'')+'.svg'",'nombre descarga')

patch("V1.7 certificando…","V1.10 certificando…",'texto certificación')
patch("const payload={widthCm:121.4,heightCm:58,gapCm:.3,targetDensity:75,kits:industrial.kits}","const payload={widthCm:122,heightCm:58,gapCm:.25,targetDensity:70,kits:industrial.kits,clientBuild:'v25.0.22-global-recompact',clientEngineVersion:'Sparrow V1.10 Global Recompact',maxGrowthTarget:16}",'payload Sparrow')
patch("const plan={id:crypto.randomUUID(),number:1,","const plan={id:crypto.randomUUID(),number:nextDailyPlateNumber(),",'número diario de placa')
patch("Sparrow + V1.7 · ${plan.units.length} diseños","Sparrow V1.10 · ${plan.units.length} diseños",'nota placa')
patch('Generar placas · Motor Sparrow + Certificador V1.7','Generar placas · Sparrow V1.10 · Global Recompact v25.0.22 · Objetivo 70%+','título')
patch('La placa real es 1220 × 580 mm. Sparrow diseña dentro de 1214 mm útiles para reservar 3 mm a cada lateral.','La placa real es 1220 × 580 mm. Sparrow V1.10 recibe la placa completa, reserva 3 mm en los cuatro bordes y recompone globalmente la mejor placa para intentar 12+ sin perder la solución certificada anterior.','aviso')
patch('objetivo ≥75%, sin descartar 11/12 válidas','objetivo mínimo ≥70% · gap 2,5 mm · Balanced Growth 11→16 + recompacción global 12+ · fallback seguro','criterio')
patch('Sparrow asíncrono · V1.7 certifica','Sparrow V1.10 · Global Recompact · 11→16 · borde 3 mm','arquitectura')
patch("plan.density>=75?'green-text':''","plan.density>=70?'green-text':''",'umbral color')
patch("plan.density>=75?'Objetivo ≥75% alcanzado':'Mejor placa válida encontrada'","plan.density>=70?'Objetivo ≥70% alcanzado':'Mejor placa válida encontrada'",'umbral visible')

patch("fixedHoleFill:Boolean(data.fixedHoleFill),multiplier,produced}","fixedHoleFill:Boolean(data.fixedHoleFill),selectorVersion:data.selectorVersion||'-',engine:data.engine||data.selectionStrategy||'sparrow',completeFigures:Number(data.completeFigures||selectedUnits.length),requiredGapMm:Number(data.requiredGapMm||0),labGapMm:Number(data.labGapMm||0),productiveTargetReached:Boolean(data.productiveTargetReached||data.targetDensityReached),attempts:Array.isArray(data.attempts)?data.attempts:[],growthContinuesAfterMiss:Boolean(data.growthContinuesAfterMiss),globalRecompact:Boolean(data.globalRecompact),recompactLevelsTried:Array.isArray(data.recompactLevelsTried)?data.recompactLevelsTried:[],runtimeSolver:data.runtimeSolver||null,asyncRuntimeVersion:data.asyncRuntimeVersion||'-',multiplier,produced}",'telemetría plan')

patch("{Number.isFinite(plan.density)&&<small className={'block '+(plan.density>=70?'green-text':'')}>{plan.density>=70?'Objetivo ≥70% alcanzado':'Mejor placa válida encontrada'}</small>}","{Number.isFinite(plan.density)&&<small className={'block '+(plan.density>=70?'green-text':'')}>{plan.density>=70?'Objetivo ≥70% alcanzado':'Mejor placa válida encontrada'}</small>}<small className=\"block\">Motor: {plan.selectorVersion||'-'} · completas: {plan.completeFigures||plan.units.length}</small><small className=\"block\">Runtime: {plan.runtimeSolver?.module||'-'}.{plan.runtimeSolver?.name||'-'} · {plan.asyncRuntimeVersion||'-'}</small><small className=\"block\">Intentos: {Array.isArray(plan.attempts)?plan.attempts.length:0} · gap motor: {plan.labGapMm||'-'} mm · requerido: {plan.requiredGapMm||'-'} mm</small><small className=\"block\">Niveles: {Array.isArray(plan.attempts)?[...new Set(plan.attempts.map(a=>a.completeFigures).filter(Boolean))].join(' → '):'-'}</small>{plan.globalRecompact&&<small className=\"block\">Recompacción global: {plan.recompactLevelsTried?.length?plan.recompactLevelsTried.join(' → '):'activa'}</small>}",'telemetría visible')

patch("downloadSvg(`pedido-${today()}-placa-${plan.number}`,plan.svgText)","downloadSvg(`Pedido-${today()}-Placa-${String(plan.number).padStart(2,'0')}`,plan.svgText)",'nombre Pedido fecha placa')

fs.writeFileSync(file,text)
console.log('v25.0.22: preparación tolerante aplicada; los parches obsoletos ya no bloquean el build')
