import './prepare-v25.0.57.mjs'
import fs from 'node:fs'

const file='src/pages/MotorDefinitivo.jsx'
let s=fs.readFileSync(file,'utf8')
function replaceOnce(before,after,label){
  if(!s.includes(before))throw new Error('v25.0.61: no encontré '+label)
  const count=s.split(before).length-1
  if(count!==1)throw new Error('v25.0.61: '+label+' aparece '+count+' veces')
  s=s.replace(before,after)
}

replaceOnce("import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'","import {normalizeFigureKey} from '../lib/inventory'\nimport {pendingCutPlan} from '../lib/cutPlanning'",'import de planificación de corte')
replaceOnce('  pendingCutByDelivery(db).forEach(group=>group.rows.forEach(row=>{','  pendingCutPlan(db).forEach(group=>group.rows.forEach(row=>{','fuente de pendientes del motor')

if(s.includes('pendingCutByDelivery'))throw new Error('v25.0.61: el motor todavía depende del cálculo viejo de pendientes')
if(!s.includes('pendingCutPlan(db)'))throw new Error('v25.0.61: el motor no quedó conectado al cálculo único de producción')
fs.writeFileSync(file,s)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.61'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.61'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · planificación de corte unificada + Vía Cargo seguro'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.61'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.61'"))
console.log('v25.0.61: Motor y Para cortar usan la misma planificación; sin cambios al algoritmo Sparrow')
