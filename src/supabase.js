import { createClient } from '@supabase/supabase-js'

const client = createClient(
  'https://mcmndnxrbsdlaxpfidsn.supabase.co',
  'sb_publishable_jYJLmMGO5E0doDU2tf9xyA_tB6QsqyH'
)

const APP_CACHE_KEY='polifan-app-cache'
const EMERGENCY_CACHE_KEY='polifan-emergency-backup-v1'
const AUTO_BACKUPS_KEY='polifan-auto-backups-v1'
const MAX_LOCAL_BACKUPS=30

function readJson(key){try{return JSON.parse(window.localStorage.getItem(key)||'null')}catch{return null}}
function writeJson(key,value){try{window.localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
function snapshotSummary(state){return {orders:Array.isArray(state?.orders)?state.orders.length:0,clients:Array.isArray(state?.clients)?state.clients.length:0,quotes:Array.isArray(state?.quotes)?state.quotes.length:0,figures:Array.isArray(state?.figures)?state.figures.length:0,svg:Array.isArray(state?.svgLibrary)?state.svgLibrary.length:0}}
function saveLocalBackup(state,reason='automatico'){if(!state||typeof state!=='object')return null;try{const createdAt=new Date().toISOString(),entry={id:`local-${createdAt}`,createdAt,reason,summary:snapshotSummary(state),state},current=readJson(AUTO_BACKUPS_KEY),list=Array.isArray(current)?current:[];window.localStorage.setItem(AUTO_BACKUPS_KEY,JSON.stringify([entry,...list].slice(0,MAX_LOCAL_BACKUPS)));window.localStorage.setItem(EMERGENCY_CACHE_KEY,JSON.stringify(state));return entry}catch{return null}}
async function currentUserId(){try{const {data}=await client.auth.getSession();return data?.session?.user?.id||null}catch{return null}}
async function saveCloudBackup(state,reason='automatico'){if(!state||typeof state!=='object')return {ok:false};const createdAt=new Date().toISOString(),id=`backup_${createdAt.replace(/[^0-9]/g,'').slice(0,17)}`;try{const updated_by=await currentUserId(),payload={id,data:{...state,__backupMeta:{createdAt,reason,summary:snapshotSummary(state)}},updated_at:createdAt,...(updated_by?{updated_by}:{})},{error}=await client.from('app_state').insert(payload);if(error)throw error;return {ok:true,id,createdAt}}catch(error){return {ok:false,error}}}
export async function createAppBackup(state,reason='manual'){const local=saveLocalBackup(state,reason),cloud=await saveCloudBackup(state,reason);return {ok:Boolean(local)||cloud.ok,local,cloud}}
export function listLocalBackups(){const value=readJson(AUTO_BACKUPS_KEY);return Array.isArray(value)?value:[]}
export async function listCloudBackups(){try{const {data,error}=await client.from('app_state').select('id,data,updated_at').like('id','backup_%').order('updated_at',{ascending:false}).limit(30);if(error)throw error;return {ok:true,items:(data||[]).map(row=>({id:row.id,createdAt:row.updated_at||row.data?.__backupMeta?.createdAt||'',reason:row.data?.__backupMeta?.reason||'automático',summary:row.data?.__backupMeta?.summary||snapshotSummary(row.data),state:row.data}))}}catch(error){return {ok:false,error,items:[]}}}
export async function restoreCloudBackup(id){try{const {data,error}=await client.from('app_state').select('data').eq('id',id).maybeSingle();if(error||!data?.data)throw error||new Error('Respaldo no encontrado');const clean={...data.data};delete clean.__backupMeta;return {ok:true,state:clean}}catch(error){return {ok:false,error}}}

const orderKey=o=>String(o?.id||'').trim()
const rowId=id=>`order_${id}`
const stamp=o=>String(o?.updatedAt||o?.createdAt||'')

async function persistOrderDelta(nextOrders=[],previousOrders=[]){
  const prev=new Map((previousOrders||[]).map(o=>[orderKey(o),o]).filter(([id])=>id))
  const next=new Map((nextOrders||[]).map(o=>[orderKey(o),o]).filter(([id])=>id))
  const now=new Date().toISOString(),rows=[]
  for(const [id,order] of next){
    const before=prev.get(id)
    if(!before||JSON.stringify(before)!==JSON.stringify(order)) rows.push({id:rowId(id),data:{order},updated_at:stamp(order)||now})
  }
  for(const [id,before] of prev){
    if(!next.has(id)) rows.push({id:rowId(id),data:{deleted:true,orderId:id,deletedAt:now,previousNumber:before?.number||''},updated_at:now})
  }
  if(!rows.length)return {ok:true,changed:0}
  try{
    const {error}=await client.from('app_state').upsert(rows,{onConflict:'id'})
    if(error)throw error
    const changedIds=rows.map(r=>r.id)
    const {data:check,error:checkError}=await client.from('app_state').select('id,data').in('id',changedIds)
    if(checkError)throw checkError
    const found=new Set((check||[]).map(r=>r.id))
    const missing=changedIds.filter(id=>!found.has(id))
    if(missing.length)throw new Error(`No se pudieron confirmar ${missing.length} registro(s) durable(s) de pedidos.`)
    return {ok:true,changed:rows.length}
  }catch(error){console.error('No se pudo persistir el registro durable de pedidos',error);return {ok:false,error,changed:rows.length}}
}

async function readDurableOrders(){
  try{
    const {data,error}=await client.from('app_state').select('id,data,updated_at').like('id','order_%')
    if(error)throw error
    return {ok:true,rows:data||[]}
  }catch(error){console.error('No se pudieron leer pedidos durables',error);return {ok:false,error,rows:[]}}
}

function mergeDurableOrders(state,rows){
  if(!state||typeof state!=='object'||!Array.isArray(rows))return state
  const map=new Map((state.orders||[]).map(o=>[orderKey(o),o]).filter(([id])=>id))
  for(const row of rows){
    const d=row?.data||{}
    if(d.deleted&&d.orderId){map.delete(String(d.orderId));continue}
    const order=d.order
    const id=orderKey(order)
    if(!id)continue
    const current=map.get(id)
    if(!current||stamp(order)>=stamp(current))map.set(id,order)
  }
  return {...state,orders:[...map.values()]}
}

function wrapReadBuilder(builder,ctx={}){
  if(!builder||typeof builder!=='object')return builder
  return new Proxy(builder,{get(target,prop){
    if(prop==='maybeSingle')return async(...args)=>{
      const result=await target.maybeSingle(...args)
      if(ctx.table!=='app_state'||ctx.id!=='main'||result?.error||!result?.data?.data)return result
      const durable=await readDurableOrders()
      const merged=durable.ok?mergeDurableOrders(result.data.data,durable.rows):result.data.data
      writeJson(APP_CACHE_KEY,merged);writeJson(EMERGENCY_CACHE_KEY,merged)
      return {...result,data:{...result.data,data:merged},__durableOrdersMerged:durable.ok}
    }
    const value=target[prop]
    if(typeof value!=='function')return value
    return (...args)=>{
      const nextCtx={...ctx}
      if(prop==='eq'&&args[0]==='id')nextCtx.id=String(args[1])
      const result=value.apply(target,args)
      return result&&typeof result==='object'?wrapReadBuilder(result,nextCtx):result
    }
  }})
}

function wrapWriteBuilder(builder,durablePromise,hasOrderChanges){
  if(!builder||typeof builder!=='object')return builder
  return new Proxy(builder,{get(target,prop){
    if(prop==='then')return (resolve,reject)=>Promise.all([Promise.resolve(durablePromise).catch(error=>({ok:false,error})),Promise.resolve(target)]).then(([durable,result])=>{
      if(hasOrderChanges&&!durable?.ok){
        const error=durable?.error||new Error('No se pudo confirmar el guardado durable del pedido.')
        return resolve({...result,error:{message:error.message||String(error)},__durableFailed:true})
      }
      if(result?.error&&/statement timeout|canceling statement/i.test(result.error.message||'')&&hasOrderChanges&&durable?.ok){
        console.warn('app_state principal agotó tiempo, pero pedidos quedaron guardados y verificados de forma durable')
        return resolve({...result,error:null,__durableOnly:true})
      }
      return resolve(result)
    },reject)
    const value=target[prop]
    if(typeof value!=='function')return value
    return (...args)=>{const result=value.apply(target,args);return result&&typeof result==='object'?wrapWriteBuilder(result,durablePromise,hasOrderChanges):result}
  }})
}

export const supabase=new Proxy(client,{get(target,prop){
  if(prop==='from')return table=>{
    const base=target.from(table)
    if(table!=='app_state')return base
    return new Proxy(base,{get(obj,key){
      if(key==='update'||key==='upsert')return (...args)=>{
        const payload=args[0]
        const state=payload?.data
        const previous=readJson(APP_CACHE_KEY)||readJson(EMERGENCY_CACHE_KEY)||{}
        if(state&&typeof state==='object'&&Array.isArray(state.orders)){
          saveLocalBackup(previous,'antes de guardar')
          writeJson(APP_CACHE_KEY,state);writeJson(EMERGENCY_CACHE_KEY,state)
          const prevOrders=Array.isArray(previous?.orders)?previous.orders:[]
          const changed=JSON.stringify(state.orders)!==JSON.stringify(prevOrders)
          const durablePromise=persistOrderDelta(state.orders,prevOrders)
          void saveCloudBackup(previous,'antes de guardar')
          const result=obj[key](...args)
          return wrapWriteBuilder(result,durablePromise,changed)
        }
        return obj[key](...args)
      }
      const value=obj[key]
      if(typeof value!=='function')return value
      return (...args)=>{const result=value.apply(obj,args);return result&&typeof result==='object'?wrapReadBuilder(result,{table}):result}
    }})
  }
  const value=target[prop]
  return typeof value==='function'?value.bind(target):value
}})
