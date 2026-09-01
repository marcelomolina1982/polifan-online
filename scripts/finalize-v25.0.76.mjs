import './finalize-v25.0.75.mjs'
import fs from 'node:fs'

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
const oldChanged="const changedKeys=(before,after)=>[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>stable(before?.[k])!==stable(after?.[k]))"
const newChanged="const changedKeys=(before,after)=>{const requested=Array.isArray(after?._onlyKeys)?after._onlyKeys.filter(k=>typeof k==='string'&&!k.startsWith('_')):null;const candidates=requested?.length?requested:[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>!k.startsWith('_'));return [...new Set(candidates)].filter(k=>stable(before?.[k])!==stable(after?.[k]))}"
if(!app.includes(oldChanged))throw new Error('v25.0.76: no se encontró changedKeys original')
app=app.replace(oldChanged,newChanged)
fs.writeFileSync(appFile,app)

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
if(!motor.includes('heightCm:57.4'))throw new Error('v25.0.76: no se encontró altura útil 57.4')
motor=motor.replace('heightCm:57.4','heightCm:56.8')
if(!motor.includes('const x=3+Number(p.xCm||0)*10,y=3+Number(p.yCm||0)*10,angle=Number(p.angle||0)'))throw new Error('v25.0.76: no se encontró offset 3 mm')
motor=motor.replace('const x=3+Number(p.xCm||0)*10,y=3+Number(p.yCm||0)*10,angle=Number(p.angle||0)','const x=3+Number(p.xCm||0)*10,y=6+Number(p.yCm||0)*10,angle=Number(p.angle||0)')
motor=motor.replaceAll('1224 × 574 mm útiles','1224 × 568 mm útiles · margen vertical reforzado 6 mm')
fs.writeFileSync(motorFile,motor)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.76'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.76'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · guardado Motor + margen inferior reforzado'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.76'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.76'"))

if(!app.includes('after?._onlyKeys'))throw new Error('v25.0.76: no quedó soporte _onlyKeys')
if(!motor.includes('heightCm:56.8')||!motor.includes('y=6+Number(p.yCm||0)*10'))throw new Error('v25.0.76: no quedó margen vertical seguro')
console.log('v25.0.76 FINALIZE OK · _onlyKeys no entra a CAS · Motor usa 568 mm útiles y 6 mm de margen vertical')
