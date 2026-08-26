import './prepare-v25.0.45.mjs'
import fs from 'node:fs'

// v25.0.46: unificar figuras siempre sobre el estado MÁS RECIENTE de Supabase.
// Evita conflictos por arrays completos (orders/movements/figures/etc.) cuando otra
// sesión o un refresco modificó datos desde que se abrió Inventario.
const appFile='src/App.jsx'
let app=fs.readFileSync(appFile,'utf8')
if(!app.includes("mergeFigureInto")){
  app=app.replace("import {APP_VERSION_LABEL,APP_UPDATED_AT} from './version'", "import {APP_VERSION_LABEL,APP_UPDATED_AT} from './version'\nimport {mergeFigureInto} from './lib/inventory'")
}
const loopNeedle=`      for(const key of changedKeys){`
const loopReplacement=`      if(next?.__figureMerge){
        const op=next.__figureMerge
        const migrated=mergeFigureInto(latest,op.source,op.target)
        if(migrated.error){savingRef.current=false;setSaving(false);alert(migrated.error);return{ok:false,error:new Error(migrated.error)}}
        const safeKeys=['figures','stockMin','orders','movements','cutBatches','generatedSheets','svgLibrary']
        safeKeys.forEach(key=>{merged[key]=migrated.db[key]})
      }else for(const key of changedKeys){`
if(app.includes(loopNeedle)) app=app.replace(loopNeedle,loopReplacement)
else if(!app.includes("if(next?.__figureMerge)")) throw new Error('v25.0.46: no se pudo instalar merge remoto de figuras')
fs.writeFileSync(appFile,app)

const stockFile='src/pages/StockBase.jsx'
let stock=fs.readFileSync(stockFile,'utf8')
const oldManual=`    const saved=await onSave(result.db)`
const newManual=`    const saved=await onSave({...result.db,__onlyKeys:['figures','stockMin','orders','movements','cutBatches','generatedSheets','svgLibrary'],__figureMerge:{source,target:keep}})`
if(stock.includes(oldManual)) stock=stock.replace(oldManual,newManual)
else if(!stock.includes('__figureMerge:{source,target:keep}')) throw new Error('v25.0.46: no se pudo marcar unificación manual')
fs.writeFileSync(stockFile,stock)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.46'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.46'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · unificación de figuras sobre estado remoto actual'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.46'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.46'")
fs.writeFileSync(indexFile,index)
console.log('v25.0.46: unificar figura migra el estado remoto actual sin conflictos de arrays completos')
