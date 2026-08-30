import './prepare-v25.0.62.mjs'
import fs from 'node:fs'

function replaceOnce(text,before,after,label){
  if(!text.includes(before))throw new Error('v25.0.63: no encontré '+label)
  const count=text.split(before).length-1
  if(count!==1)throw new Error('v25.0.63: '+label+' aparece '+count+' veces')
  return text.replace(before,after)
}

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
app=replaceOnce(app,"['assistant','✦','Asistencia ChatGPT'],['shippingtest','🚚','Probar envíos'],['quotes'","['assistant','✦','Asistente de ventas'],['quotes'",'menú unificado de ventas')
fs.writeFileSync(appFile,app)

const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
css+=`\n/* v25.0.63 · interfaz realmente clara */
.v2-shell .sidebar{background:#ffffff!important;border-right:1px solid #e4e8ef!important;box-shadow:6px 0 24px rgba(31,45,68,.05)!important}
.v2-shell .sidebar .brand{border-bottom:1px solid #edf0f4!important}.v2-shell .sidebar .brand small{color:#8a94a5!important}.v2-shell .sidebar .brand b{color:#1d2a3a!important}.v2-shell .sidebar .version-badge{background:#f5f7fb!important;color:#69778a!important;border-color:#e6eaf0!important}
.v2-shell .sidebar .nav-group>small{color:#9aa4b3!important}.v2-shell .sidebar nav button{color:#465468!important}.v2-shell .sidebar nav button:hover{background:#f4f7fb!important;color:#1d2a3a!important}.v2-shell .sidebar nav button.active{background:linear-gradient(135deg,#e82d79,#ff5b9f)!important;color:#fff!important;box-shadow:0 8px 18px rgba(232,45,121,.18)!important}
.v2-shell .sidebar .side-help{background:#f7f9fc!important;border-color:#e6eaf0!important;color:#263548!important}.v2-shell .sidebar .side-help small{color:#7d8999!important}
.delivery-group .delivery-head{background:#f7f9fc!important;color:#1d2a3a!important;border-bottom:1px solid #e6eaf0!important}.delivery-group .delivery-head small,.delivery-group .delivery-head span{color:#7d8999!important}.delivery-group .delivery-head>div>small{color:#d82a74!important}.delivery-group .delivery-head>b{background:#e8f8fb!important;color:#176f7d!important}
.v2-header-title small{color:#9aa4b3!important}.v2-header-title b{color:#1d2a3a!important}
`
fs.writeFileSync(cssFile,css)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.63'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.63'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · asistente de ventas unificado + interfaz clara'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.63'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.63'"))
console.log('v25.0.63 PREDEPLOY OK · asistente de ventas unificado · sidebar clara · clasificación logística/Vía Cargo')
