import {supabase} from '../supabase'

export const PAGE_SECTIONS={
  dashboard:['orders','movements','stockMin','figures','cutBatches'],
  operations:['orders','movements','stockMin','figures','cutBatches','costSettings','packagingStock'],
  new:['orders','clients','figures','customerCatalog','productionClosedDates'],
  orders:['orders'],
  calendar:['orders','productionClosedDates','packedDeliveryDates'],
  cut:['orders','movements','stockMin','figures','cutBatches'],
  cutbatches:['movements','figures','cutBatches'],
  sheetplanner:['orders','movements','stockMin','figures','customerCatalog','svgLibrary','cutBatches'],
  svglibrary:['svgLibrary','customerCatalog'],
  stock:['orders','movements','stockMin','figures','inventoryRecount','inventoryRecountCloseout'],
  clients:['clients','orders'],
  assistant:['chatbotSettings'],
  quotes:['quotes','clients','orders'],
  webrequests:['quotes','orders','clients','customerCatalog','movements','stockMin','figures','cutBatches','svgLibrary','productionClosedDates'],
  trust:['customerReviews','customerPhotos'],
  catalog:['customerCatalog','catalogCollections','customerSettings'],
  analytics:['orders','movements','stockMin','figures','cutBatches','svgLibrary','customerCatalog'],
  expenses:['expenses','incomes'],
  monthly:['orders','expenses','incomes'],
  costs:['costSettings'],
  settings:['orders','movements','stockMin','figures','clients','cutBatches','incomes','expenses','customerSettings','customerCatalog','svgLibrary','generatedSheets','productionClosedDates','packedDeliveryDates','attentionMessages','attentionTemplates','quotes','customerReviews','customerPhotos','chatbotSettings','catalogCollections','costSettings','packagingStock','inventoryRecount','inventoryRecountCloseout','svgAnalysisHistory']
}

const uniq=list=>[...new Set((list||[]).filter(Boolean))]
const allowedKeys=new Set(Object.values(PAGE_SECTIONS).flat())
const isSchemaCacheError=error=>/schema cache|Could not find the function|PGRST202/i.test(String(error?.message||error||''))
const inFlight=new Map()
const TIMEOUT_MS=12000
const CACHE_KEY='polifan-v2-section-cache'

function withTimeout(promise,label='consulta'){
  let timer
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`La ${label} tardó demasiado en responder.`)),TIMEOUT_MS)})
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer))
}

function stripCatalogImages(items=[]){
  return items.map(item=>{const copy={...item};delete copy.image;delete copy.imageData;delete copy.photo;return copy})
}

function readCachedOrders(){
  try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')?.data?.orders||[]}
  catch{return[]}
}

function comparableOrder(order){
  if(!order)return order
  const copy={...order};delete copy.history;delete copy.updatedAt;return copy
}
function pieces(order){return (order?.items||[]).reduce((n,i)=>n+Number(i.qty||0),0)}
function itemSignature(order){return JSON.stringify((order?.items||[]).map(i=>[i.figure,Number(i.qty||0),i.productId||'',i.inventoryTracked!==false]))}
function orderEvents(before,after,actor){
  const at=new Date().toISOString(),base={id:crypto.randomUUID?.()||Math.random().toString(36).slice(2),at,actor}
  if(!before&&after)return [{...base,action:'Pedido creado',detail:`${pieces(after)} piezas${after.delivery?` · salida ${after.delivery}`:''}`}]
  if(!before||!after)return[]
  const events=[]
  if(before.status!==after.status)events.push({...base,id:crypto.randomUUID?.()||Math.random().toString(36).slice(2),action:'Estado actualizado',detail:`${before.status||'Sin estado'} → ${after.status||'Sin estado'}`})
  if(before.delivery!==after.delivery)events.push({...base,id:crypto.randomUUID?.()||Math.random().toString(36).slice(2),action:'Fecha de salida modificada',detail:`${before.delivery||'Sin fecha'} → ${after.delivery||'Sin fecha'}`})
  if(String(before.client||'')!==String(after.client||''))events.push({...base,id:crypto.randomUUID?.()||Math.random().toString(36).slice(2),action:'Cliente modificado',detail:`${before.client||'-'} → ${after.client||'-'}`})
  if(Number(before.total||0)!==Number(after.total||0))events.push({...base,id:crypto.randomUUID?.()||Math.random().toString(36).slice(2),action:'Total actualizado',detail:`$${Number(before.total||0).toLocaleString('es-AR')} → $${Number(after.total||0).toLocaleString('es-AR')}`})
  if(itemSignature(before)!==itemSignature(after))events.push({...base,id:crypto.randomUUID?.()||Math.random().toString(36).slice(2),action:'Contenido modificado',detail:`${pieces(before)} → ${pieces(after)} piezas`})
  if(!events.length&&JSON.stringify(comparableOrder(before))!==JSON.stringify(comparableOrder(after)))events.push({...base,action:'Pedido actualizado',detail:'Se modificaron datos del pedido.'})
  return events
}
async function decorateOrderHistory(orders,userId){
  const beforeMap=new Map(readCachedOrders().map(o=>[String(o.id),o]))
  let actor=userId||'Usuario'
  try{const {data}=await supabase.auth.getSession();actor=data?.session?.user?.email||data?.session?.user?.user_metadata?.name||actor}catch{}
  return (orders||[]).map(order=>{
    const before=beforeMap.get(String(order?.id)),events=orderEvents(before,order,actor)
    if(!events.length)return order
    const history=[...(before?.history||order?.history||[]),...events].slice(-80)
    return {...order,history}
  })
}

async function fallbackSections(wanted,{fullCatalog=false}={}){
  const safe=wanted.filter(k=>allowedKeys.has(k))
  const select=['updated_at',...safe.map(k=>`${k}:data->${k}`)].join(',')
  const {data,error}=await withTimeout(supabase.from('app_state').select(select).eq('id','main').maybeSingle(),'carga alternativa')
  if(error)throw error
  const picked={}
  for(const key of safe){
    const value=data?.[key]
    picked[key]=key==='customerCatalog'&&!fullCatalog?stripCatalogImages(value||[]):value
  }
  return{data:picked,updatedAt:data?.updated_at||''}
}

async function fetchSections(wanted,{fullCatalog=false}={}){
  try{
    if(fullCatalog&&wanted.includes('customerCatalog')){
      const normal=wanted.filter(k=>!['customerCatalog','catalogCollections','customerSettings'].includes(k))
      const [base,full]=await Promise.all([
        normal.length?withTimeout(supabase.rpc('get_v2_sections',{p_keys:normal}),'carga del módulo'):Promise.resolve({data:[],error:null}),
        withTimeout(supabase.rpc('get_v2_catalog_full'),'carga del catálogo')
      ])
      if(base.error)throw base.error
      if(full.error)throw full.error
      const baseRow=Array.isArray(base.data)?base.data[0]:base.data
      const fullRow=Array.isArray(full.data)?full.data[0]:full.data
      return{data:{...(baseRow?.data||{}),...(fullRow?.data||{})},updatedAt:fullRow?.updated_at||baseRow?.updated_at||''}
    }
    const {data,error}=await withTimeout(supabase.rpc('get_v2_sections',{p_keys:wanted}),'carga del módulo')
    if(error)throw error
    const row=Array.isArray(data)?data[0]:data
    return{data:row?.data||{},updatedAt:row?.updated_at||''}
  }catch(error){
    if(!isSchemaCacheError(error))throw error
    console.warn('V2 section RPC unavailable; using narrow JSON fallback.',error)
    return fallbackSections(wanted,{fullCatalog})
  }
}

export async function loadV2Sections(keys,{fullCatalog=false}={}){
  const wanted=uniq(keys).filter(k=>allowedKeys.has(k))
  if(!wanted.length)return{data:{},updatedAt:''}
  const requestKey=`${fullCatalog?'full':'light'}:${wanted.slice().sort().join('|')}`
  if(inFlight.has(requestKey))return inFlight.get(requestKey)
  const job=fetchSections(wanted,{fullCatalog}).finally(()=>inFlight.delete(requestKey))
  inFlight.set(requestKey,job)
  return job
}

export async function patchV2Sections(patch,userId){
  const safePatch=Object.fromEntries(Object.entries(patch||{}).filter(([key])=>allowedKeys.has(key)))
  if(Array.isArray(safePatch.orders)){
    safePatch.orders=await decorateOrderHistory(safePatch.orders,userId)
    if(patch&&typeof patch==='object')patch.orders=safePatch.orders
  }
  const {data,error}=await withTimeout(supabase.rpc('patch_v2_sections',{p_patch:safePatch,p_updated_by:userId||null}),'guardado')
  if(error)throw error
  const row=Array.isArray(data)?data[0]:data
  return{updatedAt:row?.updated_at||''}
}

export function pageSections(page){return PAGE_SECTIONS[page]||['orders']}
export const pageNeedsFullCatalog=page=>page==='catalog'||page==='settings'
