import './prepare-v25.0.25.mjs'
import fs from 'node:fs'

const file='src/pages/MotorDefinitivo.jsx'
let text=fs.readFileSync(file,'utf8')

function rep(a,b,label,required=true){
  if(text.includes(b))return
  if(!text.includes(a)){
    if(required)throw new Error(`v25.0.26 patch: no se encontró ${label}`)
    return
  }
  text=text.split(a).join(b)
}

rep('Sparrow V1.13 · Residual Fill v25.0.25 · Objetivo 70%+','Sparrow V1.14 · Global Human Search v25.0.26 · Objetivo 70%+','título')
rep('Sparrow V1.13 conserva la mejor placa Area First certificada y después busca aprovechar los huecos residuales con hasta 3 bases/tapas sueltas, usando rotación fina. Las extras no cuentan como figuras completas y su contraparte queda pendiente para el próximo corte.','Sparrow V1.14 conserva primero una placa segura y luego ejecuta búsqueda global destroy-and-repair: prueba agregar una figura, retirar 1/2/3 y reinsertar 2/3/4, cambia órdenes y semillas y sólo acepta una nueva placa si queda certificada y mejora la ocupación.','aviso')
rep('mínimo 10 completas · objetivo ≥70% · gap 2,5 mm · ocupación primero · Residual Fill hasta 3 piezas · contraparte futura','mínimo 10 completas · objetivo ≥70% · gap 2,5 mm · Global Human Search · destroy-and-repair · fallback seguro','criterio')
rep('Sparrow V1.13 · Area First + Residual Fill · hasta 3 extras · borde 3 mm','Sparrow V1.14 · Global Human Search · +1 / D1R2 / D2R3 / D3R4 · borde 3 mm','arquitectura')
rep('V1.13 certificando…','V1.14 certificando…','certificación')
rep("clientBuild:'v25.0.25-residual-fill-v13',clientEngineVersion:'Sparrow V1.13 Area First + Residual Fill'","clientBuild:'v25.0.26-global-human-search-v14',clientEngineVersion:'Sparrow V1.14 Global Human Search'",'payload')
rep('Sparrow V1.13 · ${plan.units.length} diseños','Sparrow V1.14 · ${plan.units.length} diseños','nota',false)

// Telemetría del nuevo buscador. Es opcional para mantener compatibilidad con el fallback V1.13.
rep('residualFillV13:Boolean(data.residualFillV13),targetDensityReached:Boolean(data.targetDensityReached)','residualFillV13:Boolean(data.residualFillV13),globalHumanSearch:Boolean(data.globalHumanSearch),globalHumanSearchImproved:Boolean(data.globalHumanSearchImproved),globalHumanSearchAttempts:Number(data.globalHumanSearchAttempts||0),globalHumanSearchBaselineDensity:Number(data.globalHumanSearchBaselineDensity||0),globalHumanSearchBaselineCount:Number(data.globalHumanSearchBaselineCount||0),targetDensityReached:Boolean(data.targetDensityReached)','telemetría global',false)

const widthLine='<small className="block">Ancho libre derecho: {Number.isFinite(Number(plan.unusedRightMm))?Number(plan.unusedRightMm).toFixed(0):Math.max(0,1220-Number(plan.stripWidthMm||plan.usedWidthMm||1220)).toFixed(0)} mm · strip-packing compacto</small>'
const globalLine=widthLine+'{plan.globalHumanSearch&&<small className="block green-text">Global Human Search: {plan.globalHumanSearchImproved?`MEJORÓ · ${plan.globalHumanSearchBaselineCount||0}→${plan.units.length} completas · base ${Number(plan.globalHumanSearchBaselineDensity||0).toFixed(1)}%→${Number(plan.density||0).toFixed(1)}%`:`sin mejora · conservó baseline`} · {plan.globalHumanSearchAttempts||0} intentos</small>}'
if(text.includes(widthLine)&&!text.includes('Global Human Search: {plan.globalHumanSearchImproved'))text=text.replace(widthLine,globalLine)

fs.writeFileSync(file,text)
console.log('v25.0.26: Sparrow V1.14 Global Human Search UI preparada')
