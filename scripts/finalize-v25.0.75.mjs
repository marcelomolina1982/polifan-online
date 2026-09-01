import './finalize-v25.0.74.mjs'
import fs from 'node:fs'

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
const start=app.indexOf("      if(conflicts.length){\n        const retryKeys=keys.filter(key=>recordSections.has(key))")
const endMarker="      await patchV2Sections(patch,session?.user?.id,latestResult.revisions)"
const end=app.indexOf(endMarker,start)
if(start<0||end<0)throw new Error('v25.0.75: no se encontró bloque CAS v25.0.74')
const replacement=`      if(conflicts.length){
        if(keys.length===1&&keys[0]==='quotes'){
          const refreshed=await loadV2Sections(['quotes'])
          const localBefore=Array.isArray(db.quotes)?db.quotes:[],wanted=Array.isArray(next.quotes)?next.quotes:[]
          const byId=list=>new Map(list.map(item=>[String(item?.id),item]))
          const beforeMap=byId(localBefore),wantedMap=byId(wanted)
          const changedIds=[...new Set([...beforeMap.keys(),...wantedMap.keys()])].filter(id=>stable(beforeMap.get(id))!==stable(wantedMap.get(id)))
          if(changedIds.length===1){
            const id=changedIds[0],wantedRecord=wantedMap.get(id),remote=Array.isArray(refreshed.data?.quotes)?refreshed.data.quotes:[]
            let rebased
            if(wantedRecord===undefined)rebased=remote.filter(item=>String(item?.id)!==id)
            else if(remote.some(item=>String(item?.id)===id))rebased=remote.map(item=>String(item?.id)===id?wantedRecord:item)
            else rebased=[...remote,wantedRecord]
            await patchV2Sections({quotes:rebased},session?.user?.id,refreshed.revisions)
            const confirmed={...db,...refreshed.data,quotes:rebased}
            baselineRef.current={...baselineRef.current,...refreshed.data,quotes:rebased};setDb(confirmed)
            writeCache({keys:[...loadedRef.current],data:Object.fromEntries([...loadedRef.current].map(k=>[k,confirmed[k]]))})
            return{ok:true,data:confirmed,retried:true}
          }
        }
        alert('Otra sesión modificó exactamente el mismo dato: '+conflicts.join(', ')+'. Recargá esa sección y repetí sólo ese cambio.');return{ok:false,conflict:true}
      }
`
app=app.slice(0,start)+replacement+app.slice(end)
fs.writeFileSync(appFile,app)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.75'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.75'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Rebase seguro de presupuestos web'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.75'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.75'"))
console.log('v25.0.75 FINALIZE OK · quotes rebasea sólo el presupuesto tocado sobre la revisión más reciente')
