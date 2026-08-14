import { createClient } from '@supabase/supabase-js'
import { catalogProducts } from './lib/catalog'

const client = createClient(
  'https://mcmndnxrbsdlaxpfidsn.supabase.co',
  'sb_publishable_jYJLmMGO5E0doDU2tf9xyA_tB6QsqyH'
)

const PUBLIC_CACHE_KEY='tvet_catalog_planning_cache_v1'
const APP_CACHE_KEY='polifan-app-cache'
const APP_BACKUP_KEY='polifan-app-backup-last-good'
const isPublicCatalog=()=>{try{const q=new URLSearchParams(window.location.search);return window.location.hash==='#pedido'||q.get('pedido')==='1'}catch{return false}}

function readJson(key){try{return JSON.parse(window.localStorage.getItem(key)||'null')}catch{return null}}
const orderCount=state=>Array.isArray(state?.orders)?state.orders.length:0

function bestAdminCache(){
  const appCache=readJson(APP_CACHE_KEY)
  const backup=readJson(APP_BACKUP_KEY)
  const publicWrapper=readJson(PUBLIC_CACHE_KEY)
  const publicCache=publicWrapper?.state||null
  const candidates=[appCache,backup,publicCache].filter(Boolean)
  if(!candidates.length)return null
  candidates.sort((a,b)=>orderCount(b)-orderCount(a))
  const best=candidates[0]
  if(orderCount(best)>0){
    try{window.localStorage.setItem(APP_BACKUP_KEY,JSON.stringify(best))}catch{}
  }
  return best
}

function cachedAppStateResult(){
  const publicMode=isPublicCatalog()
  if(publicMode){
    const publicCache=readJson(PUBLIC_CACHE_KEY)
    if(publicCache?.state){
      return {data:{data:publicCache.state,updated_at:publicCache.updatedAt||publicCache.cachedAt||''},error:null,status:200,statusText:'OK',count:null,__fromCache:true}
    }
    const safePublicState={customerCatalog:catalogProducts,orders:[],productionClosedDates:[],customerReviews:[],customerPhotos:[],catalogCollections:[]}
    return {data:{data:safePublicState,updated_at:''},error:null,status:200,statusText:'OK',count:null,__staticFallback:true}
  }
  const best=bestAdminCache()
  if(best){
    return {data:{data:best,updated_at:best.updatedAt||''},error:null,status:200,statusText:'OK',count:null,__fromCache:true,__recoveryOrders:orderCount(best)}
  }
  return null
}

function protectAgainstEmptyRemote(result,fallback){
  if(isPublicCatalog()||!fallback?.data?.data)return result
  const remoteState=result?.data?.data
  const cachedState=fallback.data.data
  const cachedOrders=orderCount(cachedState)
  const remoteOrders=orderCount(remoteState)
  if(result?.error)return result
  if(cachedOrders>0&&remoteState&&remoteOrders===0){
    console.error(`RECUPERACION POLIFAN: Supabase devolvio 0 pedidos; se preservan ${cachedOrders} pedidos del ultimo estado local valido.`)
    try{window.localStorage.setItem(APP_BACKUP_KEY,JSON.stringify(cachedState))}catch{}
    return {...fallback,__protectedFromEmptyRemote:true}
  }
  if(remoteOrders>0){
    try{window.localStorage.setItem(APP_BACKUP_KEY,JSON.stringify(remoteState))}catch{}
  }
  return result
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
            return protectAgainstEmptyRemote(result,fallback)
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
    if(prop==='from')return table=>wrapBuilder(target.from(table),table)
    const value=target[prop]
    return typeof value==='function'?value.bind(target):value
  }
})