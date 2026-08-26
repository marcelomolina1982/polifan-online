import './prepare-v25.0.46.mjs'
import fs from 'node:fs'

// v25.0.47: v25.0.46 marcó por error la PRIMERA llamada onSave(result.db),
// que pertenece a limpieza automática. La unificación MANUAL seguía usando el guardado viejo.
// Corregir ambas cosas: limpieza automática vuelve a su llamada normal y mergeManual
// envía __figureMerge para que App migre sobre el estado remoto más reciente.
const stockFile='src/pages/StockBase.jsx'
let stock=fs.readFileSync(stockFile,'utf8')

// Deshacer marca errónea dentro de cleanDuplicates (source/keep ni siquiera existen allí).
stock=stock.replace(
  "const saved=await onSave({...result.db,__onlyKeys:['figures','stockMin','orders','movements','cutBatches','generatedSheets','svgLibrary'],__figureMerge:{source,target:keep}})",
  "const saved=await onSave(result.db)"
)

// Marcar específicamente la llamada que está dentro de mergeManual, usando el contexto previo.
const manualNeedle=`    const result=mergeFigureInto(db,source,keep)
    if(result.error)return alert(result.error)
    const saved=await onSave(result.db)`
const manualReplacement=`    const result=mergeFigureInto(db,source,keep)
    if(result.error)return alert(result.error)
    const saved=await onSave({...result.db,__onlyKeys:['figures','stockMin','orders','movements','cutBatches','generatedSheets','svgLibrary'],__figureMerge:{source,target:keep}})`
if(stock.includes(manualNeedle)) stock=stock.replace(manualNeedle,manualReplacement)
else if(!stock.includes("__figureMerge:{source,target:keep}")) throw new Error('v25.0.47: no se pudo marcar mergeManual')
fs.writeFileSync(stockFile,stock)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.47'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.47'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · unificación manual remota corregida'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.47'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.47'")
fs.writeFileSync(indexFile,index)
console.log('v25.0.47: mergeManual usa __figureMerge y migra sobre Supabase actual')
