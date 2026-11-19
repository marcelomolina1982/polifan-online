// Safe comparison for the staged per-product catalog.
// Read-only: never writes to either table.
export async function auditCatalogV2(supabase){
  const {data:main,error:mainError}=await supabase.from('app_state').select('data').eq('id','main').single()
  if(mainError)throw mainError
  const original=main?.data?.customerCatalog
  if(!Array.isArray(original))throw new Error('Catálogo principal inválido')
  const staged=[]
  const pageSize=100
  for(let offset=0;;offset+=pageSize){
    const {data,error}=await supabase.from('catalog_products_v2')
      .select('id,payload,updated_at').order('id').range(offset,offset+pageSize-1)
    if(error)throw error
    staged.push(...(data||[]))
    if((data||[]).length<pageSize)break
  }
  const originalById=new Map(original.map(item=>[String(item.id),item]))
  const stagedById=new Map(staged.map(item=>[String(item.id),item.payload]))
  const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)
  const missing=[...originalById.keys()].filter(id=>!stagedById.has(id))
  const extra=[...stagedById.keys()].filter(id=>!originalById.has(id))
  const different=[...originalById.keys()].filter(id=>stagedById.has(id)&&stable(originalById.get(id))!==stable(stagedById.get(id)))
  return {originalCount:original.length,stagedCount:staged.length,missing,extra,different,
    ready:missing.length===0&&extra.length===0&&different.length===0}
}
