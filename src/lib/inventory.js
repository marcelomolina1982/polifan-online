import { todayArgentinaISO } from './production'

function orderDate(order){
  return String(order?.delivery||'').slice(0,10)
}

export function isOrderCommitted(order,today=todayArgentinaISO()){
  if(!order || order.status==='Cancelado' || order.status==='Entregado') return false
  const date=orderDate(order)
  if(!date) return true
  return date>=today
}

export function isOrderAutomaticallyOut(order,today=todayArgentinaISO()){
  if(!order || order.status==='Cancelado') return false
  if(order.status==='Entregado') return true
  const date=orderDate(order)
  return Boolean(date && date<today)
}

export function orderDemand(db){
  const demand={}
  ;(db.orders||[]).filter(o=>isOrderCommitted(o)).forEach(o=>{
    ;(o.items||[]).forEach(i=>{
      if(!i.figure)return
      demand[i.figure]=(demand[i.figure]||0)+Number(i.qty||0)
    })
  })
  return demand
}

export function automaticOrderOutflow(db){
  const out={}
  ;(db.orders||[]).filter(o=>isOrderAutomaticallyOut(o)).forEach(o=>{
    ;(o.items||[]).forEach(i=>{
      if(!i.figure)return
      out[i.figure]=(out[i.figure]||0)+Number(i.qty||0)
    })
  })
  return out
}

export function manualBalance(db){
  const balance={}
  ;(db.movements||[]).forEach(m=>{
    if(!m.figure || ['tapa','base'].includes(m.component))return
    const q=Number(m.qty||0)
    const positive=['Entrada extra','Ajuste positivo','Entrada de corte'].includes(m.type)
    balance[m.figure]=(balance[m.figure]||0)+(positive?q:-q)
  })
  return balance
}

/**
 * Stock físico actual.
 * Las piezas de pedidos cuya fecha de salida ya pasó se descuentan
 * automáticamente. No hace falta marcar el pedido como "Entregado".
 */

export function looseComponentBalance(db){
  const balance={}
  ;(db.movements||[]).forEach(m=>{
    if(!m.figure || !['tapa','base'].includes(m.component)) return
    const q=Number(m.qty||0)
    const positive=['Entrada extra','Ajuste positivo','Entrada de corte','Ajuste componente positivo'].includes(m.type)
    const negative=['Salida manual','Ajuste negativo','Ajuste componente negativo'].includes(m.type)
    if(!positive && !negative) return
    if(!balance[m.figure]) balance[m.figure]={tapa:0,base:0}
    balance[m.figure][m.component]+=positive?q:-q
  })
  Object.values(balance).forEach(v=>{
    v.tapa=Math.max(0,Number(v.tapa||0))
    v.base=Math.max(0,Number(v.base||0))
  })
  return balance
}

export function physicalStockBalance(db){
  const raw=manualBalance(db)
  const out=automaticOrderOutflow(db)
  const names=new Set([...Object.keys(raw),...Object.keys(out)])
  const physical={}
  names.forEach(figure=>{
    physical[figure]=Math.max(0,Number(raw[figure]||0)-Number(out[figure]||0))
  })
  return physical
}

export function activeCutQty(db){
  const active={}
  ;(db.cutBatches||[]).filter(b=>b.status==='En corte').forEach(b=>{
    ;(b.items||[]).forEach(i=>{
      if(!i.figure)return
      active[i.figure]=(active[i.figure]||0)+Number(i.qty||0)*Math.max(1,Number(b.multiplier)||1)
    })
  })
  return active
}

export function stockRows(db){
  const demand=orderDemand(db)
  const physical=physicalStockBalance(db)
  const inCut=activeCutQty(db)
  const autoOut=automaticOrderOutflow(db)
  const loose=looseComponentBalance(db)
  const catalogNames=(db.customerCatalog||[]).map(p=>p.name).filter(Boolean)
  const names=new Set([...(db.figures||[]),...catalogNames,...Object.keys(demand),...Object.keys(physical),...Object.keys(inCut),...Object.keys(autoOut),...Object.keys(loose)])
  return [...names].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})).map(f=>{
    const cut=Number(physical[f]||0)
    const ordered=Number(demand[f]||0)
    const cutting=Number(inCut[f]||0)
    const free=cut-ordered
    const projected=cut+cutting-ordered
    const looseTapa=Number(loose[f]?.tapa||0)
    const looseBase=Number(loose[f]?.base||0)
    const loosePairs=Math.min(looseTapa,looseBase)
    const missingPart=looseTapa>looseBase?{type:'base',qty:looseTapa-looseBase}:looseBase>looseTapa?{type:'tapa',qty:looseBase-looseTapa}:null
    return {
      figure:f,
      cut,
      available:cut,
      ordered,
      inCut:cutting,
      free,
      total:free,
      projected,
      looseTapa,
      looseBase,
      loosePairs,
      missingPart,
      autoOut:Number(autoOut[f]||0),
      min:Number(db.stockMin?.[f]||0)
    }
  })
}

export function pendingCutRows(db){
  return stockRows(db).map(r=>({...r,pending:Math.max(0,-r.projected)})).filter(r=>r.pending>0)
}
