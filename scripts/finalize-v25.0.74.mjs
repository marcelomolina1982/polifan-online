import './finalize-v25.0.73.mjs'
import fs from 'node:fs'

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
const before=`      if(conflicts.length){alert('Otra sesión modificó exactamente el mismo dato: '+conflicts.join(', ')+'. Recargá esa sección y repetí sólo ese cambio.');return{ok:false,conflict:true}}\n      await patchV2Sections(patch,session?.user?.id,latestResult.revisions)`
const after=`      if(conflicts.length){\n        const retryKeys=keys.filter(key=>recordSections.has(key))\n        if(retryKeys.length===keys.length){\n          const refreshed=await loadV2Sections(keys,{fullCatalog:keys.includes('customerCatalog')&&pageNeedsFullCatalog(page)})\n          const retryPatch={},retryConflicts=[]\n          for(const key of keys){\n            const merged=mergeArray(baseline[key],refreshed.data?.[key],next[key],key)\n            if(!merged.ok)retryConflicts.push(\`${'${key}'} (${'${merged.conflicts.length}'})\`);else retryPatch[key]=merged.value\n          }\n          if(!retryConflicts.length){\n            await patchV2Sections(retryPatch,session?.user?.id,refreshed.revisions)\n            const confirmed={...db,...refreshed.data,...retryPatch};baselineRef.current={...baselineRef.current,...refreshed.data,...retryPatch};setDb(confirmed)\n            writeCache({keys:[...loadedRef.current],data:Object.fromEntries([...loadedRef.current].map(k=>[k,confirmed[k]]))})\n            return{ok:true,data:confirmed,retried:true}\n          }\n        }\n        alert('Otra sesión modificó exactamente el mismo dato: '+conflicts.join(', ')+'. Recargá esa sección y repetí sólo ese cambio.');return{ok:false,conflict:true}\n      }\n      await patchV2Sections(patch,session?.user?.id,latestResult.revisions)`
if(!app.includes(before))throw new Error('v25.0.74: no se encontró bloque CAS esperado')
app=app.replace(before,after)
fs.writeFileSync(appFile,app)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.74'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.74'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Sincronización CAS con reintento seguro'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.74'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.74'"))
console.log('v25.0.74 FINALIZE OK · conflictos CAS compatibles reintentan una vez sin pisar datos')
