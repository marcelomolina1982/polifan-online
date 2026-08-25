export default async function handler(req,res){
  try{
    const url='https://mcmndnxrbsdlaxpfidsn.supabase.co/rest/v1/app_state?id=eq.main&select=data,updated_at'
    const key='sb_publishable_jYJLmMGO5E0doDU2tf9xyA_tB6QsqyH'
    const r=await fetch(url,{headers:{apikey:key,Authorization:`Bearer ${key}`}})
    const text=await r.text()
    if(!r.ok)return res.status(r.status).send(text)
    const rows=JSON.parse(text),row=Array.isArray(rows)?rows[0]:null,d=row?.data
    if(!d)return res.status(404).json({error:'legacy main not found'})
    const data={
      figures:Array.isArray(d.figures)?d.figures:[],
      customerCatalog:Array.isArray(d.customerCatalog)?d.customerCatalog:[],
      catalogCollections:Array.isArray(d.catalogCollections)?d.catalogCollections:[],
      svgLibrary:Array.isArray(d.svgLibrary)?d.svgLibrary:[],
      movements:Array.isArray(d.movements)?d.movements:[],
      cutBatches:Array.isArray(d.cutBatches)?d.cutBatches:[],
      productionClosedDates:Array.isArray(d.productionClosedDates)?d.productionClosedDates:[],
      inventoryRecount:d.inventoryRecount||null,
      inventoryRecountCloseout:d.inventoryRecountCloseout||null
    }
    const summary={updated_at:row.updated_at,...Object.fromEntries(['figures','customerCatalog','catalogCollections','svgLibrary','movements','cutBatches'].map(k=>[k,data[k].length])),productionClosedDates:data.productionClosedDates}
    res.setHeader('cache-control','no-store')
    return res.status(200).json({summary,data})
  }catch(error){return res.status(500).json({error:String(error?.message||error)})}
}
