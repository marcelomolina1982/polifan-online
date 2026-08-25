const OLD_URL='https://mcmndnxrbsdlaxpfidsn.supabase.co'
const OLD_KEY='sb_publishable_jYJLmMGO5E0doDU2tf9xyA_tB6QsqyH'
const NEW_URL='https://eftksimpkkvmyfurwqii.supabase.co'
const NEW_KEY='sb_publishable_RJheqVJ6VdJC7291e2z7WQ_0vsBsDWN'
const TOKEN='restore-exact-20260825-TVT-9h20'

const headers=(key,extra={})=>({apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...extra})
async function jsonFetch(url,opts={}){
  const r=await fetch(url,opts)
  const t=await r.text()
  let body=null;try{body=t?JSON.parse(t):null}catch{body=t}
  if(!r.ok)throw new Error(`${r.status} ${url}: ${t.slice(0,1000)}`)
  return body
}
async function upsertRows(table,rows){
  const chunk=150
  for(let i=0;i<rows.length;i+=chunk){
    await jsonFetch(`${NEW_URL}/rest/v1/${table}?on_conflict=id`,{method:'POST',headers:headers(NEW_KEY,{Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify(rows.slice(i,i+chunk))})
  }
}
export default async function handler(req,res){
  if(req.query?.token!==TOKEN)return res.status(403).json({ok:false,error:'forbidden'})
  try{
    const oldRows=await jsonFetch(`${OLD_URL}/rest/v1/app_state?id=eq.main&select=data,updated_at`,{headers:headers(OLD_KEY)})
    const old=oldRows?.[0]?.data
    if(!old)throw new Error('No se encontró main viejo')
    const summary={figures:old.figures?.length||0,catalog:old.customerCatalog?.length||0,categories:old.catalogCollections?.length||0,svgs:old.svgLibrary?.length||0,movements:old.movements?.length||0,batches:old.cutBatches?.length||0,orders:old.orders?.length||0,closed:old.productionClosedDates||[]}
    if(summary.figures!==120||summary.catalog!==104||summary.categories!==4||summary.svgs!==192||summary.movements!==1081||summary.batches!==87||summary.orders!==98)throw new Error(`Estado viejo inesperado ${JSON.stringify(summary)}`)

    await jsonFetch(`${NEW_URL}/rest/v1/app_state?id=eq.main`,{method:'PATCH',headers:headers(NEW_KEY,{Prefer:'return=minimal'}),body:JSON.stringify({data:old,updated_at:new Date().toISOString()})})

    for(const prefix of ['order_','batch_','movement_']){
      await jsonFetch(`${NEW_URL}/rest/v1/app_state?id=like.${prefix}*`,{method:'DELETE',headers:headers(NEW_KEY,{Prefer:'return=minimal'})})
    }
    const now=new Date().toISOString()
    await upsertRows('app_state',(old.orders||[]).filter(x=>x?.id).map(item=>({id:`order_${item.id}`,data:{collection:'orders',item},updated_at:item.updatedAt||item.createdAt||item.date||now})))
    await upsertRows('app_state',(old.cutBatches||[]).filter(x=>x?.id).map(item=>({id:`batch_${item.id}`,data:{collection:'cutBatches',item},updated_at:item.updatedAt||item.finishedAt||item.createdAt||item.date||now})))
    await upsertRows('app_state',(old.movements||[]).filter(x=>x?.id).map(item=>({id:`movement_${item.id}`,data:{collection:'movements',item},updated_at:item.updatedAt||item.createdAt||item.date||now})))

    let publicCatalog='skipped'
    try{
      const oldPublic=await jsonFetch(`${OLD_URL}/rest/v1/public_catalog?select=*`,{headers:headers(OLD_KEY)})
      if(Array.isArray(oldPublic)&&oldPublic.length){
        await jsonFetch(`${NEW_URL}/rest/v1/public_catalog?id=not.is.null`,{method:'DELETE',headers:headers(NEW_KEY,{Prefer:'return=minimal'})})
        await jsonFetch(`${NEW_URL}/rest/v1/public_catalog`,{method:'POST',headers:headers(NEW_KEY,{Prefer:'return=minimal'}),body:JSON.stringify(oldPublic)})
        publicCatalog=`copied:${oldPublic.length}`
      }
    }catch(e){publicCatalog=`warning:${e.message}`}

    const verify=await jsonFetch(`${NEW_URL}/rest/v1/app_state?id=eq.main&select=data`,{headers:headers(NEW_KEY)})
    const n=verify?.[0]?.data||{}
    const out={figures:n.figures?.length||0,catalog:n.customerCatalog?.length||0,categories:n.catalogCollections?.length||0,svgs:n.svgLibrary?.length||0,movements:n.movements?.length||0,batches:n.cutBatches?.length||0,orders:n.orders?.length||0,closed:n.productionClosedDates||[],publicCatalog}
    return res.status(200).json({ok:true,summary:out})
  }catch(error){return res.status(500).json({ok:false,error:String(error?.message||error)})}
}
