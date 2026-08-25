import './prepare-v25.0.44.mjs'
import fs from 'node:fs'

// v25.0.45: editar una placa terminada debe aplicar el estado deseado sobre la
// versión MÁS RECIENTE de Supabase y generar solamente el delta real de inventario.
const cutsFile='src/pages/CutBatches.jsx'
let cuts=fs.readFileSync(cutsFile,'utf8')
const oldBlock=`    if(editing){
      const updated={...editing,...form,items,updatedAt:new Date().toISOString()}
      let movements=[...(db.movements||[])]
      if(editing.status==='Terminada'){
        movements.push(...inventoryMovements(editing,-1,'Corrección: retirar contenido anterior'))
        movements.push(...inventoryMovements(updated,1,'Corrección: ingresar contenido modificado'))
      }
      const cutBatches=(db.cutBatches||[]).map(b=>b.id===editing.id?updated:b)
      saved=await onSave({...db,__onlyKeys:['movements','cutBatches'],movements,cutBatches})
    }else{`
const newBlock=`    if(editing){
      const updated={...editing,...form,items,updatedAt:new Date().toISOString()}
      const cutBatches=(db.cutBatches||[]).map(b=>b.id===editing.id?updated:b)
      if(editing.status==='Terminada'){
        saved=await onSave({...db,__onlyKeys:['movements','cutBatches'],__replaceFinishedBatch:{batchId:editing.id,updated},movements:[...(db.movements||[])],cutBatches})
      }else{
        saved=await onSave({...db,__onlyKeys:['cutBatches'],cutBatches})
      }
    }else{`
if(cuts.includes(oldBlock)) cuts=cuts.replace(oldBlock,newBlock)
else if(!cuts.includes('__replaceFinishedBatch:{batchId:editing.id,updated}')) throw new Error('v25.0.45: no se pudo reemplazar edición de placa terminada')
fs.writeFileSync(cutsFile,cuts)

const appFile='src/App.jsx'
let app=fs.readFileSync(appFile,'utf8')
const needle=`      for(const key of changedKeys){
        if(key==='cutBatches'&&next?.__cutBatchExtra){`
const replacement=`      for(const key of changedKeys){
        if(next?.__replaceFinishedBatch&&key==='cutBatches'){
          const op=next.__replaceFinishedBatch
          const latestList=latest?.cutBatches||[]
          const target=latestList.find(b=>String(b?.id)===String(op.batchId))
          if(!target){conflicts.push('cutBatches (placa no encontrada)');continue}
          const wanted=op.updated||{}
          merged.cutBatches=latestList.map(b=>String(b?.id)===String(op.batchId)?{...b,...wanted,id:b.id,number:b.number}:b)
          continue
        }
        if(next?.__replaceFinishedBatch&&key==='movements'){
          const op=next.__replaceFinishedBatch
          const target=(latest?.cutBatches||[]).find(b=>String(b?.id)===String(op.batchId))
          if(!target){conflicts.push('movements (placa no encontrada)');continue}
          const wanted=op.updated||{}
          const countMap=(batch)=>{
            const mult=Math.max(1,Number(batch?.multiplier)||1),map=new Map()
            ;(batch?.items||[]).forEach(i=>{
              if(!i?.figure)return
              const component=i.component||'complete',k=component+'|'+String(i.figure)
              map.set(k,(map.get(k)||0)+Math.max(0,Number(i.qty||0))*mult)
            })
            return map
          }
          const before=countMap(target),after=countMap(wanted),keys=new Set([...before.keys(),...after.keys()]),adds=[]
          const nowIso=new Date().toISOString()
          for(const k of keys){
            const oldQty=Number(before.get(k)||0),newQty=Number(after.get(k)||0),delta=newQty-oldQty
            if(!delta)continue
            const split=k.indexOf('|'),component=k.slice(0,split),figure=k.slice(split+1),positive=delta>0
            adds.push({id:crypto.randomUUID(),batchId:target.id,date:String(wanted.date||target.date||'').slice(0,10),figure,...(component==='complete'?{}:{component}),type:component==='complete'?(positive?'Entrada de corte':'Ajuste negativo'):(positive?'Ajuste componente positivo':'Ajuste componente negativo'),qty:Math.abs(delta),detail:'Corrección de placa terminada · Placa #'+String(target.number||'')+' · '+(component==='complete'?'figura completa':component),createdAt:nowIso})
          }
          merged.movements=[...(latest?.movements||[]),...adds]
          continue
        }
        if(key==='cutBatches'&&next?.__cutBatchExtra){`
if(app.includes(needle)) app=app.replace(needle,replacement)
else if(!app.includes("if(next?.__replaceFinishedBatch&&key==='cutBatches')")) throw new Error('v25.0.45: no se pudo instalar merge de edición terminada')
fs.writeFileSync(appFile,app)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.45'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.45'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · edición segura de placas terminadas con delta de inventario'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.45'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.45'")
fs.writeFileSync(indexFile,index)
console.log('v25.0.45: edición de placas terminadas usa la versión remota actual y aplica solo el delta real de stock')
