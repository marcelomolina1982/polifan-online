import {supabase} from '../supabase'

export const PAGE_SECTIONS={
  dashboard:['orders','movements','stockMin','figures','cutBatches','packagingStock'],
  operations:['orders','movements','stockMin','figures','cutBatches','costSettings','packagingStock'],
  new:['orders','clients','figures','customerCatalog','quotes','productionClosedDates'],
  orders:['orders'],
  calendar:['orders','productionClosedDates','packedDeliveryDates'],
  cut:['orders','movements','stockMin','figures','cutBatches'],
  cutbatches:['orders','cutBatches','figures'],
  sheetplanner:['orders','movements','figures','svgLibrary','generatedSheets','cutBatches'],
  svglibrary:['svgLibrary','figures','customerCatalog','svgAnalysisHistory'],
  stock:['orders','movements','stockMin','figures','inventoryRecount','inventoryRecountCloseout'],
  clients:['clients','orders'],
  assistant:[],
  shippingtest:[],
  quotes:['quotes','clients','figures','customerCatalog','orders'],
  webrequests:['quotes','orders','customerCatalog','svgLibrary'],
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
  const args={p_patch:patch,p_expected_revisions:expectedRevisions||{},p_updated_by:userId||null}
  let lastError
  for(let attempt=0;attempt<3;attempt+=1){
    const {data,error}=await supabase.rpc('patch_v2_sections_cas',args)
    if(!error){
      const row=Array.isArray(data)?data[0]:data
      return{updatedAt:row?.updated_at||''}
    }
    lastError=error
    if(!/statement timeout|canceling statement/i.test(String(error.message||error))||attempt===2)break
    await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)))
  }
  throw lastError
}

export function pageSections(page){return PAGE_SECTIONS[page]||['orders']}
export const pageNeedsFullCatalog=page=>page==='catalog'

export async function loadV2SectionsWithRevisions(keys,{fullCatalog=false}={}){
  const wanted=uniq(keys)
  if(!wanted.length)return{data:{},revisions:{},updatedAt:''}
  if(!fullCatalog){
    try{
      const {data,error}=await supabase.rpc('get_v2_sections_with_revisions',{p_keys:wanted})
      if(error)throw error
      const row=Array.isArray(data)?data[0]:data
      return{data:row?.data||{},revisions:row?.revisions||{},updatedAt:row?.updated_at||''}
    }catch(error){if(!isSchemaCacheError(error))throw error}
  }
  const base=await loadV2Sections(wanted,{fullCatalog})
  const {data:revisionRows,error:revisionError}=await supabase.rpc('get_v2_section_revisions',{p_keys:wanted})
  if(revisionError)throw revisionError
  const revisions={}
  for(const row of revisionRows||[])revisions[row.section_key]=row.updated_at
  return{...base,revisions}
}

export async function patchV2SectionsChecked(patch,expectedRevisions,userId){
  const {data,error}=await supabase.rpc('patch_v2_sections_checked',{p_patch:patch,p_expected_revisions:expectedRevisions||{},p_updated_by:userId||null})
  if(error)throw error
  const row=Array.isArray(data)?data[0]:data
  return{updatedAt:row?.updated_at||'',conflictKeys:row?.conflict_keys||[]}
}

export async function loadV2SvgMetadata(){
  try{
    const {data,error}=await supabase.rpc('get_v2_svg_metadata')
    if(error)throw error
    const row=Array.isArray(data)?data[0]:data
    const payload=row?.data
    const library=Array.isArray(payload)?payload:(Array.isArray(payload?.svgLibrary)?payload.svgLibrary:[])
    return{data:library,updatedAt:row?.updated_at||''}
  }catch(error){
    if(!isSchemaCacheError(error))throw error
    console.warn('get_v2_svg_metadata no disponible; usando fallback de svgLibrary una vez.',error)
    const fallback=await fallbackSections(['svgLibrary'])
    const library=Array.isArray(fallback.data?.svgLibrary)?fallback.data.svgLibrary:[]
    return{data:library.map(item=>{const copy={...item};delete copy.svgText;return copy}),updatedAt:fallback.updatedAt||''}
  }
}

export async function loadV2SvgFull(id){
  const sessionResult=await supabase.auth.getSession()
  const token=sessionResult?.data?.session?.access_token||''
  if(!token)throw new Error('La sesión venció. Volvé a ingresar antes de generar una placa.')
  const response=await fetch('/api/v2-svg-full',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({id:String(id||''),token})})
  const payload=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(payload?.error||('No se pudo cargar SVG (HTTP '+response.status+')'))
  return{data:payload?.data||null,updatedAt:payload?.updatedAt||''}
}

export async function loadV2PageSections(keys,{fullCatalog=false,metadataSvg=false}={}){
  const wanted=uniq(keys)
  if(!metadataSvg||!wanted.includes('svgLibrary'))return loadV2Sections(wanted,{fullCatalog})
  try{
    const rest=wanted.filter(k=>k!=='svgLibrary')
    const [base,meta]=await Promise.all([
      rest.length?loadV2Sections(rest,{fullCatalog}):Promise.resolve({data:{},updatedAt:''}),
      loadV2SvgMetadata()
    ])
    return{data:{...(base.data||{}),svgLibrary:meta.data||[]},updatedAt:meta.updatedAt||base.updatedAt||''}
  }catch(error){
    console.warn('No se pudo cargar metadata SVG; usando fallback completo sólo para esta apertura.',error)
    return loadV2Sections(wanted,{fullCatalog})
  }
}
