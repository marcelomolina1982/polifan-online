import assert from 'node:assert/strict'

const THREE_HOURS=3*60*60*1000

export function normalizeTrackingStage(value=''){
  const s=String(value).trim().toLowerCase()
  if(['despachado','enviado','dispatched','listo para retirar','ready_pickup'].includes(s)) return 'dispatched'
  if(['para embalar','packing'].includes(s)) return 'packing'
  if(['en corte','en producción','en produccion','production_cut'].includes(s)) return 'production_cut'
  return 'confirmed'
}

const totals=(items=[])=>items.reduce((out,row)=>{
  const figure=String(row.figure||'').trim()
  if(!figure) return out
  out[figure]=(out[figure]||0)+Math.max(0,Number(row.qty||0))
  return out
},{})

export function completeManagedCoverage(order,batches,{finishedOnly=false}={}){
  const need=totals(order.items)
  const have={}
  for(const batch of batches||[]){
    if(batch?.journeyManaged!==true) continue
    const status=String(batch.status||'').trim().toLowerCase()
    if(finishedOnly ? status!=='terminada' : !['en corte','terminada'].includes(status)) continue
    if(!(batch.deliveryDates||[]).includes(order.delivery)) continue
    for(const row of batch.items||[]){
      const figure=String(row.figure||'').trim()
      if(!figure) continue
      have[figure]=(have[figure]||0)+Math.max(0,Number(row.qty||0))
    }
  }
  return Object.keys(need).length>0 && Object.entries(need).every(([figure,qty])=>(have[figure]||0)>=qty)
}

export function packingReady(finishedAt,now){
  const a=Date.parse(finishedAt||'')
  const b=Date.parse(now||'')
  return Number.isFinite(a)&&Number.isFinite(b)&&b-a>=THREE_HOURS
}

assert.equal(normalizeTrackingStage('Agendado'),'confirmed')
assert.equal(normalizeTrackingStage('En corte'),'production_cut')
assert.equal(normalizeTrackingStage('Para embalar'),'packing')
assert.equal(normalizeTrackingStage('Listo para retirar'),'dispatched')

const order={delivery:'2026-09-10',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}
assert.equal(completeManagedCoverage(order,[{journeyManaged:true,deliveryDates:['2026-09-10'],status:'En corte',items:[{figure:'A',qty:2},{figure:'B',qty:1}]}]),false)
assert.equal(completeManagedCoverage(order,[{journeyManaged:true,deliveryDates:['2026-09-11'],status:'En corte',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}]),false)
assert.equal(completeManagedCoverage(order,[{journeyManaged:false,deliveryDates:['2026-09-10'],status:'En corte',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}]),false)
assert.equal(completeManagedCoverage(order,[{journeyManaged:true,deliveryDates:['2026-09-10'],status:'En corte',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}]),true)
assert.equal(completeManagedCoverage(order,[{journeyManaged:true,deliveryDates:['2026-09-10'],status:'En corte',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}],{finishedOnly:true}),false)
assert.equal(completeManagedCoverage(order,[{journeyManaged:true,deliveryDates:['2026-09-10'],status:'Terminada',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}],{finishedOnly:true}),true)
assert.equal(packingReady('2026-09-10T13:30:00.000Z','2026-09-10T16:29:59.000Z'),false)
assert.equal(packingReady('2026-09-10T13:30:00.000Z','2026-09-10T16:30:00.000Z'),true)

console.log('public tracking contract: 12/12 OK')
