import './finalize-v25.0.66.mjs'
import fs from 'node:fs'

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
const oldRoute='/api/nest-status?id='
const occurrences=motor.split(oldRoute).length-1
if(occurrences<1)throw new Error('finalize-v25.0.67: no se encontró la ruta de estado anterior')
motor=motor.replaceAll(oldRoute,'/api/nest-status-v5?id=')
if(!motor.includes('/api/nest-status-v5?id='))throw new Error('finalize-v25.0.67: no quedó el proxy V5 nuevo')
fs.writeFileSync(motorFile,motor)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.67'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.67'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Motor V5 proxy fresco + seguridad consolidada'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.67'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.67'"))

console.log('v25.0.67 FINALIZE OK · estado Motor usa proxy V5 nuevo · seguridad y envíos heredados de 25.0.66')
