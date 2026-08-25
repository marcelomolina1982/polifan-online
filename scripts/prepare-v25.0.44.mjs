import './prepare-v25.0.43.mjs'
import fs from 'node:fs'

// v25.0.44: una figura extra es una modificación aditiva de cutBatches.
// Si otra sesión/refresco cambió la misma placa, conservar la placa remota actual
// y aplicar solamente el incremento de items solicitado, sin pisar otros campos.
const appFile='src/App.jsx'
let app=fs.readFileSync(appFile,'utf8')
const needle=`        if(key==='movements'){
          const prevList=previous?.movements||[],nextList=next?.movements||[]`
const replacement=`        if(key==='cutBatches'&&next?.__cutBatchExtra){
          const extra=next.__cutBatchExtra
          const latestList=latest?.cutBatches||[]
          const target=latestList.find(b=>String(b?.id)===String(extra.batchId))
          if(!target){conflicts.push('cutBatches (placa no encontrada)');continue}
          const items=(target.items||[]).map(i=>({...i}))
          const found=items.find(i=>String(i.figure||'').localeCompare(String(extra.figure||''),'es',{sensitivity:'base'})===0&&(i.component||'complete')==='complete')
          if(found)found.qty=Number(found.qty||0)+Number(extra.qty||1)
          else items.push({figure:extra.figure,component:'complete',qty:Number(extra.qty||1)})
          merged.cutBatches=latestList.map(b=>String(b?.id)===String(extra.batchId)?{...b,items,updatedAt:new Date().toISOString()}:b)
          continue
        }
        if(key==='movements'){
          const prevList=previous?.movements||[],nextList=next?.movements||[]`
if(app.includes(needle)) app=app.replace(needle,replacement)
else if(!app.includes("if(key==='cutBatches'&&next?.__cutBatchExtra)")) throw new Error('v25.0.44: no se pudo instalar merge aditivo de figura extra')
fs.writeFileSync(appFile,app)

const cutsFile='src/pages/CutBatches.jsx'
let cuts=fs.readFileSync(cutsFile,'utf8')
const oldSave=`    const saved=await onSave({...db,__onlyKeys:['movements','cutBatches'],movements,cutBatches})`
const newSave=`    const saved=await onSave({...db,__onlyKeys:['movements','cutBatches'],__cutBatchExtra:{batchId:batch.id,figure,qty},movements,cutBatches})`
if(cuts.includes(oldSave)) cuts=cuts.replace(oldSave,newSave)
else if(!cuts.includes('__cutBatchExtra:{batchId:batch.id,figure,qty}')) throw new Error('v25.0.44: no se pudo marcar operación extra')
fs.writeFileSync(cutsFile,cuts)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.44'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.44'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · figura extra con merge seguro sobre placa actual'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.44'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.44'")
fs.writeFileSync(indexFile,index)
console.log('v25.0.44: figura extra se aplica sobre la versión remota actual de la placa sin conflicto')
