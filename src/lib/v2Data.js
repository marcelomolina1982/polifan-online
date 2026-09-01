import {supabase} from '../supabase'

export const PAGE_SECTIONS={
  dashboard:['orders','movements','stockMin','figures','cutBatches'],
  operations:['orders','movements','stockMin','figures','cutBatches','costSettings','packagingStock'],
  new:['orders','clients','figures','customerCatalog','quotes','productionClosedDates'],
  orders:['orders'],
  calendar:['orders','productionClosedDates','packedDeliveryDates'],
  cut:['orders','movements','stockMin','figures','cutBatches'],
  cutbatches:['orders','cutBatches','figures'],
  sheetplanner:['orders','figures','svgLibrary','generatedSheets','cutBatches'],
  svglibrary:['svgLibrary','figures','customerCatalog','svgAnalysisHistory'],
  stock:['orders','movements','stockMin','figures','inventoryRecount','inventoryRecountCloseout'],
  clients:['clients','orders'],
  assistant:['customerCatalog','customerSettings','chatbotSettings','catalogCollections'],
  quotes:['quotes','clients','figures','customerCatalog','orders'],
  webrequests:['quotes','orders'],
  trust:['customerReviews','customerPhotos'],
  catalog:['customerCatalog','catalogCollections','customerSettings'],
  analytics:['orders','quotes','customerCatalog'],
  expenses:['expenses','incomes'],
  monthly:['orders','expenses','incomes'],
  costs:['costSettings','customerCatalog'],
  settings:['customerSettings','attentionTemplates','chatbotSettings']
}

const uniq=list=>[...new Set((list||[]).filter(Boolean))]
const isSchemaCacheError=error=>/schema cache|Could not find the function|PGRST202/i.test(String(error?.message||error||''))
const revisionMap=rows=>Object.fromEntries((rows||[]).map(row=>[row.section_key,row.updated_at||'']))

async function loadRevisions(wanted){
  const {data,error}=await supabase.rpc('get_v2_section_revisions',{p_keys:wanted})
  if(error)throw error
  return revisionMap(data)
}

async function fallbackSections(wanted,{fullCatalog=false}={}){
  const [{data,error},revisionResult]=await Promise.all([
    supabase.from('app_state').select('data,updated_at').eq('id','main').maybeSingle(),
    supabase.from('app_state_section_revisions').select('section_key,updated_at').in('section_key',wanted)
  ])
  if(error)throw error
  if(revisionResult.error)throw revisionResult.error
  const source=data?.data||{},picked={}
  for(const key of wanted){
    if(key==='customerCatalog'&&!fullCatalog){
      picked[key]=(source.customerCatalog||[]).map(item=>{const copy={...item};delete copy.image;delete copy.imageData;delete copy.photo;return copy})
    }else picked[key]=source[key]
  }
  return{data:picked,updatedAt:data?.updated_at||'',revisions:revisionMap(revisionResult.data)}
}

export async function loadV2Sections(keys,{fullCatalog=false}={}){
  const wanted=uniq(keys)
  if(!wanted.length)return{data:{},updatedAt:'',revisions:{}}
  try{
    if(fullCatalog&&wanted.includes('customerCatalog')){
      const normal=wanted.filter(k=>!['customerCatalog','catalogCollections','customerSettings'].includes(k))
      const [base,full,revisions]=await Promise.all([
        normal.length?supabase.rpc('get_v2_sections',{p_keys:normal}):Promise.resolve({data:[],error:null}),
        supabase.rpc('get_v2_catalog_full'),
        loadRevisions(wanted)
      ])
      if(base.error)throw base.error
      if(full.error)throw full.error
      const baseRow=Array.isArray(base.data)?base.data[0]:base.data
      const fullRow=Array.isArray(full.data)?full.data[0]:full.data
      return{data:{...(baseRow?.data||{}),...(fullRow?.data||{})},updatedAt:fullRow?.updated_at||baseRow?.updated_at||'',revisions}
    }
    const [sections,revisions]=await Promise.all([
      supabase.rpc('get_v2_sections',{p_keys:wanted}),
      loadRevisions(wanted)
    ])
    if(sections.error)throw sections.error
    const row=Array.isArray(sections.data)?sections.data[0]:sections.data
    return{data:row?.data||{},updatedAt:row?.updated_at||'',revisions}
  }catch(error){
    if(!isSchemaCacheError(error))throw error
    console.warn('V2 section RPC unavailable; using safe fallback once.',error)
    return fallbackSections(wanted,{fullCatalog})
  }
}

export async function patchV2Sections(patch,userId,expectedRevisions){
  const keys=Object.keys(patch||{})
  const missing=keys.filter(key=>!Object.prototype.hasOwnProperty.call(expectedRevisions||{},key))
  if(missing.length)throw new Error('No se puede guardar sin revisión segura de: '+missing.join(', '))
  const {data,error}=await supabase.rpc('patch_v2_sections_cas',{p_patch:patch,p_expected_revisions:expectedRevisions||{},p_updated_by:userId||null})
  if(error)throw error
  const row=Array.isArray(data)?data[0]:data
  return{updatedAt:row?.updated_at||''}
}

export function pageSections(page){return PAGE_SECTIONS[page]||['orders']}
export const pageNeedsFullCatalog=page=>page==='catalog'
