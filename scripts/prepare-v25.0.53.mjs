import './prepare-v25.0.52.mjs'
import fs from 'node:fs'

// v25.0.53: hidratar geometría antes del cálculo normal + pulido menú + warning limpio.

function mustReplace(text,before,after,label){
  if(!text.includes(before)) throw new Error('v25.0.53: no encontré '+label)
  const count=text.split(before).length-1
  if(count!==1) throw new Error(`v25.0.53: ${label} aparece ${count} veces; no aplico cambio ambiguo`)
  return text.replace(before,after)
}

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')

motor=mustReplace(
  motor,
  "    const designUnits=unitsForMultiplier(pending.units,multiplier)\n    const industrial=buildIndustrialKits(designUnits)",
  "    const designUnits=await hydrateUnits(unitsForMultiplier(pending.units,multiplier))\n    const invalidGeometry=designUnits.flatMap(u=>u.components||[]).filter(c=>!c?.svgText)\n    if(invalidGeometry.length)throw new Error(`No se pudo cargar la geometría de ${invalidGeometry.length} componente(s) SVG. Volvé a intentar una vez.`)\n    const industrial=buildIndustrialKits(designUnits)",
  'generación normal sin hidratación SVG'
)

const duplicateStrip="unusedRightMm:Number(data.unusedRightMm),stripWidthMm:Number(data.stripWidthMm),target12Focused:"
if(motor.includes(duplicateStrip)){
  motor=motor.replace(duplicateStrip,"unusedRightMm:Number(data.unusedRightMm),target12Focused:")
}
if((motor.match(/stripWidthMm:/g)||[]).length>1){
  // El objeto plan debe tener una sola clave stripWidthMm. El resto de usos de la variable son lecturas.
  const planLine=motor.split('\n').find(line=>line.includes('const plan={'))||''
  const planCount=(planLine.match(/stripWidthMm:/g)||[]).length
  if(planCount>1) throw new Error('v25.0.53: stripWidthMm sigue duplicado en const plan')
}
fs.writeFileSync(motorFile,motor)

const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
css+=`\n/* v25.0.53 · selección móvil alineada */
@media(max-width:760px){
  .v2-shell .sidebar nav button{
    width:100%!important;
    max-width:100%!important;
    box-sizing:border-box!important;
    display:flex!important;
    align-items:center!important;
    justify-content:flex-start!important;
    gap:10px!important;
    transform:none!important;
  }
  .v2-shell .sidebar nav button>span{
    flex:0 0 28px!important;
    width:28px!important;
    min-width:28px!important;
    margin:0!important;
    text-align:center!important;
  }
  .v2-shell .sidebar nav button.active{transform:none!important}
}\n`
fs.writeFileSync(cssFile,css)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.53'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.53'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · geometría SVG conectada al motor 1230'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.53'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.53'")
fs.writeFileSync(indexFile,index)

console.log('v25.0.53: generación normal hidrata SVG · selección móvil alineada · stripWidthMm saneado')
