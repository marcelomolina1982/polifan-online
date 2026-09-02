import {stockRows} from './inventory.js'
import {JOURNEY_EVENTS,deliveryMode,eventForFinalAction} from './customerJourney.js'

const THREE_HOURS_MS=3*60*60*1000
const FINAL_EVENTS=new Set([JOURNEY_EVENTS.DISPATCHED,JOURNEY_EVENTS.READY_PICKUP])
const normalize=value=>String(value||'')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('es')
  .replace(/[^a-z0-9]+/g,' ')
  .trim().replace(/\s+/g,' ')

function aliasResolver(db={}){
  const aliases=new Map()
  ;(db.customerCatalog||[]).forEach(item=>{const key=normalize(item?.name);if(key)aliases.set(key,key)})
  ;[['Oso','Osito'],['Jessie','Jessie Toy Story'],['Micky','Mickey Mouse'],['Stitch','Stitch Entero'],['Feliz Día Corazón','Feliz Día']].forEach(([from,to])=>{
    aliases.set(normalize(from),normalize(to));aliases.set(normalize(to),normalize(to))
  })
  return value=>aliases.get(normalize(value))||normalize(value)
}
function orderDate(order={}){return String(order.delivery||'').slice(0,10)}
function activeOrders(db={}){
  return (db.orders||[]).filter(o=>!['Cancelado','Entregado'].includes(o?.status)).slice().sort((a,b)=>(orderDate(a)||'9999-12-31').localeCompare(orderDate(b)||'9999-12-31')||Number(a.number||0)-Number(b.number||0)||String(a.id||'').localeCompare(String(b.id||'')))
}
function inventoryPools(db,stockRowsFn){
  const keyFor=aliasResolver(db),finished={},projected={}
  ;(stockRowsFn(db)||[]).forEach(row=>{
    const key=keyFor(row?.figure);if(!key)return
    const cut=Math.max(0,Number(row?.cut||0)),inCut=Math.max(0,Number(row?.inCut||0))
    finished[key]=(finished[key]||0)+cut
    projected[key]=(projected[key]||0)+cut+inCut
  })
  return {keyFor,finished,projected}
}
function allocateCoverage(db,pool,keyFor){
  const remaining={...pool},result=new Map()
  activeOrders(db).forEach(order=>{
    let required=0,covered=0
    ;(order.items||[]).forEach(item=>{
      if(!item?.figure||item.inventoryTracked===false||Number(item.qty||0)<=0)return
      const qty=Math.max(0,Number(item.qty||0)),key=keyFor(item.figure)
      required+=qty
      const available=Math.max(0,Number(remaining[key]||0)),take=Math.min(available,qty)
      remaining[key]=available-take;covered+=take
    })
    result.set(String(order.id||order.number),{required,covered,complete:required===0||covered>=required})
  })
  return result
}
function demandKeys(order,keyFor){
  return new Set((order.items||[]).filter(i=>i?.figure&&i.inventoryTracked!==false&&Number(i.qty||0)>0).map(i=>keyFor(i.figure)))
}
function relevantCutBatches(db,order,keyFor){
  const date=orderDate(order),needed=demandKeys(order,keyFor)
  if(!date||!needed.size)return []
  return (db.cutBatches||[]).filter(batch=>{
    if(batch?.journeyManaged!==true||batch.status==='Cancelada')return false
    const dates=Array.isArray(batch.deliveryDates)?batch.deliveryDates.map(String):[]
    if(!(dates.includes(date)||String(batch.date||'').slice(0,10)===date))return false
    return (batch.items||[]).some(item=>item?.figure&&(!item.component||item.component==='complete')&&needed.has(keyFor(item.figure)))
  })
}
function iso(value){const ms=Date.parse(String(value||''));return Number.isFinite(ms)?new Date(ms).toISOString():''}
function journeyEqual(a,b){try{return JSON.stringify(a||{})===JSON.stringify(b||{})}catch{return false}}

export function effectiveJourneyEvent(order={},now=new Date().toISOString()){
  const journey=order.journey||{}
  if(journey.enabled!==true)return null
  if(FINAL_EVENTS.has(journey.stage))return journey.stage
  const cutAt=Date.parse(String(journey.cutCompletedAt||'')),nowMs=Date.parse(String(now||''))
  if(Number.isFinite(cutAt)&&Number.isFinite(nowMs)&&nowMs>=cutAt+THREE_HOURS_MS)return JOURNEY_EVENTS.PACKING
  return journey.stage||JOURNEY_EVENTS.CONFIRMED
}
export function journeyStageLabel(event){
  if(event===JOURNEY_EVENTS.PRODUCTION_CUT)return 'En producción / corte'
  if(event===JOURNEY_EVENTS.PACKING)return 'Para embalar'
  if(event===JOURNEY_EVENTS.DISPATCHED)return 'Despachado'
  if(event===JOURNEY_EVENTS.READY_PICKUP)return 'Listo para retirar'
  if(event===JOURNEY_EVENTS.CONFIRMED)return 'Pedido agendado'
  return 'Seguimiento anterior'
}
export function journeyIsFinal(order={}){return FINAL_EVENTS.has(order?.journey?.stage)}

export function advanceOperationalJourney(db={},now=new Date().toISOString(),options={}){
  const stockRowsFn=options.stockRowsFn||stockRows
  const pools=inventoryPools(db,stockRowsFn)
  const projected=allocateCoverage(db,pools.projected,pools.keyFor)
  const finished=allocateCoverage(db,pools.finished,pools.keyFor)
  const nowMs=Date.parse(now),transitions=[]
  let changed=false

  const orders=(db.orders||[]).map(order=>{
    if(!order||['Cancelado','Entregado'].includes(order.status)||order?.journey?.enabled!==true)return order
    const id=String(order.id||order.number),prev=order.journey||{}
    if(FINAL_EVENTS.has(prev.stage))return order
    const projectedState=projected.get(id)||{complete:false}
    const finishedState=finished.get(id)||{complete:false}
    const batches=relevantCutBatches(db,order,pools.keyFor)
    let journey={...prev,enabled:true,stage:prev.stage||JOURNEY_EVENTS.CONFIRMED}
    if(!journey.confirmedAt)journey.confirmedAt=iso(order.createdAt||order.date)||now

    if(journey.stage===JOURNEY_EVENTS.PACKING&&!finishedState.complete){
      journey={...journey,stage:JOURNEY_EVENTS.PRODUCTION_CUT,cutCompletedAt:null,packingAt:null}
    }
    if(journey.stage===JOURNEY_EVENTS.PRODUCTION_CUT&&!journey.cutCompletedAt&&!projectedState.complete){
      journey={...journey,stage:JOURNEY_EVENTS.CONFIRMED,productionAt:null}
    }
    if(!journey.productionAt&&batches.length&&projectedState.complete){
      const started=batches.map(b=>iso(b.sentToCutAt||b.createdAt)).filter(Boolean).sort()[0]||now
      journey={...journey,stage:JOURNEY_EVENTS.PRODUCTION_CUT,productionAt:started}
      transitions.push({orderId:id,event:JOURNEY_EVENTS.PRODUCTION_CUT,at:started})
    }
    if(journey.productionAt&&!journey.cutCompletedAt&&finishedState.complete){
      const finishedTimes=batches.filter(b=>b.status==='Terminada').map(b=>iso(b.finishedAt)).filter(Boolean).sort()
      if(finishedTimes.length){
        const cutAt=finishedTimes.at(-1)
        journey={...journey,cutCompletedAt:cutAt}
        transitions.push({orderId:id,event:'cut_finished',at:cutAt})
      }
    }
    const cutMs=Date.parse(String(journey.cutCompletedAt||''))
    if(Number.isFinite(cutMs)&&Number.isFinite(nowMs)&&nowMs>=cutMs+THREE_HOURS_MS){
      const packingAt=new Date(cutMs+THREE_HOURS_MS).toISOString()
      if(journey.stage!==JOURNEY_EVENTS.PACKING){
        journey={...journey,stage:JOURNEY_EVENTS.PACKING,packingAt}
        transitions.push({orderId:id,event:JOURNEY_EVENTS.PACKING,at:packingAt})
      }else if(!journey.packingAt)journey={...journey,packingAt}
    }
    if(journeyEqual(prev,journey))return order
    changed=true
    return {...order,journey}
  })
  return {orders,changed,transitions,projected,finished}
}

export function markJourneyFinal(order={},now=new Date().toISOString()){
  if(order?.journey?.enabled!==true)return order
  const current=effectiveJourneyEvent(order,now)
  if(FINAL_EVENTS.has(current))return order
  if(current!==JOURNEY_EVENTS.PACKING)return order
  const event=eventForFinalAction(order)
  return {...order,journey:{...(order.journey||{}),stage:event,finalAt:now,finalMessageEvent:event,whatsappFinalStatus:'simulated-private'}}
}
export function finalActionLabel(order={}){return deliveryMode(order)==='pickup'?'LISTO PARA RETIRAR':'DESPACHADO'}
