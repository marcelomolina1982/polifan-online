import './finalize-v25.0.67.mjs'
import fs from 'node:fs'

function one(text,before,after,label){
  const count=text.split(before).length-1
  if(count!==1)throw new Error(`finalize-v25.0.68: ${label} aparece ${count} veces`)
  return text.replace(before,after)
}

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')

// El certificador exige borde real de 3 mm en una placa 1230×580:
// área útil = 1224×574. Sparrow debe resolver exactamente dentro de esa área.
const payloadRx=/const payload=\{widthCm:[0-9.]+,heightCm:[0-9.]+,gapCm:\.3,targetDensity:75,kits:industrial\.kits\}/g
const payloadMatches=motor.match(payloadRx)||[]
if(payloadMatches.length!==1)throw new Error(`finalize-v25.0.68: payload del solver aparece ${payloadMatches.length} veces`)
motor=motor.replace(payloadRx,"const payload={widthCm:122.4,heightCm:57.4,gapCm:.3,targetDensity:75,kits:industrial.kits}")

// Las coordenadas del solver son relativas al área útil. Al componer la placa
// completa, trasladamos todo +3 mm en X/Y para respetar el borde certificado.
motor=one(
  motor,
  "const x=Number(p.xCm||0)*10,y=Number(p.yCm||0)*10,angle=Number(p.angle||0)",
  "const x=3+Number(p.xCm||0)*10,y=3+Number(p.yCm||0)*10,angle=Number(p.angle||0)",
  'offset de borde de 3 mm'
)

// El SVG certificado debe poder descargarse sin tener que desplazarse hasta la
// última columna de una tabla muy ancha.
motor=one(
  motor,
  "<small className=\"block\">{plan.deferred} quedan pendientes</small></td>",
  "<small className=\"block\">{plan.deferred} quedan pendientes</small>{ok&&plan.svgText&&<button className=\"ghost\" style={{marginTop:8,width:'100%',whiteSpace:'nowrap'}} onClick={()=>downloadSvg(`pedido-${today()}-placa-${plan.number}`,plan.svgText)}>Descargar SVG</button>}</td>",
  'descarga visible junto a la placa'
)

if(!motor.includes('widthCm:122.4,heightCm:57.4'))throw new Error('No quedó área útil 1224×574')
if(!motor.includes('const x=3+Number(p.xCm||0)*10,y=3+Number(p.yCm||0)*10'))throw new Error('No quedó offset de borde')
fs.writeFileSync(motorFile,motor)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.68'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.68'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Motor dentro del área certificable + descarga SVG visible'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.68'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.68'"))

console.log('v25.0.68 FINALIZE OK · área útil 1224×574 · borde +3 mm · descarga SVG visible')
