import './prepare-v25.0.40.mjs'
import fs from 'node:fs'

// v25.0.42: Registrar corte terminado agrega movimientos nuevos sobre el estado
// MÁS RECIENTE de Supabase. No vuelve a comparar/reemplazar movimientos antiguos
// que pueden diferir del baseline local por una restauración o por otra sesión.
const appFile='src/App.jsx'
let app=fs.readFileSync(appFile,'utf8')
const needle=`      for(const key of changedKeys){
        if(MERGE_BY_RECORD.has(key)){`
const replacement=`      for(const key of changedKeys){
        if(key==='movements'){
          const prevList=previous?.movements||[],nextList=next?.movements||[]
          const prevMap=new Map(prevList.map(item=>[String(item?.id),item]))
          const nextMap=new Map(nextList.map(item=>[String(item?.id),item]))
          const appendOnly=nextList.length>=prevList.length&&[...prevMap.entries()].every(([id,item])=>nextMap.has(id)&&stableJson(nextMap.get(id))===stableJson(item))
          if(appendOnly){
            const latestList=latest?.movements||[]
            const latestIds=new Set(latestList.map(item=>String(item?.id)))
            const additions=nextList.filter(item=>!prevMap.has(String(item?.id))&&!latestIds.has(String(item?.id)))
            merged.movements=[...latestList,...additions]
            continue
          }
        }
        if(MERGE_BY_RECORD.has(key)){`
if(app.includes(needle)) app=app.replace(needle,replacement)
else if(!app.includes("if(key==='movements'){\n          const prevList=previous?.movements||[]")) throw new Error('v25.0.42: no se pudo instalar merge append-only de movements')
fs.writeFileSync(appFile,app)

// Forzar identificación de versión para que el navegador descarte cualquier build anterior.
const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.42'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.42'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · guardado de placas append-only · catálogo y SVG protegidos'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.42'")
fs.writeFileSync(swFile,sw)

const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.42'")
fs.writeFileSync(indexFile,index)

console.log('v25.0.42: movimientos de placas se anexan al estado remoto actual; no hay conflicto con movimientos históricos')
