import './finalize-v25.0.76.mjs'
import fs from 'node:fs'

/* Motor: el solver no puede usar el borde físico como espacio disponible.
   Dejamos 6 mm de guarda real en los cuatro lados. El certificador sigue
   exigiendo 3 mm, por lo que cualquier variación geométrica queda absorbida
   antes de llegar al borde de la placa. */
const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
if(!motor.includes('widthCm:122.4'))throw new Error('v25.0.77: no se encontró ancho útil anterior 122.4')
motor=motor.replace('widthCm:122.4','widthCm:121.8')
if(!motor.includes('const x=3+Number(p.xCm||0)*10,y=6+Number(p.yCm||0)*10,angle=Number(p.angle||0)'))throw new Error('v25.0.77: no se encontró offset horizontal anterior')
motor=motor.replace('const x=3+Number(p.xCm||0)*10,y=6+Number(p.yCm||0)*10,angle=Number(p.angle||0)','const x=6+Number(p.xCm||0)*10,y=6+Number(p.yCm||0)*10,angle=Number(p.angle||0)')
motor=motor.replaceAll('1224 × 568 mm útiles · margen vertical reforzado 6 mm','1218 × 568 mm útiles · guarda real 6 mm en los cuatro lados')
if(!motor.includes('widthCm:121.8')||!motor.includes('const x=6+Number(p.xCm||0)*10,y=6+Number(p.yCm||0)*10'))throw new Error('v25.0.77: no quedó área segura del motor')
fs.writeFileSync(motorFile,motor)

/* Los pedidos son datos operativos vivos. El cache local sigue sirviendo para
   el resto de los módulos, pero Pedidos / Nuevo pedido / Generar placas deben
   refrescar la sección orders al entrar para no ocultar altas o recuperaciones
   hechas por otra sesión o directamente en la base. */
const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
const oldMissing="const missing=full?keys:keys.filter(k=>!loadedRef.current.has(k))"
const newMissing="const liveOrderPages=new Set(['orders','new','sheetplanner']);const missing=full?keys:keys.filter(k=>(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
if(!app.includes(oldMissing))throw new Error('v25.0.77: no se encontró política de cache V2')
app=app.replace(oldMissing,newMissing)
if(!app.includes("liveOrderPages=new Set(['orders','new','sheetplanner'])"))throw new Error('v25.0.77: no quedó refresco operativo de orders')
fs.writeFileSync(appFile,app)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.77'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.77'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · centro operativo + borde seguro Motor + pedidos vivos'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.77-live-orders'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.77-live-orders'"))
console.log('v25.0.77 FINALIZE OK · Motor seguro + Pedidos/Nuevo/Motor refrescan orders desde servidor')
