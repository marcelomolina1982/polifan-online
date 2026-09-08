import {supabase} from '../supabase'

export const PAGE_SECTIONS={
  dashboard:['orders','movements','stockMin','figures','cutBatches'],
  operations:['orders','movements','stockMin','figures','cutBatches','costSettings','packagingStock'],
  new:['orders','clients','figures','customerCatalog','quotes','productionClosedDates'],
  orders:['orders'],calendar:['orders','productionClosedDates','packedDeliveryDates'],
  cut:['orders','movements','stockMin','figures','cutBatches'],cutbatches:['orders','movements','cutBatches','figures'],
  sheetplanner:['orders','movements','figures','svgLibrary','generatedSheets','cutBatches'],
  svglibrary:['svgLibrary','figures','customerCatalog','svgAnalysisHistory'],stock:['orders','movements','stockMin','figures','inventoryRecount','inventoryRecountCloseout'],clients:['clients','orders'],assistant:['customerCatalog','customerSettings','chatbotSettings','catalogCollections'],quotes:['quotes','clients','figures','customerCatalog','orders'],webrequests:['quotes','orders','customerCatalog','svgLibrary'],trust:['customerReviews','customerPhotos'],catalog:['customerCatalog','catalogCollections','customerSettings'],analytics:['orders','quotes','customerCatalog'],expenses:['expenses','incomes'],monthly:['orders','expenses','incomes'],costs:['costSettings','customerCatalog'],settings:['customerSettings','attentionTemplates','chatbotSettings']
}
const uniq=list=>[...new Set((list||[]).filter(Boolean))]
const isSchemaCacheError=error=>/schema cache|Could not find the function|PGRST202/i.test(String(error?.message||error||''))
const revisionMap=rows=>Object.fromEntries((rows||[]).map(row=>[row.section_key,row.updated_at||'']))
async function loadRevisions(wanted){const {data,error}=await supabase.rpc('get_v2_section_revisions',{p_keys:wanted});if(error)throw error;return revisionMap(data)}
async function fallbackSections(wanted,{fullCatalog=false}={}){const [{data,error},revisionResult]=await Promise.all([supabase.from('app_state').select('data,updated_at').eq('id','main').maybeSingle(),supabase.from('app_state_section_revisions').select('section_key,updated_at').in('section_key',wanted)]);if(error)throw error;if(revisionResult.error)throw revisionResult.error;const source=data?.data||{},picked={};for(const key of wanted){if(key==='customerCatalog'&&!fullCatalog){picked[key]=(source.customerCatalog||[]).map(item=>{const copy={...item};delete copy.image;delete copy.imageData;delete copy.photo;return copy})}else picked[key]=source[key]}return{data:picked,updatedAt:data?.updated_at||'',revisions:revisionMap(revisionResult.data)}}
export async function loadV2Sections(keys,{fullCatalog=false}={}){const wanted=uniq(keys);if(!wanted.length)return{data:{},updatedAt:'',revisions:{}};const {data,error}=await supabase.rpc('get_app_state_sections',{p_keys:wanted});if(error){if(isSchemaCacheError(error))return fallbackSections(wanted,{fullCatalog});throw error}const source=data?.data||data||{},picked={};for(const key of wanted){if(key==='customerCatalog'&&!fullCatalog){picked[key]=(source[key]||[]).map(item=>{const copy={...item};delete copy.image;delete copy.imageData;delete copy.photo;return copy})}else picked[key]=source[key]}return{data:picked,updatedAt:data?.updated_at||'',revisions:await loadRevisions(wanted)}}
export async function patchV2Sections(patch,userId=null,revisions={}){const clean=Object.fromEntries(Object.entries(patch||{}).filter(([key])=>!key.startsWith('_')));const keys=Object.keys(clean);if(!keys.length)return{ok:true};const {data,error}=await supabase.rpc('patch_app_state_sections',{p_patch:clean,p_user_id:userId||null,p_expected_revisions:revisions||{}});if(error)throw error;return data||{ok:true}}
export function pageSections(page){return PAGE_SECTIONS[page]||PAGE_SECTIONS.dashboard}
export function pageNeedsFullCatalog(page){return ['catalog','assistant'].includes(page)}
