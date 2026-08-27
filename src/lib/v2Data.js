import {supabase} from '../supabase'

export const PAGE_SECTIONS={
  dashboard:['orders','movements','stockMin','figures','cutBatches'],
  operations:['orders','movements','stockMin','figures','cutBatches','costSettings','packagingStock'],
  new:['orders','clients','figures','customerCatalog','productionClosedDates'],
  orders:['orders'],
  calendar:['orders','productionClosedDates','packedDeliveryDates'],
  cut:['orders','movements','stockMin','figures','cutBatches'],
  cutbatches:['movements','figures','cutBatches'],
  sheetplanner:['orders','figures','svgLibrary','generatedSheets','cutBatches'],
  svglibrary:['svgLibrary','customerCatalog'],
  stock:['orders','movements','stockMin','figures','inventoryRecount','inventoryRecountCloseout'],
  clients:['clients','orders'],
  assistant:['chatbotSettings'],
  quotes:['quotes','clients','figures','customerCatalog','orders'],
  webrequests:['quotes','orders'],
  trust:['customerReviews','customerPhotos'],
  catalog:['customerCatalog','catalogCollections','customerSettings'],
  analytics:['orders','quotes','customerCatalog'],
  expenses:['expenses','incomes'],
  monthly:['orders','expenses','incomes'],
  costs:['costSettings'],
  settings:['customerSettings','attentionTemplates','chatbotSettings']
}

const uniq=list=>[...new Set((list||[]).filter(Boolean))]
const allowedKeys=new Set(Object.values(PAGE_SECTIONS).flat())
const isSchemaCacheError=error=>/schema cache|Could not find the function|PGRST202/i.test(String(error?.message||error||''))
const inFlight=new Map()
const TIMEOUT_MS=12000

function withTimeout(promise,label='consulta'){
  let timer
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`La ${label} tardó demasiado en responder.`)),TIMEOUT_MS)})
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer))
}

function stripCatalogImages(items=[]){
  return items.map(item=>{const copy={...item};delete copy.image;delete copy.imageData;delete copy.photo;return copy})
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
  const {data,error}=await withTimeout(supabase.rpc('patch_v2_sections',{p_patch:safePatch,p_updated_by:userId||null}),'guardado')
  if(error)throw error
  const row=Array.isArray(data)?data[0]:data
  return{updatedAt:row?.updated_at||''}
}

export function pageSections(page){return PAGE_SECTIONS[page]||['orders']}
export const pageNeedsFullCatalog=page=>page==='catalog'
