import { createClient } from '@supabase/supabase-js'
import { catalogProducts } from './lib/catalog'

const client = createClient(
  'https://mcmndnxrbsdlaxpfidsn.supabase.co',
  'sb_publishable_jYJLmMGO5E0doDU2tf9xyA_tB6QsqyH'
)

const PUBLIC_CACHE_KEY='tvet_catalog_planning_cache_v1'
const APP_CACHE_KEY='polifan-app-cache'
const isPublicCatalog=()=>{try{const q=new URLSearchParams(window.location.search);return window.location.hash==='#pedido'||q.get('pedido')==='1'}catch{return false}}

function readJson(key){try{return JSON.parse(window.localStorage.getItem(key)||'null')}catch{return null}}
function cachedAppStateResult(){
  const publicCache=readJson(PUBLIC_CACHE_KEY)
  if(publicCache?.state){
    return {data:{data:publicCache.state,updated_at:publicCache.updatedAt||publicCache.cachedAt||''},error:null,status:200,statusText:'OK',count:null,__fromCache:true}
  }
  const appCache=readJson(APP_CACHE_KEY)
  if(appCache){
    return {data:{data:appCache,updated_at:appCache.updatedAt||''},error:null,status:200,statusText:'OK',count:null,__fromCache:true}
  }
  if(isPublicCatalog()){
    const safePublicState={customerCatalog:catalogProducts,orders:[],productionClosedDates:[],customerReviews:[],customerPhotos:[],catalogCollections:[]}
    return {data:{data:safePublicState,updated_at:''},error:null,status:200,statusText:'OK',count:null,__staticFallback:true}
  }
  return null
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
    if(prop==='from')return table=>wrapBuilder(target.from(table),table)
    const value=target[prop]
    return typeof value==='function'?value.bind(target):value
  }
})
