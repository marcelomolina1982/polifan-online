import './prepare-v25.0.34.mjs'
import fs from 'node:fs'

// Modo operativo seguro: la PC del local no tiene la copia buena de la PC de casa.
// Desactivar cualquier recuperación automática basada en localStorage.
const appFile='src/App.jsx'
let app=fs.readFileSync(appFile,'utf8')
app=app.replace('const backupBueno=Array.isArray(snap?.figures)', 'const backupBueno=false&&Array.isArray(snap?.figures)')

// Protección adicional: si una acción declara __onlyKeys, saveData sólo considera esas claves.
if(!app.includes('const requestedOnlyKeys=Array.isArray(next?.__onlyKeys)')){
  throw new Error('v25.0.40: falta el aislamiento __onlyKeys de saveData')
}
fs.writeFileSync(appFile,app)

// Confirmar una placa sólo puede escribir movimientos + historial de placas.
const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
const unsafe="await onSave({...db,movements:[...(db.movements||[]),...movements],cutBatches:[...(db.cutBatches||[]),batch]})"
const safe="await onSave({...db,__onlyKeys:['movements','cutBatches'],movements:[...(db.movements||[]),...movements],cutBatches:[...(db.cutBatches||[]),batch]})"
if(motor.includes(unsafe)) motor=motor.split(unsafe).join(safe)
if(!motor.includes("__onlyKeys:['movements','cutBatches']")) throw new Error('v25.0.40: no quedó aislado Registrar corte terminado')
fs.writeFileSync(motorFile,motor)

const cutsFile='src/pages/CutBatches.jsx'
let cuts=fs.readFileSync(cutsFile,'utf8')
cuts=cuts.split("onSave({...db,movements,cutBatches})").join("onSave({...db,__onlyKeys:['movements','cutBatches'],movements,cutBatches})")
cuts=cuts.split("onSave({...db,movements:[...(db.movements||[]),...movements],cutBatches})").join("onSave({...db,__onlyKeys:['movements','cutBatches'],movements:[...(db.movements||[]),...movements],cutBatches})")
cuts=cuts.split("onSave({...db,movements:[...(db.movements||[]),...reversals],cutBatches})").join("onSave({...db,__onlyKeys:['movements','cutBatches'],movements:[...(db.movements||[]),...reversals],cutBatches})")
cuts=cuts.split("onSave({...db,cutBatches:[...(db.cutBatches||[]),batch]})").join("onSave({...db,__onlyKeys:['cutBatches'],cutBatches:[...(db.cutBatches||[]),batch]})")
fs.writeFileSync(cutsFile,cuts)

console.log('v25.0.40: modo operativo seguro activado; sin restauraciones locales; cortes aislados')
