export default async function handler(req,res){
  try{
    const url='https://mcmndnxrbsdlaxpfidsn.supabase.co/rest/v1/app_state?id=eq.main&select=data,updated_at'
    const key='sb_publishable_jYJLmMGO5E0doDU2tf9xyA_tB6QsqyH'
    const r=await fetch(url,{headers:{apikey:key,Authorization:`Bearer ${key}`}})
    const text=await r.text()
    if(!r.ok)return res.status(r.status).send(text)
    const rows=JSON.parse(text)
    const row=Array.isArray(rows)?rows[0]:null
    if(!row?.data)return res.status(404).json({error:'legacy main not found'})
    const d=row.data
    const summary={updated_at:row.updated_at,figures:Array.isArray(d.figures)?d.figures.length:0,catalog:Array.isArray(d.customerCatalog)?d.customerCatalog.length:0,collections:Array.isArray(d.catalogCollections)?d.catalogCollections.length:0,svgs:Array.isArray(d.svgLibrary)?d.svgLibrary.length:0,movements:Array.isArray(d.movements)?d.movements.length:0,cutBatches:Array.isArray(d.cutBatches)?d.cutBatches.length:0,orders:Array.isArray(d.orders)?d.orders.length:0,productionClosedDates:Array.isArray(d.productionClosedDates)?d.productionClosedDates:[]}
    res.setHeader('cache-control','no-store')
    return res.status(200).json({summary,data:d})
  }catch(error){return res.status(500).json({error:String(error?.message||error)})}
}
