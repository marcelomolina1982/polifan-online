import { createClient } from '@supabase/supabase-js'
import { catalogImages } from './lib/catalogImages'

const SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const client=createClient(SUPABASE_URL,SUPABASE_KEY)

const APP_CACHE_KEY='polifan-app-cache'
const EMERGENCY_CACHE_KEY='polifan-emergency-backup-v1'
const AUTO_BACKUPS_KEY='polifan-auto-backups-v1'
const APP_REV_KEY='polifan-app-revision-v2'
const PUBLIC_CACHE_KEY='polifan-public-cache-v2'
const PUBLIC_REV_KEY='polifan-public-revision-v2'
const MAX_LOCAL_BACKUPS=5
let mainHydratedThisSession=false

function isPublicCatalog(){try{const q=new URLSearchParams(window.location.search);return window.location.hash==='#pedido'||q.get('pedido')==='1'}catch{return false}}
function readJson(key){try{return JSON.parse(window.localStorage.getItem(key)||'null')}catch{return null}}
function writeJson(key,value){try{window.localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
function readText(key){try{return window.localStorage.getItem(key)||''}catch{return ''}}
function writeText(key,value){try{window.localStorage.setItem(key,String(value||''));return true}catch{return false}}
function snapshotSummary(state){return {orders:Array.isArray(state?.orders)?state.orders.length:0,clients:Array.isArray(state?.clients)?state.clients.length:0,quotes:Array.isArray(state?.quotes)?state.quotes.length:0,figures:Array.isArray(state?.figures)?state.figures.length:0,svg:Array.isArray(state?.svgLibrary)?state.svgLibrary.length:0,cutBatches:Array.isArray(state?.cutBatches)?state.cutBatches.length:0,movements:Array.isArray(state?.movements)?state.movements.length:0}}
function saveLocalBackup(state,reason='automatico'){
  if(!state||typeof state!=='object')return null
  try{const createdAt=new Date().toISOString(),entry={id:`local-${createdAt}`,createdAt,reason,summary:snapshotSummary(state),state};const current=readJson(AUTO_BACKUPS_KEY),list=Array.isArray(current)?current:[];window.localStorage.setItem(AUTO_BACKUPS_KEY,JSON.stringify([entry,...list].slice(0,MAX_LOCAL_BACKUPS)));window.localStorage.setItem(EMERGENCY_CACHE_KEY,JSON.stringify(state));return entry}catch{return null}
}
async function currentUserId(){try{const {data}=await client.auth.getSession();return data?.session?.user?.id||null}catch{return null}}
async function saveCloudBackup(state,reason='manual'){
  if(!state||typeof state!=='object')return {ok:false}
  const createdAt=new Date().toISOString(),id=`backup_${createdAt.replace(/[^0-9]/g,'').slice(0,17)}`
  try{const updated_by=await currentUserId(),payload={id,data:{...state,__backupMeta:{createdAt,reason,summary:snapshotSummary(state)}},updated_at:createdAt,...(updated_by?{updated_by}:{})};const {error}=await client.from('app_state').insert(payload);if(error)throw error;return {ok:true,id,createdAt}}catch(error){return {ok:false,error}}
}
export async function createAppBackup(state,reason='manual'){const local=saveLocalBackup(state,reason),cloud=await saveCloudBackup(state,reason);return {ok:Boolean(local)||cloud.ok,local,cloud}}
export function listLocalBackups(){const value=readJson(AUTO_BACKUPS_KEY);return Array.isArray(value)?value:[]}
export async function listCloudBackups(){try{const {data,error}=await client.from('app_state').select('id,updated_at').like('id','backup_%').order('updated_at',{ascending:false}).limit(30);if(error)throw error;return {ok:true,items:(data||[]).map(row=>({id:row.id,createdAt:row.updated_at||'',reason:'remoto',summary:null,state:null}))}}catch(error){return {ok:false,error,items:[]}}}
export async function restoreCloudBackup(id){try{const {data,error}=await client.from('app_state').select('data').eq('id',id).maybeSingle();if(error||!data?.data)throw error||new Error('Respaldo no encontrado');const clean={...data.data};delete clean.__backupMeta;return {ok:true,state:clean}}catch(error){return {ok:false,error}}}

const COLLECTIONS={orders:{prefix:'order_',key:o=>String(o?.id||'').trim()},cutBatches:{prefix:'batch_',key:o=>String(o?.id||'').trim()},movements:{prefix:'movement_',key:o=>String(o?.id||'').trim()}}
const stamp=o=>String(o?.updatedAt||o?.finishedAt||o?.createdAt||o?.date||'')
const rowId=(prefix,id)=>`${prefix}${id}`
function localCatalogImage(id){return catalogImages[String(id||'')]||''}
function compactCatalogProducts(items=[]){return (items||[]).map(product=>{if(!product||typeof product!=='object')return product;const local=localCatalogImage(product.id),image=String(product.image||'');const out={...product};delete out.image;if((image&&image!==local)||(!image&&product.imageRef==='db'))out.imageRef='db';else delete out.imageRef;return out})}
async function persistCatalogImageDelta(nextState,previousState){
  const prev=new Map((previousState?.customerCatalog||[]).map(p=>[String(p?.id||''),String(p?.image||'')])),rows=[]
  for(const product of (nextState?.customerCatalog||[])){const id=String(product?.id||'').trim(),image=String(product?.image||'');if(!id||!image||prev.get(id)===image||image===localCatalogImage(id))continue;rows.push({product_id:id,image,updated_at:new Date().toISOString()})}
  if(!rows.length)return {ok:true,changed:0}
  try{const {error}=await client.from('catalog_product_images').upsert(rows,{onConflict:'product_id'});if(error)throw error;return {ok:true,changed:rows.length}}catch(error){console.error('No se pudieron guardar imágenes del catálogo',error);return {ok:false,error,changed:rows.length}}
}
async function hydrateCatalogImages(state){
  if(!state||typeof state!=='object'||!Array.isArray(state.customerCatalog))return state
  const ids=[...new Set(state.customerCatalog.filter(p=>p?.imageRef==='db'||(!p?.image&&!localCatalogImage(p?.id))).map(p=>String(p?.id||'')).filter(Boolean))],remote=new Map()
  if(ids.length){try{const {data,error}=await client.from('catalog_product_images').select('product_id,image').in('product_id',ids);if(!error)for(const row of (data||[]))remote.set(String(row.product_id),row.image||'')}catch{}}
  return {...state,customerCatalog:state.customerCatalog.map(p=>p&&typeof p==='object'?{...p,image:p.image||remote.get(String(p.id||''))||localCatalogImage(p.id)||''}:p)}
}
function compactMainState(state){const compact={...state,customerCatalog:compactCatalogProducts(state?.customerCatalog||[])};delete compact.orders;delete compact.cutBatches;delete compact.movements;return compact}
function slimPublicOrders(orders=[]){return (orders||[]).map(o=>({id:o?.id,delivery:o?.delivery,status:o?.status,items:(o?.items||[]).map(i=>({qty:Number(i?.qty||0),inventoryTracked:i?.inventoryTracked,manualItem:i?.manualItem}))}))}
function publicSnapshot(state){return {customerCatalog:compactCatalogProducts(state?.customerCatalog||[]),catalogCollections:state?.catalogCollections||[],customerSettings:state?.customerSettings||{},customerReviews:state?.customerReviews||[],customerPhotos:state?.customerPhotos||[],chatbotSettings:state?.chatbotSettings||{},productionClosedDates:state?.productionClosedDates||[],orders:slimPublicOrders(state?.orders||[])}}
async function persistPublicSnapshot(state){try{const payload={id:'main',data:publicSnapshot(state),updated_at:new Date().toISOString()};const {error}=await client.from('public_catalog').upsert(payload,{onConflict:'id'});if(error)throw error;return {ok:true}}catch(error){console.error('No se pudo actualizar catálogo público liviano',error);return {ok:false,error}}}

async function persistCollectionDelta(name,nextItems=[],previousItems=[]){
  const cfg=COLLECTIONS[name];if(!cfg)return {ok:true,changed:0}
  const prev=new Map((previousItems||[]).map(o=>[cfg.key(o),o]).filter(([id])=>id)),rows=[],now=new Date().toISOString(),nextIds=new Set()
  for(const item of (nextItems||[])){const id=cfg.key(item);if(!id)continue;nextIds.add(id);const before=prev.get(id);if(!before||JSON.stringify(before)!==JSON.stringify(item))rows.push({id:rowId(cfg.prefix,id),data:{collection:name,item},updated_at:stamp(item)||now})}
  for(const [id] of prev){if(!nextIds.has(id))rows.push({id:rowId(cfg.prefix,id),data:{collection:name,deleted:true,deletedId:id,deletedAt:now},updated_at:now})}
  if(!rows.length)return {ok:true,changed:0}
  try{const {error}=await client.from('app_state').upsert(rows,{onConflict:'id'});if(error)throw error;return {ok:true,changed:rows.length}}catch(error){console.error(`No se pudo persistir ${name} de forma durable`,error);return {ok:false,error,changed:rows.length}}
}
async function readDurableCollection(name){const cfg=COLLECTIONS[name];if(!cfg)return {ok:true,rows:[]};try{const {data,error}=await client.from('app_state').select('id,data,updated_at').like('id',`${cfg.prefix}%`);if(error)throw error;return {ok:true,rows:data||[]}}catch(error){console.error(`No se pudo leer ${name} durable`,error);return {ok:false,error,rows:[]}}}
function mergeRows(base=[],rows=[],name){const cfg=COLLECTIONS[name],map=new Map((base||[]).map(o=>[cfg.key(o),o]).filter(([id])=>id));for(const row of rows){const d=row?.data||{};if(d.collection&&d.collection!==name)continue;if(d.deleted){const id=String(d.deletedId||'').trim()||String(row?.id||'').replace(cfg.prefix,'');if(id)map.delete(id);continue}const item=d.item||d.order,id=cfg.key(item);if(!id)continue;const current=map.get(id);if(!current||stamp(item)>=stamp(current))map.set(id,item)}return [...map.values()]}
async function mergeCriticalState(state){let merged={...state};const results=await Promise.all(Object.keys(COLLECTIONS).map(async name=>[name,await readDurableCollection(name)]));for(const [name,durable] of results)if(durable.ok)merged={...merged,[name]:mergeRows(merged[name]||[],durable.rows,name)};return merged}

async function optimizedPublicRead(){
  const cached=readJson(PUBLIC_CACHE_KEY),knownRevision=readText(PUBLIC_REV_KEY)
  if(cached&&knownRevision){try{const meta=await client.from('public_catalog').select('updated_at').eq('id','main').maybeSingle();if(!meta.error&&String(meta.data?.updated_at||'')===knownRevision)return {data:{data:cached,updated_at:knownRevision},error:null,__publicCacheHit:true}}catch{}}
  try{const {data,error}=await client.from('public_catalog').select('data,updated_at').eq('id','main').maybeSingle();if(error||!data?.data)return {data,error:error||new Error('Catálogo público no disponible')};const hydrated=await hydrateCatalogImages(data.data);writeJson(PUBLIC_CACHE_KEY,hydrated);writeText(PUBLIC_REV_KEY,data.updated_at||'');return {data:{data:hydrated,updated_at:data.updated_at||''},error:null,__publicCatalog:true}}catch(error){return {data:null,error}}
}
async function optimizedMainRead(target,args){
  if(isPublicCatalog())return optimizedPublicRead()
  const cached=readJson(APP_CACHE_KEY)||readJson(EMERGENCY_CACHE_KEY),knownRevision=readText(APP_REV_KEY)
  if(mainHydratedThisSession&&cached&&knownRevision){try{const meta=await client.from('app_state').select('updated_at').eq('id','main').maybeSingle();if(!meta.error&&String(meta.data?.updated_at||'')===knownRevision)return {data:{data:cached,updated_at:knownRevision},error:null,__cacheHit:true}}catch{}}
  let result
  for(let attempt=1;attempt<=3;attempt++){result=await target.maybeSingle(...args);const timedOut=/statement timeout|canceling statement due to statement timeout/i.test(result?.error?.message||'');if(!timedOut||attempt===3)break;await new Promise(resolve=>setTimeout(resolve,300*attempt))}
  if(result?.error||!result?.data?.data)return result
  const merged=await mergeCriticalState(result.data.data),hydrated=await hydrateCatalogImages(merged)
  writeJson(APP_CACHE_KEY,hydrated);writeJson(EMERGENCY_CACHE_KEY,hydrated);writeText(APP_REV_KEY,result.data.updated_at||'');mainHydratedThisSession=true
  return {...result,data:{...result.data,data:hydrated},__criticalMerged:true,__egressGuard:true}
}
function wrapReadBuilder(builder,ctx={}){if(!builder||typeof builder!=='object')return builder;return new Proxy(builder,{get(target,prop){if(prop==='maybeSingle')return async(...args)=>{const mainState=ctx.table==='app_state'&&ctx.id==='main';return mainState?optimizedMainRead(target,args):target.maybeSingle(...args)};const value=target[prop];if(typeof value!=='function')return value;return (...args)=>{const nextCtx={...ctx};if(prop==='eq'&&args[0]==='id')nextCtx.id=String(args[1]);const result=value.apply(target,args);return result&&typeof result==='object'?wrapReadBuilder(result,nextCtx):result}}})}
function wrapWriteBuilder(builder,durablePromise,hasCriticalChanges,state){if(!builder||typeof builder!=='object')return builder;return new Proxy(builder,{get(target,prop){if(prop==='then')return (resolve,reject)=>Promise.all([Promise.resolve(durablePromise).catch(error=>({ok:false,error})),Promise.resolve(target)]).then(([durable,result])=>{const revision=result?.data?.[0]?.updated_at||result?.data?.updated_at||'';if(revision)writeText(APP_REV_KEY,revision);else writeText(APP_REV_KEY,'');if(state&&typeof state==='object'){writeJson(APP_CACHE_KEY,state);writeJson(EMERGENCY_CACHE_KEY,state);mainHydratedThisSession=true}if(hasCriticalChanges&&durable?.ok&&result?.error){console.warn('El estado general falló, pero los datos críticos quedaron guardados',result.error);return resolve({...result,error:null,__durableOnly:true})}if(hasCriticalChanges&&!durable?.ok&&!result?.error)return resolve({...result,__durableWarning:true});return resolve(result)},reject);const value=target[prop];if(typeof value!=='function')return value;return (...args)=>{const result=value.apply(target,args);return result&&typeof result==='object'?wrapWriteBuilder(result,durablePromise,hasCriticalChanges,state):result}}})}

export const supabase=new Proxy(client,{get(target,prop){
  if(prop==='from')return table=>{const base=target.from(table);if(table!=='app_state')return base;return new Proxy(base,{get(obj,key){
    if(key==='update'||key==='upsert')return (...args)=>{const payload=args[0],state=payload?.data;if(state&&typeof state==='object'&&!isPublicCatalog()){const previous=readJson(APP_CACHE_KEY)||readJson(EMERGENCY_CACHE_KEY)||{};saveLocalBackup(previous,'antes de guardar');const promises=[],changed=[];for(const name of Object.keys(COLLECTIONS)){const next=Array.isArray(state?.[name])?state[name]:[],prev=Array.isArray(previous?.[name])?previous[name]:[];if(JSON.stringify(next)!==JSON.stringify(prev)){changed.push(name);promises.push(persistCollectionDelta(name,next,prev))}}promises.push(persistCatalogImageDelta(state,previous));promises.push(persistPublicSnapshot(state));const durablePromise=Promise.all(promises).then(results=>({ok:results.every(r=>r?.ok!==false),results,error:results.find(r=>r?.ok===false)?.error}));const nextArgs=[{...payload,data:compactMainState(state)},...args.slice(1)];return wrapWriteBuilder(obj[key](...nextArgs),durablePromise,changed.length>0,state)}return obj[key](...args)}
    const value=obj[key];if(typeof value!=='function')return value;return (...args)=>{const result=value.apply(obj,args);return result&&typeof result==='object'?wrapReadBuilder(result,{table}):result}
  }})}
  const value=target[prop];return typeof value==='function'?value.bind(target):value
}})
