import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL||'https://eftksimpkkvmyfurwqii.supabase.co'
const SUPABASE_KEY=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_RJheqVJ6VdJC7291e2z7WQ_0vsBsDWN'
const client=createClient(SUPABASE_URL,SUPABASE_KEY)

const APP_CACHE_KEY='polifan-app-cache'
const EMERGENCY_CACHE_KEY='polifan-emergency-backup-v1'
const AUTO_BACKUPS_KEY='polifan-auto-backups-v1'
const APP_REV_KEY='polifan-app-revision-v2'
const MAX_LOCAL_BACKUPS=8
let mainHydratedThisSession=false

function isPublicCatalog(){try{const q=new URLSearchParams(window.location.search);return window.location.hash==='#pedido'||q.get('pedido')==='1'}catch{return false}}
function readJson(key){try{return JSON.parse(window.localStorage.getItem(key)||'null')}catch{return null}}
function writeJson(key,value){try{window.localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
function readText(key){try{return window.localStorage.getItem(key)||''}catch{return ''}}
function writeText(key,value){try{window.localStorage.setItem(key,String(value||''));return true}catch{return false}}
function snapshotSummary(state){return {orders:Array.isArray(state?.orders)?state.orders.length:0,clients:Array.isArray(state?.clients)?state.clients.length:0,quotes:Array.isArray(state?.quotes)?state.quotes.length:0,figures:Array.isArray(state?.figures)?state.figures.length:0,svg:Array.isArray(state?.svgLibrary)?state.svgLibrary.length:0,cutBatches:Array.isArray(state?.cutBatches)?state.cutBatches.length:0,movements:Array.isArray(state?.movements)?state.movements.length:0}}
function saveLocalBackup(state,reason='automatico'){
  if(!state||typeof state!=='object')return null
  try{
    const createdAt=new Date().toISOString(),entry={id:`local-${createdAt}`,createdAt,reason,summary:snapshotSummary(state),state}
    const current=readJson(AUTO_BACKUPS_KEY),list=Array.isArray(current)?current:[]
    window.localStorage.setItem(AUTO_BACKUPS_KEY,JSON.stringify([entry,...list].slice(0,MAX_LOCAL_BACKUPS)))
    window.localStorage.setItem(EMERGENCY_CACHE_KEY,JSON.stringify(state))
    return entry
  }catch{return null}
}
async function currentUserId(){try{const {data}=await client.auth.getSession();return data?.session?.user?.id||null}catch{return null}}
async function saveCloudBackup(state,reason='manual'){
  if(!state||typeof state!=='object')return {ok:false}
  const createdAt=new Date().toISOString(),id=`backup_${createdAt.replace(/[^0-9]/g,'').slice(0,17)}`
  try{
    const updated_by=await currentUserId(),payload={id,data:{...state,__backupMeta:{createdAt,reason,summary:snapshotSummary(state)}},updated_at:createdAt,...(updated_by?{updated_by}:{})}
    const {error}=await client.from('app_state').insert(payload);if(error)throw error
    return {ok:true,id,createdAt}
  }catch(error){return {ok:false,error}}
}
export async function createAppBackup(state,reason='manual'){const local=saveLocalBackup(state,reason),cloud=await saveCloudBackup(state,reason);return {ok:Boolean(local)||cloud.ok,local,cloud}}
export function listLocalBackups(){const value=readJson(AUTO_BACKUPS_KEY);return Array.isArray(value)?value:[]}
export async function listCloudBackups(){
  try{
    const {data,error}=await client.from('app_state').select('id,updated_at').like('id','backup_%').order('updated_at',{ascending:false}).limit(30)
    if(error)throw error
    return {ok:true,items:(data||[]).map(row=>({id:row.id,createdAt:row.updated_at||'',reason:'remoto',summary:null,state:null}))}
  }catch(error){return {ok:false,error,items:[]}}
}
export async function restoreCloudBackup(id){try{const {data,error}=await client.from('app_state').select('data').eq('id',id).maybeSingle();if(error||!data?.data)throw error||new Error('Respaldo no encontrado');const clean={...data.data};delete clean.__backupMeta;return {ok:true,state:clean}}catch(error){return {ok:false,error}}}

const COLLECTIONS={
  orders:{prefix:'order_',key:o=>String(o?.id||'').trim(),allowDelete:true},
  cutBatches:{prefix:'batch_',key:o=>String(o?.id||'').trim(),allowDelete:false},
  movements:{prefix:'movement_',key:o=>String(o?.id||'').trim(),allowDelete:false}
}
const stamp=o=>String(o?.updatedAt||o?.finishedAt||o?.createdAt||o?.date||'')
const rowId=(prefix,id)=>`${prefix}${id}`

async function persistCollectionDelta(name,nextItems=[],previousItems=[]){
  const cfg=COLLECTIONS[name];if(!cfg)return {ok:true,changed:0}
  const prev=new Map((previousItems||[]).map(o=>[cfg.key(o),o]).filter(([id])=>id)),rows=[],now=new Date().toISOString(),nextIds=new Set()
  for(const item of (nextItems||[])){
    const id=cfg.key(item);if(!id)continue
    nextIds.add(id)
    const before=prev.get(id)
    if(!before||JSON.stringify(before)!==JSON.stringify(item))rows.push({id:rowId(cfg.prefix,id),data:{collection:name,item},updated_at:stamp(item)||now})
  }
  if(cfg.allowDelete){
    for(const [id] of prev){if(!nextIds.has(id))rows.push({id:rowId(cfg.prefix,id),data:{collection:name,deleted:true,deletedId:id,deletedAt:now},updated_at:now})}
  }
  if(!rows.length)return {ok:true,changed:0}
  try{
    const {error}=await client.from('app_state').upsert(rows,{onConflict:'id'});if(error)throw error
    return {ok:true,changed:rows.length}
  }catch(error){console.error(`No se pudo persistir ${name} de forma durable`,error);return {ok:false,error,changed:rows.length}}
}
async function readDurableCollection(name){
  const cfg=COLLECTIONS[name];if(!cfg)return {ok:true,rows:[]}
  try{const {data,error}=await client.from('app_state').select('id,data,updated_at').like('id',`${cfg.prefix}%`);if(error)throw error;return {ok:true,rows:data||[]}}
  catch(error){console.error(`No se pudo leer ${name} durable`,error);return {ok:false,error,rows:[]}}
}
function mergeRows(base=[],rows=[],name){
  const cfg=COLLECTIONS[name],map=new Map((base||[]).map(o=>[cfg.key(o),o]).filter(([id])=>id))
  for(const row of rows){
    const d=row?.data||{}
    if(d.collection&&d.collection!==name)continue
    if(d.deleted){
      if(cfg.allowDelete){const id=String(d.deletedId||'').trim()||String(row?.id||'').replace(cfg.prefix,'');if(id)map.delete(id)}
      continue
    }
    const item=d.item||d.order,id=cfg.key(item);if(!id)continue
    const current=map.get(id)
    if(!current||stamp(item)>=stamp(current))map.set(id,item)
  }
  return [...map.values()]
}
function recoverClosedDatesFromLocal(state){
  const current=Array.isArray(state?.productionClosedDates)?state.productionClosedDates:[]
  if(current.length)return state
  const backups=listLocalBackups()
  for(const backup of backups){
    const dates=backup?.state?.productionClosedDates
    if(Array.isArray(dates)&&dates.length)return {...state,productionClosedDates:[...new Set(dates)].sort(),__recoveredClosedDates:true}
  }
  return state
}
async function mergeCriticalState(state){
  if(isPublicCatalog())return state
  let merged=recoverClosedDatesFromLocal({...state})
  const results=await Promise.all(Object.keys(COLLECTIONS).map(async name=>[name,await readDurableCollection(name)]))
  for(const [name,durable] of results)if(durable.ok)merged={...merged,[name]:mergeRows(merged[name]||[],durable.rows,name)}
  return merged
}

async function optimizedMainRead(target,args){
  const cached=readJson(APP_CACHE_KEY)||readJson(EMERGENCY_CACHE_KEY)
  const knownRevision=readText(APP_REV_KEY)
  if(mainHydratedThisSession&&cached&&knownRevision){
    try{
      const meta=await client.from('app_state').select('updated_at').eq('id','main').maybeSingle()
      if(!meta.error&&String(meta.data?.updated_at||'')===knownRevision){
        const mergedCached=await mergeCriticalState(cached)
        writeJson(APP_CACHE_KEY,mergedCached);writeJson(EMERGENCY_CACHE_KEY,mergedCached)
        return {data:{data:mergedCached,updated_at:knownRevision},error:null,__cacheHit:true,__criticalMerged:true}
      }
    }catch{}
  }
  let result
  for(let attempt=1;attempt<=3;attempt++){
    result=await target.maybeSingle(...args)
    const timedOut=/statement timeout|canceling statement due to statement timeout/i.test(result?.error?.message||'')
    if(!timedOut||attempt===3)break
    await new Promise(resolve=>setTimeout(resolve,300*attempt))
  }
  if(result?.error||!result?.data?.data)return result
  const merged=await mergeCriticalState(result.data.data)
  writeJson(APP_CACHE_KEY,merged);writeJson(EMERGENCY_CACHE_KEY,merged)
  writeText(APP_REV_KEY,result.data.updated_at||'')
  mainHydratedThisSession=true
  return {...result,data:{...result.data,data:merged},__criticalMerged:true}
}
function wrapReadBuilder(builder,ctx={}){
  if(!builder||typeof builder!=='object')return builder
  return new Proxy(builder,{get(target,prop){
    if(prop==='maybeSingle')return async(...args)=>{
      const mainState=ctx.table==='app_state'&&ctx.id==='main'
      return mainState?optimizedMainRead(target,args):target.maybeSingle(...args)
    }
    const value=target[prop];if(typeof value!=='function')return value
    return (...args)=>{const nextCtx={...ctx};if(prop==='eq'&&args[0]==='id')nextCtx.id=String(args[1]);const result=value.apply(target,args);return result&&typeof result==='object'?wrapReadBuilder(result,nextCtx):result}
  }})
}
function wrapWriteBuilder(builder,durablePromise,hasCriticalChanges,state){
  if(!builder||typeof builder!=='object')return builder
  return new Proxy(builder,{get(target,prop){
    if(prop==='then')return (resolve,reject)=>Promise.all([Promise.resolve(durablePromise).catch(error=>({ok:false,error})),Promise.resolve(target)]).then(async([durable,result])=>{
      const revision=result?.data?.[0]?.updated_at||result?.data?.updated_at||''
      if(revision)writeText(APP_REV_KEY,revision);else writeText(APP_REV_KEY,'')
      if(state&&typeof state==='object'){
        const healed=await mergeCriticalState(state)
        writeJson(APP_CACHE_KEY,healed);writeJson(EMERGENCY_CACHE_KEY,healed);mainHydratedThisSession=true
      }
      if(hasCriticalChanges&&durable?.ok&&result?.error){console.warn('El estado general falló, pero los datos críticos quedaron guardados',result.error);return resolve({...result,error:null,__durableOnly:true})}
      if(hasCriticalChanges&&!durable?.ok&&!result?.error)return resolve({...result,__durableWarning:true})
      return resolve(result)
    },reject)
    const value=target[prop];if(typeof value!=='function')return value
    return (...args)=>{const result=value.apply(target,args);return result&&typeof result==='object'?wrapWriteBuilder(result,durablePromise,hasCriticalChanges,state):result}
  }})
}

export const supabase=new Proxy(client,{get(target,prop){
  if(prop==='from')return table=>{
    const base=target.from(table);if(table!=='app_state')return base
    return new Proxy(base,{get(obj,key){
      if(key==='update'||key==='upsert')return (...args)=>{
        const payload=args[0],state=payload?.data
        if(state&&typeof state==='object'&&!isPublicCatalog()){
          const previous=readJson(APP_CACHE_KEY)||readJson(EMERGENCY_CACHE_KEY)||{}
          saveLocalBackup(previous,'antes de guardar')
          const promises=[],changed=[]
          for(const name of Object.keys(COLLECTIONS)){
            const next=Array.isArray(state?.[name])?state[name]:[],prev=Array.isArray(previous?.[name])?previous[name]:[]
            if(JSON.stringify(next)!==JSON.stringify(prev)){changed.push(name);promises.push(persistCollectionDelta(name,next,prev))}
          }
          const durablePromise=Promise.all(promises).then(results=>({ok:results.every(r=>r.ok),results,error:results.find(r=>!r.ok)?.error}))
          return wrapWriteBuilder(obj[key](...args),durablePromise,changed.length>0,state)
        }
        return obj[key](...args)
      }
      const value=obj[key];if(typeof value!=='function')return value
      return (...args)=>{const result=value.apply(obj,args);return result&&typeof result==='object'?wrapReadBuilder(result,{table}):result}
    }})
  }
  const value=target[prop];return typeof value==='function'?value.bind(target):value
}})
