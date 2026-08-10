import { todayArgentinaISO, orderPieces } from './production'
import { packagingForPieces, estimatedOrderProfit } from './finance'

export function normalizeDeliveryType(order){
  const raw=String(order?.deliveryType||order?.carrier||'Logística GBA/CABA').toLowerCase()
  if(raw.includes('retiro')) return 'Retiro en el local'
  if(raw.includes('via cargo')||raw.includes('vía cargo')) return 'Vía Cargo'
  if(raw.includes('otro')) return 'Otro expreso'
  return 'Logística GBA/CABA'
}

export function activeOrders(db){return (db.orders||[]).filter(o=>!['Cancelado','Entregado'].includes(o.status))}
export function ordersForDate(db,date=todayArgentinaISO()){return (db.orders||[]).filter(o=>o.delivery===date&&o.status!=='Cancelado')}
export function dispatchGroups(db,date=todayArgentinaISO()){
  const groups={}
  ordersForDate(db,date).forEach(order=>{const key=normalizeDeliveryType(order);(groups[key]||(groups[key]=[])).push(order)})
  return groups
}
export function productionColumns(db){
  const cols={Pendiente:[],Corte:[],Pegado:[],Embalaje:[],Listo:[]}
  activeOrders(db).forEach(order=>{
    const s=String(order.status||'').toLowerCase()
    if(s.includes('listo')) cols.Listo.push(order)
    else if(s.includes('embal')) cols.Embalaje.push(order)
    else if(s.includes('peg')) cols.Pegado.push(order)
    else if(s.includes('corte')||s.includes('cort')) cols.Corte.push(order)
    else cols.Pendiente.push(order)
  })
  return cols
}
export function packagingNeeds(db,{from=todayArgentinaISO(),days=7}={}){
  const end=new Date(from+'T12:00:00');end.setDate(end.getDate()+days)
  const endIso=end.toISOString().slice(0,10), needs={}
  ;(db.orders||[]).filter(o=>o.status!=='Cancelado'&&o.delivery>=from&&o.delivery<=endIso&&o.shippingPackaging==='Sí').forEach(order=>{
    packagingForPieces(orderPieces(order)).parts.forEach(p=>{needs[p.name]=(needs[p.name]||0)+Number(p.qty||1)})
  })
  return Object.entries(needs).map(([name,qty])=>({name,qty})).sort((a,b)=>b.qty-a.qty)
}
export function workload(db){
  const cfg=db.costSettings||{}
  const cutMinutes=Number(cfg.cutMinutesPerFigure||5), glueMinutes=Number(cfg.glueMinutesPerFigure||3), packMinutes=Number(cfg.packMinutesPerOrder||12)
  const orders=activeOrders(db),pieces=orders.reduce((s,o)=>s+orderPieces(o),0)
  const minutes=pieces*(cutMinutes+glueMinutes)+orders.length*packMinutes
  return {pieces,orders:orders.length,minutes,hours:Math.round((minutes/60)*10)/10,cutMinutes,glueMinutes,packMinutes}
}
export function customerProfile(db,client){
  const phone=String(client?.phone||'').replace(/\D/g,''),dni=String(client?.dni||'').replace(/\D/g,'')
  const orders=(db.orders||[]).filter(o=>{const op=String(o.phone||'').replace(/\D/g,''),od=String(o.dni||'').replace(/\D/g,'');return (phone&&op===phone)||(dni&&od===dni)||String(o.client||'').toLowerCase()===String(client?.name||'').toLowerCase()}).filter(o=>o.status!=='Cancelado')
  const spent=orders.reduce((s,o)=>s+Number(o.total||0),0)
  const last=orders.slice().sort((a,b)=>String(b.date||b.createdAt||'').localeCompare(String(a.date||a.createdAt||'')))[0]
  const sourceCounts={};orders.forEach(o=>{const s=o.customerSource||o.source||'Sin dato';sourceCounts[s]=(sourceCounts[s]||0)+1})
  const source=Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'Sin dato'
  const type=orders.length>=5||spent>=200000?'Frecuente':orders.length>=2?'Recurrente':'Nuevo'
  return {orders,spent,last,source,type}
}
export function monthlyProfit(db,orders=[]){
  return orders.reduce((sum,o)=>sum+estimatedOrderProfit(o,db.costSettings).total,0)
}
