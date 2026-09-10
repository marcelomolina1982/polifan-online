import assert from 'node:assert/strict'

// Pure guard for the public tracking RPC contract. It deliberately performs
// no Supabase writes. The SQL implementation must mirror these invariants.
const normalizeStage=(value='')=>{
  const s=String(value).trim().toLowerCase()
  if(['despachado','enviado','dispatched'].includes(s)) return 'dispatched'
  if(['listo para retirar','ready_pickup'].includes(s)) return 'dispatched'
  if(['para embalar','packing'].includes(s)) return 'packing'
  if(['en corte','en producción','en produccion','production_cut'].includes(s)) return 'production_cut'
  return 'confirmed'
}

const qtyByFigure=(items=[])=>items.reduce((acc,row)=>{
  const figure=String(row.figure||'').trim()
  if(!figure) return acc
  acc[figure]=(acc[figure]||0)+Number(row.qty||0)
  return acc
},{})

const completeCoverage=(order,batches,statuses)=>{
  const need=qtyByFigure(order.items)
  const have={}
  for(const batch of batches){
    if(batch.journeyManaged!==true) continue
    if(!statuses.has(String(batch.status||'').toLowerCase())) continue
    if(!(batch.deliveryDates||[]).includes(order.delivery)) continue
    for(const row of batch.items||[]){
      const f=String(row.figure||'').trim()
      have[f]=(have[f]||0)+Number(row.qty||0)
    }
  }
  return Object.entries(need).every(([figure,qty])=>(have[figure]||0)>=qty)
}

assert.equal(normalizeStage('Agendado'),'confirmed')
assert.equal(normalizeStage('En corte'),'production_cut')
assert.equal(normalizeStage('Para embalar'),'packing')
assert.equal(normalizeStage('Listo para retirar'),'dispatched')

const order={delivery:'2026-09-10',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}
const active=new Set(['en corte','terminada'])
assert.equal(completeCoverage(order,[{journeyManaged:true,deliveryDates:['2026-09-10'],status:'En corte',items:[{figure:'A',qty:2},{figure:'B',qty:1}]}],active),false,'partial figure coverage must not advance')
assert.equal(completeCoverage(order,[{journeyManaged:true,deliveryDates:['2026-09-11'],status:'En corte',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}],active),false,'another delivery date must not advance')
assert.equal(completeCoverage(order,[{journeyManaged:false,deliveryDates:['2026-09-10'],status:'En corte',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}],active),false,'unmanaged batch must not advance')
assert.equal(completeCoverage(order,[{journeyManaged:true,deliveryDates:['2026-09-10'],status:'En corte',items:[{figure:'A',qty:2},{figure:'B',qty:2}]}],active),true)

const threeHours=3*60*60*1000
const packingReady=(finishedAt,now)=>new Date(now).getTime()-new Date(finishedAt).getTime()>=threeHours
assert.equal(packingReady('2026-09-10T13:30:00.000Z','2026-09-10T16:29:59.000Z'),false)
assert.equal(packingReady('2026-09-10T13:30:00.000Z','2026-09-10T16:30:00.000Z'),true)

console.log('public tracking guard: 10/10 OK')
