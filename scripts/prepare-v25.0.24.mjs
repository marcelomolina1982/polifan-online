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
rep('objetivo mínimo ≥70% · gap 2,5 mm · foco 12 completas · swaps 1×2/2×3 · crecimiento 11→16 · fallback seguro','mínimo 10 completas · objetivo ≥70% de placa · gap 2,5 mm · ocupación primero · cantidad secundaria · relleno opcional con base/tapa suelta','criterio')
rep('Sparrow V1.11 · Geometry Fit · foco 12 · 11→16 · borde 3 mm','Sparrow V1.12 · Area First · mínimo 10 · relleno base/tapa · borde 3 mm','arquitectura')
rep('V1.11 certificando…','V1.12 certificando…','certificación')
rep("clientBuild:'v25.0.23-geometry-fit-12focus',clientEngineVersion:'Sparrow V1.11 Geometry Fit'","clientBuild:'v25.0.24-area-first-partial-fill',clientEngineVersion:'Sparrow V1.12 Area First + Partial Fill'",'payload')
rep('Sparrow V1.11 · ${plan.units.length} diseños','Sparrow V1.12 · ${plan.units.length} diseños','nota')

// Inventario: traer balance de tapas/bases para que la placa siguiente corte sólo la contraparte faltante.
rep("import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'","import {pendingCutByDelivery,normalizeFigureKey,stockRows} from '../lib/inventory'",'import stockRows')

const pendingOld=`function pendingUnits(db,index){
  const units=[],missing=new Map()
  pendingCutByDelivery(db).forEach(group=>group.rows.forEach(row=>{
    const comps=componentsForFigure(index,row.figure)
    if(!comps){missing.set(row.figure,(missing.get(row.figure)||0)+Number(row.qty||0));return}
    for(let i=0;i<Number(row.qty||0);i++)units.push({figure:row.figure,date:group.date||'',orders:group.orders||[],components:comps})
  }))
  return {units,missing:[...missing.entries()].map(([figure,qty])=>({figure,qty}))}
}`
const pendingNew=`function pendingUnits(db,index){
  const units=[],missing=new Map()
  const stockByKey=new Map(stockRows(db).map(row=>[normalizeFigureKey(row.figure),row]))
  const futurePairsLeft=new Map([...stockByKey.entries()].map(([key,row])=>[key,Number(row.futurePairs||0)]))
  const repairLeft=new Map([...stockByKey.entries()].map(([key,row])=>[key,Number(row.missingPart?.qty||0)]))
  pendingCutByDelivery(db).forEach(group=>group.rows.forEach(row=>{
    const key=normalizeFigureKey(row.figure)
    let qty=Number(row.qty||0)
    const covered=Math.min(qty,Number(futurePairsLeft.get(key)||0))
    if(covered>0){qty-=covered;futurePairsLeft.set(key,Number(futurePairsLeft.get(key)||0)-covered)}
    if(qty<=0)return
    const comps=componentsForFigure(index,row.figure)
    if(!comps){missing.set(row.figure,(missing.get(row.figure)||0)+qty);return}
    const stock=stockByKey.get(key)
    for(let i=0;i<qty;i++){
      const repairType=Number(repairLeft.get(key)||0)>0?stock?.missingPart?.type:null
      const repairComp=repairType?comps.find(c=>(c.role||'').toLowerCase()===repairType):null
      if(repairComp){
        units.push({figure:row.figure,date:group.date||'',orders:group.orders||[],components:[repairComp],repairComponent:repairType,pairedFromLoose:repairType==='base'?'tapa':'base'})
        repairLeft.set(key,Number(repairLeft.get(key)||0)-1)
      }else{
        units.push({figure:row.figure,date:group.date||'',orders:group.orders||[],components:comps})
      }
    }
  }))
  return {units,missing:[...missing.entries()].map(([figure,qty])=>({figure,qty}))}
}`
if(text.includes(pendingOld)) text=text.replace(pendingOld,pendingNew)
else if(!text.includes('futurePairsLeft=new Map')) throw new Error('v25.0.24 patch: no se encontró pendingUnits')

// Conservar la marca repairComponent al mapear kit -> unidad.
rep("unitMap.set(kitId,unit)","unitMap.set(kitId,unit)",'unit map marker')

// Telemetría Area First + ancho residual.
const old='Motor: {plan.selectorVersion||\'-\'} · completas: {plan.completeFigures||plan.units.length}'
const neu='Motor: {plan.selectorVersion||\'-\'} · completas: {plan.completeFigures||plan.units.length} · prioridad: {plan.optimizationPriority===\'plate-area-first\'?\'ocupación de placa\':\'geométrica\'}'
if(text.includes(old)) text=text.replace(old,neu)
rep('target12Focused:Boolean(data.target12Focused),runtimeSolver:data.runtimeSolver||null','target12Focused:Boolean(data.target12Focused),optimizationPriority:data.optimizationPriority||\'-\',countIsSecondary:Boolean(data.countIsSecondary),loosePartFill:Boolean(data.loosePartFill),runtimeSolver:data.runtimeSolver||null','telemetría area-first')

const needle='<small className="block">Niveles: {Array.isArray(plan.attempts)?[...new Set(plan.attempts.map(a=>a.completeFigures).filter(Boolean))].join(\' → \'):\'-\'}</small>'
const addition=needle+'<small className="block">Ancho libre derecho: {Number.isFinite(Number(plan.unusedRightMm))?Number(plan.unusedRightMm).toFixed(0):Math.max(0,1220-Number(plan.stripWidthMm||1220)).toFixed(0)} mm · strip-packing compacto</small>{plan.partialExtra&&<small className="block green-text">Extra aprovechado: {plan.partialExtra.figure} · {plan.partialExtra.component} · próxima falta: {plan.partialExtra.missingCounterpart}</small>}'
if(text.includes(needle)&&!text.includes('Extra aprovechado:')) text=text.replace(needle,addition)

// Guardar telemetría y la pieza suelta en el plan.
rep('recompactLevelsTried:Array.isArray(data.recompactLevelsTried)?data.recompactLevelsTried:[],runtimeSolver:data.runtimeSolver||null','recompactLevelsTried:Array.isArray(data.recompactLevelsTried)?data.recompactLevelsTried:[],unusedRightMm:Number(data.unusedRightMm),stripWidthMm:Number(data.stripWidthMm),target12Focused:Boolean(data.target12Focused),optimizationPriority:data.optimizationPriority||\'-\',countIsSecondary:Boolean(data.countIsSecondary),loosePartFill:Boolean(data.loosePartFill),runtimeSolver:data.runtimeSolver||null','telemetría completa')

// Registrar correctamente qué se corta: completas, reparaciones de una sola pieza y extra residual.
const registerOld="const items=[...plan.summary.map(x=>({figure:x.figure,component:'complete',qty:x.qty}))]"
const registerNew=`const itemMap=new Map()
    ;(plan.units||[]).forEach(unit=>{
      const component=unit.repairComponent||'complete'
      const key=normalizeFigureKey(unit.figure)+'|'+component
      const cur=itemMap.get(key)||{figure:unit.figure,component,qty:0}
      cur.qty+=1;itemMap.set(key,cur)
    })
    if(plan.partialExtra?.figure&&['base','tapa'].includes(String(plan.partialExtra.component||'').toLowerCase())){
      const component=String(plan.partialExtra.component).toLowerCase()
      const key=normalizeFigureKey(plan.partialExtra.figure)+'|'+component
      const cur=itemMap.get(key)||{figure:plan.partialExtra.figure,component,qty:0}
      cur.qty+=1;itemMap.set(key,cur)
    }
    const items=[...itemMap.values()]`
if(text.includes(registerOld)) text=text.replace(registerOld,registerNew)
else if(!text.includes('const itemMap=new Map()')) throw new Error('v25.0.24 patch: no se encontró items register')

const notesOld="notes:`Sparrow V1.10 · ${plan.units.length} diseños · ${multiplier===2?'placa doble':'placa simple'} · ocupación ${Number(plan.density||0).toFixed(1)}% · ancho usado ${Number(plan.stripWidthMm||0).toFixed(0)} mm · separación ${plan.minGap} mm`"
const notesNew="notes:`Sparrow V1.12 Area First · ${plan.units.length} unidades atendidas · ${multiplier===2?'placa doble':'placa simple'} · ocupación ${Number(plan.density||0).toFixed(1)}% · ancho usado ${Number(plan.stripWidthMm||0).toFixed(0)} mm · separación ${plan.minGap} mm${plan.partialExtra?` · extra ${plan.partialExtra.figure} ${plan.partialExtra.component}; próxima falta ${plan.partialExtra.missingCounterpart}`:''}`"
if(text.includes(notesOld)) text=text.replace(notesOld,notesNew)

fs.writeFileSync(file,text)
console.log('v25.0.24: Sparrow V1.12 Area First + relleno base/tapa + reparación futura preparados')
