import './prepare-v25.0.24.mjs'
import fs from 'node:fs'

const file='src/pages/MotorDefinitivo.jsx'
let text=fs.readFileSync(file,'utf8')

function rep(a,b,label){
  if(text.includes(b)) return
  if(!text.includes(a)) throw new Error(`v25.0.25 patch: no se encontró ${label}`)
  text=text.split(a).join(b)
}

rep('Sparrow V1.12 · Area First v25.0.24 · Objetivo 70%+','Sparrow V1.13 · Residual Fill v25.0.25 · Objetivo 70%+','título')
rep('Sparrow V1.12 usa la placa completa de 1220 × 580 mm, reserva 3 mm en los cuatro bordes, garantiza un mínimo de 10 completas y desde ahí maximiza el porcentaje real de placa ocupada. La cantidad de figuras es secundaria.','Sparrow V1.13 conserva la mejor placa Area First certificada y después busca aprovechar los huecos residuales con hasta 3 bases/tapas sueltas, usando rotación fina. Las extras no cuentan como figuras completas y su contraparte queda pendiente para el próximo corte.','aviso')
rep('mínimo 10 completas · objetivo ≥70% de placa · gap 2,5 mm · ocupación primero · cantidad secundaria · relleno opcional con base/tapa suelta','mínimo 10 completas · objetivo ≥70% · gap 2,5 mm · ocupación primero · Residual Fill hasta 3 piezas · contraparte futura','criterio')
rep('Sparrow V1.12 · Area First · mínimo 10 · relleno base/tapa · borde 3 mm','Sparrow V1.13 · Area First + Residual Fill · hasta 3 extras · borde 3 mm','arquitectura')
rep('V1.12 certificando…','V1.13 certificando…','certificación')
rep("clientBuild:'v25.0.24-area-first-partial-fill',clientEngineVersion:'Sparrow V1.12 Area First + Partial Fill'","clientBuild:'v25.0.25-residual-fill-v13',clientEngineVersion:'Sparrow V1.13 Area First + Residual Fill'",'payload')

rep("partialExtra:data.partialExtraAllowed?data.partialExtra:null,targetDensityReached:Boolean(data.targetDensityReached)","partialExtra:data.partialExtraAllowed?data.partialExtra:null,partialExtras:Array.isArray(data.partialExtras)?data.partialExtras:(data.partialExtraAllowed&&data.partialExtra?[data.partialExtra]:[]),partialExtraCount:Number(data.partialExtraCount||0),residualFillV13:Boolean(data.residualFillV13),targetDensityReached:Boolean(data.targetDensityReached)",'guardar extras')

const oldUi='{plan.partialExtra&&<small className="block green-text">Extra aprovechado: {plan.partialExtra.figure} · {plan.partialExtra.component} · próxima falta: {plan.partialExtra.missingCounterpart}</small>}'
const newUi='{Array.isArray(plan.partialExtras)&&plan.partialExtras.length>0&&<small className="block green-text">Residual Fill: {plan.partialExtras.length} extra(s) · {plan.partialExtras.map(x=>`${x.figure} ${x.component} → falta ${x.missingCounterpart}`).join(` · `)}</small>}'
if(text.includes(oldUi)) text=text.replace(oldUi,newUi)
else if(!text.includes('Residual Fill: {plan.partialExtras.length}')) throw new Error('v25.0.25 patch: no se encontró UI extras')

const oldRegister=`if(plan.partialExtra?.figure&&['base','tapa'].includes(String(plan.partialExtra.component||'').toLowerCase())){
      const component=String(plan.partialExtra.component).toLowerCase()
      const key=normalizeFigureKey(plan.partialExtra.figure)+'|'+component
      const cur=itemMap.get(key)||{figure:plan.partialExtra.figure,component,qty:0}
      cur.qty+=1;itemMap.set(key,cur)
    }`
const newRegister=`;(Array.isArray(plan.partialExtras)?plan.partialExtras:(plan.partialExtra?[plan.partialExtra]:[])).forEach(extra=>{
      if(!extra?.figure||!['base','tapa'].includes(String(extra.component||'').toLowerCase()))return
      const component=String(extra.component).toLowerCase()
      const key=normalizeFigureKey(extra.figure)+'|'+component
      const cur=itemMap.get(key)||{figure:extra.figure,component,qty:0}
      cur.qty+=1;itemMap.set(key,cur)
    })`
if(text.includes(oldRegister)) text=text.replace(oldRegister,newRegister)
else if(!text.includes('Array.isArray(plan.partialExtras)?plan.partialExtras')) throw new Error('v25.0.25 patch: no se encontró registro extras')

rep("notes:`Sparrow V1.12 Area First · ${plan.units.length} unidades atendidas · ${multiplier===2?'placa doble':'placa simple'} · ocupación ${Number(plan.density||0).toFixed(1)}% · ancho usado ${Number(plan.stripWidthMm||0).toFixed(0)} mm · separación ${plan.minGap} mm${plan.partialExtra?` · extra ${plan.partialExtra.figure} ${plan.partialExtra.component}; próxima falta ${plan.partialExtra.missingCounterpart}`:''}`","notes:`Sparrow V1.13 Residual Fill · ${plan.units.length} unidades atendidas · ${multiplier===2?'placa doble':'placa simple'} · ocupación ${Number(plan.density||0).toFixed(1)}% · ancho usado ${Number(plan.stripWidthMm||0).toFixed(0)} mm · separación ${plan.minGap} mm${Array.isArray(plan.partialExtras)&&plan.partialExtras.length?` · ${plan.partialExtras.length} extra(s): ${plan.partialExtras.map(x=>`${x.figure} ${x.component}; falta ${x.missingCounterpart}`).join(' | ')}`:''}`",'notas extras')

fs.writeFileSync(file,text)
console.log('v25.0.25: Sparrow V1.13 Residual Fill UI preparada')

// LAB FINAL: parche directo del archivo que realmente usa "Generar placas".
// Esto evita depender del plugin de Vite y elimina el solver local V1.12/V23 del preview.
const sheetFile='src/pages/SheetPlanner.jsx'
let sheet=fs.readFileSync(sheetFile,'utf8')
if(!sheet.includes("from '../lib/sparrowLab'")){
  sheet=sheet.replace(
    "import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'",
    "import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'\nimport { solveWithSparrowLab } from '../lib/sparrowLab'"
  )
}
const start='      // v23: una sola ruta de cálculo. Sin fetch, sin Render y sin segundo algoritmo.'
const end='      const response={ok:true,status:200}'
const a=sheet.indexOf(start)
const b=sheet.indexOf(end,a)
if(a<0||b<0) throw new Error('LAB FINAL: no se encontró el bloque local de SheetPlanner')
const cleanBlock=`      // LAB FINAL: única ruta de cálculo = Sparrow CLEAN en Render.\n      const clean=await solveWithSparrowLab(payload,{\n        onStage:stage=>setCalcProgress(v=>({...v,stage,elapsed:(Date.now()-started)/1000}))\n      })\n      const raw=clean.raw||{}\n      const data={\n        ...raw,\n        ok:true,\n        localStable:false,\n        engine:clean.engine||'Sparrow CLEAN Area-First',\n        completeFigures:Number(clean.completeFigures||raw.completeFigures||0),\n        placements:clean.placements||[],\n        density:Number(clean.geometricOccupancyPct||raw.geometricOccupancyPct||0),\n        compactness:Number(clean.materialInsideUsedStripPct||raw.materialInsideUsedStripPct||clean.geometricOccupancyPct||0),\n        usedWidthMm:Number(clean.stripWidthMm||raw.stripWidthMm||0),\n        usedHeightMm:num(sheetH,58)*10,\n        attempts:clean.attempts||[],\n        minimumTarget:1,\n        reachedMinimum:true,\n        reachedDensity:Number(clean.geometricOccupancyPct||0)>=Math.min(90,Math.max(70,num(minFill,70))),\n        selectionStrategy:clean.selectionStrategy||raw.selectionStrategy||'area-first'\n      }\n      const response={ok:true,status:200}`
sheet=sheet.slice(0,a)+cleanBlock+sheet.slice(b+end.length)
sheet=sheet.replace("industrial:false,localFallback:false,localStable:true","industrial:true,localFallback:false,localStable:false")
sheet=sheet.replace("'El motor local terminó sin componentes colocados.'","'Sparrow CLEAN terminó sin componentes colocados.'")
sheet=sheet.replace("bestStrategy:'Motor Polifan v23 · subconjuntos completos'","bestStrategy:data.selectionStrategy||'Sparrow CLEAN · Area-First'")
fs.writeFileSync(sheetFile,sheet)
console.log('LAB FINAL: SheetPlanner usa Sparrow CLEAN directo')
