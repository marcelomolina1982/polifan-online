import { createClient } from '@supabase/supabase-js'
import { catalogProducts } from './lib/catalog'

const client = createClient(
  'https://mcmndnxrbsdlaxpfidsn.supabase.co',
  'sb_publishable_jYJLmMGO5E0doDU2tf9xyA_tB6QsqyH'
)

const PUBLIC_CACHE_KEY='tvet_catalog_planning_cache_v1'
const APP_CACHE_KEY='polifan-app-cache'
const EMERGENCY_CACHE_KEY='polifan-emergency-backup-v1'
const AUTO_BACKUPS_KEY='polifan-auto-backups-v1'
const MAX_LOCAL_BACKUPS=30
const isPublicCatalog=()=>{try{const q=new URLSearchParams(window.location.search);return window.location.hash==='#pedido'||q.get('pedido')==='1'}catch{return false}}

function readJson(key){try{return JSON.parse(window.localStorage.getItem(key)||'null')}catch{return null}}
function orderCount(state){return Array.isArray(state?.orders)?state.orders.length:0}
function bestInternalCache(){
  const candidates=[readJson(APP_CACHE_KEY),readJson(EMERGENCY_CACHE_KEY),readJson(PUBLIC_CACHE_KEY)?.state].filter(Boolean)
  return candidates.sort((a,b)=>orderCount(b)-orderCount(a))[0]||null
}
function cachedAppStateResult(){
  const publicMode=isPublicCatalog()
  if(publicMode){
    const publicCache=readJson(PUBLIC_CACHE_KEY)
    if(publicCache?.state){
      return {data:{data:publicCache.state,updated_at:publicCache.updatedAt||publicCache.cachedAt||''},error:null,status:200,statusText:'OK',count:null,__fromCache:true}
    }
  }
  if(!publicMode){
    const appCache=bestInternalCache()
    if(appCache){
      return {data:{data:appCache,updated_at:appCache.updatedAt||''},error:null,status:200,statusText:'OK',count:null,__fromCache:true}
    }
  }
  if(publicMode){
    const safePublicState={customerCatalog:catalogProducts,orders:[],productionClosedDates:[],customerReviews:[],customerPhotos:[],catalogCollections:[]}
    return {data:{data:safePublicState,updated_at:''},error:null,status:200,statusText:'OK',count:null,__staticFallback:true}
  }
  return null
}

function snapshotSummary(state){
  return {
    orders:Array.isArray(state?.orders)?state.orders.length:0,
    clients:Array.isArray(state?.clients)?state.clients.length:0,
    quotes:Array.isArray(state?.quotes)?state.quotes.length:0,
    figures:Array.isArray(state?.figures)?state.figures.length:0,
    svg:Array.isArray(state?.svgLibrary)?state.svgLibrary.length:0
  }
}
function saveLocalBackup(state,reason='automatico'){
  if(!state||typeof state!=='object')return null
  try{
    const createdAt=new Date().toISOString()
    const entry={id:`local-${createdAt}`,createdAt,reason,summary:snapshotSummary(state),state}
    const current=readJson(AUTO_BACKUPS_KEY)
    const list=Array.isArray(current)?current:[]
    const next=[entry,...list].slice(0,MAX_LOCAL_BACKUPS)
    window.localStorage.setItem(AUTO_BACKUPS_KEY,JSON.stringify(next))
    window.localStorage.setItem(EMERGENCY_CACHE_KEY,JSON.stringify(state))
    return entry
  }catch{return null}
}
async function currentUserId(){try{const {data}=await client.auth.getSession();return data?.session?.user?.id||null}catch{return null}}
async function saveCloudBackup(state,reason='automatico'){
  if(!state||typeof state!=='object')return {ok:false}
  const createdAt=new Date().toISOString(),id=`backup_${createdAt.replace(/[^0-9]/g,'').slice(0,17)}`
  try{
    const updated_by=await currentUserId()
    const payload={id,data:{...state,__backupMeta:{createdAt,reason,summary:snapshotSummary(state)}},updated_at:createdAt,...(updated_by?{updated_by}:{})}
    const {error}=await client.from('app_state').insert(payload)
    if(error)throw error
    return {ok:true,id,createdAt}
  }catch(error){return {ok:false,error}}
}
export async function createAppBackup(state,reason='manual'){
  const local=saveLocalBackup(state,reason)
  const cloud=await saveCloudBackup(state,reason)
  return {ok:Boolean(local)||cloud.ok,local,cloud}
}
export function listLocalBackups(){const value=readJson(AUTO_BACKUPS_KEY);return Array.isArray(value)?value:[]}
export async function listCloudBackups(){
  try{
    const {data,error}=await client.from('app_state').select('id,data,updated_at').like('id','backup_%').order('updated_at',{ascending:false}).limit(30)
    if(error)throw error
    return {ok:true,items:(data||[]).map(row=>({id:row.id,createdAt:row.updated_at||row.data?.__backupMeta?.createdAt||'',reason:row.data?.__backupMeta?.reason||'automático',summary:row.data?.__backupMeta?.summary||snapshotSummary(row.data),state:row.data}))}
  }catch(error){return {ok:false,error,items:[]}}
}
export async function restoreCloudBackup(id){
  try{
    const {data,error}=await client.from('app_state').select('data').eq('id',id).maybeSingle()
    if(error||!data?.data)throw error||new Error('Respaldo no encontrado')
    const clean={...data.data};delete clean.__backupMeta
    return {ok:true,state:clean}
  }catch(error){return {ok:false,error}}
}

function wrapBuilder(builder,table){
  if(!builder||typeof builder!=='object')return builder
  return new Proxy(builder,{
    get(target,prop){
      if(prop==='maybeSingle'&&table==='app_state'){
        return async(...args)=>{
          const fallback=cachedAppStateResult()
          const original=target.maybeSingle.bind(target)
          if(!fallback)return original(...args)
          let timer
          try{
            const timeout=new Promise(resolve=>{timer=window.setTimeout(()=>resolve(fallback),2200)})
            const result=await Promise.race([original(...args),timeout])
            window.clearTimeout(timer)
            if(result?.error&&/statement timeout|canceling statement/i.test(result.error.message||''))return fallback
            const remote=result?.data?.data
            if(!isPublicCatalog()&&remote&&orderCount(remote)===0){
              const local=bestInternalCache()
              if(orderCount(local)>0)return {data:{data:local,updated_at:result?.data?.updated_at||''},error:null,status:200,statusText:'OK',count:null,__protectedFromEmptyRemote:true}
            }
            return result
          }catch(error){
            window.clearTimeout(timer)
            return fallback||Promise.reject(error)
          }
        }
      }
      const value=target[prop]
      if(typeof value!=='function')return value
      return (...args)=>{
        const result=value.apply(target,args)
        if(result&&typeof result==='object'&&typeof result.maybeSingle==='function')return wrapBuilder(result,table)
        return result
      }
    }
  })
}

export const supabase=new Proxy(client,{
  get(target,prop){
    if(prop==='from')return table=>{
      const base=target.from(table)
      if(table==='app_state'){
        return new Proxy(base,{
          get(obj,key){
            if(key==='update')return payload=>{
              const previous=bestInternalCache()
              if(previous){saveLocalBackup(previous,'antes de guardar');saveCloudBackup(previous,'antes de guardar')}
              return wrapBuilder(obj.update(payload),table)
            }
            const value=obj[key]
            if(typeof value!=='function')return value
            return (...args)=>{const result=value.apply(obj,args);return result&&typeof result==='object'?wrapBuilder(result,table):result}
          }
        })
      }
      return wrapBuilder(base,table)
    }
    const value=target[prop]
    return typeof value==='function'?value.bind(target):value
  }
})