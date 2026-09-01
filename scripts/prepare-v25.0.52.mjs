import './prepare-v25.0.51.mjs'
import fs from 'node:fs'

// v25.0.52: corrección puntual de Generar placas + scroll táctil del menú móvil.
// Mantiene intactas las demás correcciones de 25.0.51.

const v2DataFile='src/lib/v2Data.js'
let v2=fs.readFileSync(v2DataFile,'utf8')
const svgMeta=/export async function loadV2SvgMetadata\(\)\{[\s\S]*?\n\}/
if(!svgMeta.test(v2))throw new Error('v25.0.52: no encontré loadV2SvgMetadata para normalizar')
v2=v2.replace(svgMeta,`export async function loadV2SvgMetadata(){
  try{
    const {data,error}=await supabase.rpc('get_v2_svg_metadata')
    if(error)throw error
    const row=Array.isArray(data)?data[0]:data
    const payload=row?.data
    const library=Array.isArray(payload)?payload:(Array.isArray(payload?.svgLibrary)?payload.svgLibrary:[])
    return{data:library,updatedAt:row?.updated_at||''}
  }catch(error){
    if(!isSchemaCacheError(error))throw error
    console.warn('get_v2_svg_metadata no disponible; usando fallback de svgLibrary una vez.',error)
    const fallback=await fallbackSections(['svgLibrary'])
    const library=Array.isArray(fallback.data?.svgLibrary)?fallback.data.svgLibrary:[]
    return{data:library.map(item=>{const copy={...item};delete copy.svgText;return copy}),updatedAt:fallback.updatedAt||''}
  }
}`)
fs.writeFileSync(v2DataFile,v2)

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
const oldLoop='  ;(db.svgLibrary||[]).forEach(item=>{'
if(!motor.includes(oldLoop))throw new Error('v25.0.52: no encontré recorrido de svgLibrary en MotorDefinitivo')
motor=motor.replace(oldLoop,"  ;(Array.isArray(db.svgLibrary)?db.svgLibrary:[]).forEach(item=>{")
fs.writeFileSync(motorFile,motor)

const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
css+=`\n/* v25.0.52 · menú móvil con scroll táctil real */
@media(max-width:760px){
  .v2-shell .sidebar{
    position:fixed!important;
    top:0!important;
    bottom:0!important;
    left:0!important;
    height:100dvh!important;
    max-height:100dvh!important;
    overflow-x:hidden!important;
    overflow-y:auto!important;
    overscroll-behavior-y:contain!important;
    -webkit-overflow-scrolling:touch!important;
    touch-action:pan-y!important;
    padding-bottom:max(20px,env(safe-area-inset-bottom))!important;
  }
  .v2-shell .sidebar nav{padding-bottom:24px!important;overflow:visible!important}
  .v2-shell .side-help{position:static!important;left:auto!important;bottom:auto!important;width:auto!important;margin:8px 12px 20px!important}
}\n`
fs.writeFileSync(cssFile,css)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.52'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.52'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · corrección de motor y navegación móvil'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.52'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.52'")
fs.writeFileSync(indexFile,index)

console.log('v25.0.52: svgLibrary normalizada · Motor defensivo · sidebar móvil desplazable')
