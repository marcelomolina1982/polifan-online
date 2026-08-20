import { createClient } from '@supabase/supabase-js'

const client = createClient(
  'https://mcmndnxrbsdlaxpfidsn.supabase.co',
  'sb_publishable_jYJLmMGO5E0doDU2tf9xyA_tB6QsqyH'
)

const APP_CACHE_KEY='polifan-app-cache'
const EMERGENCY_CACHE_KEY='polifan-emergency-backup-v1'
const AUTO_BACKUPS_KEY='polifan-auto-backups-v1'
const MOTOR_PLANS_KEY='polifan-motor-lab-last-plan-v3'
const RECOVERY_SCAN_KEY='polifan-critical-recovery-scan-v3'
const MAX_LOCAL_BACKUPS=30

function isPublicCatalog(){try{const q=new URLSearchParams(window.location.search);return window.location.hash==='#pedido'||q.get('pedido')==='1'}catch{return false}}
function readJson(key){try{return JSON.parse(window.localStorage.getItem(key)||'null')}catch{return null}}
function writeJson(key,value){try{window.localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
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
export async function listCloudBackups(){try{const {data,error}=await client.from('app_state').select('id,data,updated_at').like('id','backup_%').order('updated_at',{ascending:false}).limit(30);if(error)throw error;return {ok:true,items:(data||[]).map(row=>({id:row.id,createdAt:row.updated_at||row.data?.__backupMeta?.createdAt||'',reason:row.data?.__backupMeta?.reason||'manual',summary:row.data?.__backupMeta?.summary||snapshotSummary(row.data),state:row.data}))}}catch(error){return {ok:false,error,items:[]}}}
export async function restoreCloudBackup(id){try{const {data,error}=await client.from('app_state').select('data').eq('id',id).maybeSingle();if(error||!data?.data)throw error||new Error('Respaldo no encontrado');const clean={...data.data};delete clean.__backupMeta;return {ok:true,state:clean}}catch(error){return {ok:false,error}}}

const COLLECTIONS={
  orders:{prefix:'order_',key:o=>String(o?.id||'').trim()},
  cutBatches:{prefix:'batch_',key:o=>String(o?.id||'').trim()},
  movements:{prefix:'movement_',key:o=>String(o?.id||'').trim()}
}
const stamp=o=>String(o?.updatedAt||o?.finishedAt||o?.createdAt||o?.date||'')
const rowId=(prefix,id)=>`${prefix}${id}`

async function persistCollectionDelta(name,nextItems=[],previousItems=[]){
  const cfg=COLLECTIONS[name];if(!cfg)return {ok:true,changed:0}
  const prev=new Map((previousItems||[]).map(o=>[cfg.key(o),o]).filter(([id])=>id)),rows=[],now=new Date().toISOString()
  for(const item of (nextItems||[])){
    const id=cfg.key(item);if(!id)continue
    const before=prev.get(id)
    if(!before||JSON.stringify(before)!==JSON.stringify(item))rows.push({id:rowId(cfg.prefix,id),data:{collection:name,item},updated_at:stamp(item)||now})
  }
  if(!rows.length)return {ok:true,changed:0}
  try{
    const {error}=await client.from('app_state').upsert(rows,{onConflict:'id'});if(error)throw error
    const ids=rows.map(r=>r.id),{data:verified,error:verifyError}=await client.from('app_state').select('id').in('id',ids)
    if(verifyError)throw verifyError
    const confirmed=new Set((verified||[]).map(r=>r.id))
    if(ids.some(id=>!confirmed.has(id)))throw new Error(`No se pudieron verificar todos los registros de ${name}`)
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
    if(d.deleted)continue
    const item=d.item||d.order,id=cfg.key(item);if(!id)continue
    const current=map.get(id)
    if(!current||stamp(item)>=stamp(current))map.set(id,item)
  }
  return [...map.values()]
}
function backupStates(){
  const out=[],cache=readJson(APP_CACHE_KEY),emergency=readJson(EMERGENCY_CACHE_KEY),backs=readJson(AUTO_BACKUPS_KEY)
  if(cache)out.push(cache);if(emergency)out.push(emergency)
  if(Array.isArray(backs))backs.forEach(b=>{if(b?.state)out.push(b.state)})
  return out
}
function unionCriticalFromStates(state,sources=[]){
  let merged={...state}
  for(const [name,cfg] of Object.entries(COLLECTIONS)){
    const map=new Map((merged[name]||[]).map(item=>[cfg.key(item),item]).filter(([id])=>id))
    for(const source of sources)for(const item of (source?.[name]||[])){
      const id=cfg.key(item);if(!id)continue
      const current=map.get(id)
      if(!current||stamp(item)>=stamp(current))map.set(id,item)
    }
    merged={...merged,[name]:[...map.values()]}
  }
  return merged
}
function recoverMotorPlan(state){
  const current=Array.isArray(state?.cutBatches)?state.cutBatches:[],byNumber=new Map(current.map(b=>[Number(b?.number)||0,b]).filter(([n])=>n))
  const motorPlans=readJson(MOTOR_PLANS_KEY);if(!Array.isArray(motorPlans))return state
  let changed=false;const cutBatches=[...current]
  for(const plan of motorPlans){
    const n=Number(plan?.batchNumber)||0;if(!plan?.registered||!n||byNumber.has(n))continue
    const items=(plan.summary||[]).map(x=>({figure:x.figure,component:'complete',qty:Number(x.qty)||1}));if(!items.length)continue
    const multiplier=Math.max(1,Number(plan.multiplier||plan.cutMultiplier)||1),id=`recovered-motor-${n}`
    const batch={id,number:String(n).padStart(3,'0'),date:plan.date||'',name:`Placa automática Sparrow ${plan.date||''}`.trim(),status:'En corte',notes:'RECUPERADA automáticamente desde Motor Lab · Sparrow + V1.7',multiplier,items,createdAt:new Date().toISOString(),recovered:true}
    cutBatches.push(batch);byNumber.set(n,batch);changed=true
  }
  return changed?{...state,cutBatches:cutBatches.sort((a,b)=>(Number(a.number)||0)-(Number(b.number)||0))}:state
}
function recentBatchGaps(state){
  const nums=(state?.cutBatches||[]).map(b=>Number(b?.number)||0).filter(Boolean);if(!nums.length)return []
  const max=Math.max(...nums),min=Math.max(1,max-20),set=new Set(nums),missing=[]
  for(let n=min;n<=max;n++)if(!set.has(n))missing.push(n)
  return missing
}
async function recoverRecentGapsFromCloud(state){
  let merged=state,missing=recentBatchGaps(merged);if(!missing.length)return merged
  const max=Math.max(0,...(merged.cutBatches||[]).map(b=>Number(b?.number)||0)),marker=readJson(RECOVERY_SCAN_KEY)
  if(marker?.max===max&&Date.now()-Number(marker.scannedAt||0)<12*60*60*1000)return merged
  const found=[]
  try{
    for(let offset=0;offset<180&&missing.length;offset+=10){
      const {data,error}=await client.from('app_state').select('id,data,updated_at').like('id','backup_%').order('updated_at',{ascending:false}).range(offset,offset+9)
      if(error)throw error;if(!data?.length)break
      for(const row of data){
        const s=row?.data;if(!s)continue;found.push(s)
        const nums=new Set((s.cutBatches||[]).map(b=>Number(b?.number)||0));missing=missing.filter(n=>!nums.has(n))
      }
    }
  }catch(error){console.error('Falló la recuperación histórica de placas',error)}
  writeJson(RECOVERY_SCAN_KEY,{max,scannedAt:Date.now(),missing})
  if(found.length)merged=unionCriticalFromStates(merged,found)
  return merged
}
async function mergeCriticalState(state){
  if(isPublicCatalog())return state
  let merged={...state}
  const results=await Promise.all(Object.keys(COLLECTIONS).map(async name=>[name,await readDurableCollection(name)]))
  for(const [name,durable] of results)if(durable.ok)merged={...merged,[name]:mergeRows(merged[name]||[],durable.rows,name)}
  merged=unionCriticalFromStates(merged,backupStates())
  merged=recoverMotorPlan(merged)
  merged=await recoverRecentGapsFromCloud(merged)
  const recoveredBatches=(merged.cutBatches||[]).length-(state.cutBatches||[]).length
  const recoveredMovements=(merged.movements||[]).length-(state.movements||[]).length
  const recoveredOrders=(merged.orders||[]).length-(state.orders||[]).length
  if(recoveredBatches>0||recoveredMovements>0||recoveredOrders>0){
    await Promise.all(Object.keys(COLLECTIONS).map(name=>persistCollectionDelta(name,merged[name]||[],state[name]||[])))
  }
  return merged
}
function wrapReadBuilder(builder,ctx={}){
  if(!builder||typeof builder!=='object')return builder
  return new Proxy(builder,{get(target,prop){
    if(prop==='maybeSingle')return async(...args)=>{
      let result
      const mainState=ctx.table==='app_state'&&ctx.id==='main'
      const attempts=mainState?3:1
      for(let attempt=1;attempt<=attempts;attempt++){
        result=await target.maybeSingle(...args)
        const timedOut=/statement timeout|canceling statement due to statement timeout/i.test(result?.error?.message||'')
        if(!timedOut||attempt===attempts)break
        await new Promise(resolve=>setTimeout(resolve,300*attempt))
      }
      if(!mainState||result?.error||!result?.data?.data)return result
      const merged=await mergeCriticalState(result.data.data)
      if(!isPublicCatalog()){writeJson(APP_CACHE_KEY,merged);writeJson(EMERGENCY_CACHE_KEY,merged)}
      return {...result,data:{...result.data,data:merged},__criticalMerged:true}
    }
    const value=target[prop];if(typeof value!=='function')return value
    return (...args)=>{const nextCtx={...ctx};if(prop==='eq'&&args[0]==='id')nextCtx.id=String(args[1]);const result=value.apply(target,args);return result&&typeof result==='object'?wrapReadBuilder(result,nextCtx):result}
  }})
}
function wrapWriteBuilder(builder,durablePromise,hasCriticalChanges){
  if(!builder||typeof builder!=='object')return builder
  return new Proxy(builder,{get(target,prop){
    if(prop==='then')return (resolve,reject)=>Promise.all([Promise.resolve(durablePromise).catch(error=>({ok:false,error})),Promise.resolve(target)]).then(([durable,result])=>{
      if(hasCriticalChanges&&durable?.ok&&result?.error){
        console.warn('El estado general falló, pero los datos críticos quedaron verificados de forma durable',result.error)
        return resolve({...result,error:null,__durableOnly:true})
      }
      if(hasCriticalChanges&&!durable?.ok&&!result?.error)return resolve({...result,__durableWarning:true})
      return resolve(result)
    },reject)
    const value=target[prop];if(typeof value!=='function')return value
    return (...args)=>{const result=value.apply(target,args);return result&&typeof result==='object'?wrapWriteBuilder(result,durablePromise,hasCriticalChanges):result}
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
          saveLocalBackup(previous,'antes de guardar');writeJson(APP_CACHE_KEY,state);writeJson(EMERGENCY_CACHE_KEY,state)
          const promises=[],changed=[]
          for(const name of Object.keys(COLLECTIONS)){
            const next=Array.isArray(state?.[name])?state[name]:[],prev=Array.isArray(previous?.[name])?previous[name]:[]
            if(JSON.stringify(next)!==JSON.stringify(prev)){changed.push(name);promises.push(persistCollectionDelta(name,next,prev))}
          }
          const durablePromise=Promise.all(promises).then(results=>({ok:results.every(r=>r.ok),results,error:results.find(r=>!r.ok)?.error}))
          return wrapWriteBuilder(obj[key](...args),durablePromise,changed.length>0)
        }
        return obj[key](...args)
      }
      const value=obj[key];if(typeof value!=='function')return value
      return (...args)=>{const result=value.apply(obj,args);return result&&typeof result==='object'?wrapReadBuilder(result,{table}):result}
    }})
  }
  const value=target[prop];return typeof value==='function'?value.bind(target):value
}})
