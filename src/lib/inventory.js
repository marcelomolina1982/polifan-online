import { todayArgentinaISO } from './production'


export function normalizeFigureKey(value){
  return String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g,' ')
    .trim().replace(/\s+/g,' ')
}

function allFigureNames(db){
  const names=[]
  ;(db.figures||[]).forEach(x=>x&&names.push(String(x)))
  ;(db.customerCatalog||[]).forEach(x=>x?.name&&names.push(String(x.name)))
  ;(db.orders||[]).forEach(o=>(o.items||[]).forEach(i=>i?.figure&&names.push(String(i.figure))))
  ;(db.movements||[]).forEach(m=>m?.figure&&names.push(String(m.figure)))
  ;(db.cutBatches||[]).forEach(b=>(b.items||[]).forEach(i=>i?.figure&&names.push(String(i.figure))))
  Object.keys(db.stockMin||{}).forEach(x=>x&&names.push(String(x)))
  ;(db.svgLibrary||[]).forEach(x=>{const n=x?.productName||x?.modelName;if(n)names.push(String(n))})
  return names
}

export function duplicateFigureGroups(db){
  const catalogByKey=new Map()
  ;(db.customerCatalog||[]).forEach(p=>{const key=normalizeFigureKey(p?.name);if(key&&!catalogByKey.has(key))catalogByKey.set(key,p.name)})
  const groups=new Map()
  allFigureNames(db).forEach(name=>{
    const clean=String(name||'').trim(),key=normalizeFigureKey(clean)
    if(!key)return
    if(!groups.has(key))groups.set(key,new Set())
    groups.get(key).add(clean)
  })
  return [...groups.entries()].map(([key,set])=>{
    const names=[...set]
    const catalogName=catalogByKey.get(key)||''
    const canonical=catalogName||names.slice().sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))[0]
    return {key,names,canonical,fromCatalog:Boolean(catalogName)}
  }).filter(g=>g.names.length>1)
}

export function catalogFigureInfo(db,name){
  const key=normalizeFigureKey(name)
  const product=(db.customerCatalog||[]).find(p=>normalizeFigureKey(p?.name)===key)||null
  return {isCatalog:Boolean(product),product}
}

export function mergeFigureInto(db,sourceName,targetName){
  const source=String(sourceName||'').trim()
  const target=String(targetName||'').trim()
  if(!source||!target) return {db,changed:false,error:'Elegí las dos figuras.'}
  if(source===target) return {db,changed:false,error:'Elegí dos figuras diferentes.'}
  const sourceKey=normalizeFigureKey(source)
  const targetKey=normalizeFigureKey(target)
  const targetProduct=(db.customerCatalog||[]).find(p=>normalizeFigureKey(p?.name)===targetKey)||null
  const rename=value=>normalizeFigureKey(value)===sourceKey?target:String(value||'').trim()
  const withProduct=item=>{
    if(!item?.figure) return item
    const old=item.figure,figure=rename(old)
    if(figure===old) return item
    return {...item,figure,...(targetProduct?.id?{productId:targetProduct.id}:{})}
  }
  const mergeItems=items=>{
    const out=[],byKey=new Map()
    ;(items||[]).forEach(raw=>{
      const item=withProduct(raw)
      if(!item?.figure){out.push(item);return}
      const key=normalizeFigureKey(item.figure)
      if(!byKey.has(key)){
        const next={...item,qty:Number(item.qty||0)}
        byKey.set(key,next);out.push(next)
      }else{
        const current=byKey.get(key)
        current.qty=Number(current.qty||0)+Number(item.qty||0)
        if(targetProduct?.id) current.productId=targetProduct.id
      }
    })
    return out
  }

  const figureMap=new Map()
  ;(db.figures||[]).forEach(name=>{
    const n=rename(name),k=normalizeFigureKey(n)
    if(k&&!figureMap.has(k)) figureMap.set(k,n)
  })
  if(targetKey) figureMap.set(targetKey,target)
  ;(db.customerCatalog||[]).forEach(p=>{
    const k=normalizeFigureKey(p?.name)
    if(k&&!figureMap.has(k)) figureMap.set(k,p.name)
  })

  const stockMin={}
  Object.entries(db.stockMin||{}).forEach(([name,value])=>{
    const n=rename(name)
    stockMin[n]=Math.max(Number(stockMin[n]||0),Number(value||0))
  })

  const svgLibrary=(db.svgLibrary||[]).map(item=>{
    const current=item.productName||item.modelName||''
    if(normalizeFigureKey(current)!==sourceKey) return item
    return {...item,productName:target,modelName:target,name:item.role?`${target} · ${item.role}`:target,...(targetProduct?.id?{productId:targetProduct.id}:{})}
  })

  const next={
    ...db,
    figures:[...figureMap.values()].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),
    stockMin,
    orders:(db.orders||[]).map(o=>({...o,items:mergeItems(o.items)})),
    movements:(db.movements||[]).map(m=>m.figure&&normalizeFigureKey(m.figure)===sourceKey?{...m,figure:target}:m),
    cutBatches:(db.cutBatches||[]).map(b=>({...b,items:mergeItems(b.items)})),
    generatedSheets:(db.generatedSheets||[]).map(plan=>({...plan,sheets:(plan.sheets||[]).map(sheet=>({...sheet,pieces:(sheet.pieces||[]).map(piece=>{
      if(!piece?.figure||normalizeFigureKey(piece.figure)!==sourceKey) return piece
      return {...piece,figure:target,name:String(piece.name||'').replace(String(piece.figure),target),...(targetProduct?.id?{productId:targetProduct.id}:{})}
    })}))})),
    svgLibrary
  }
  return {db:next,changed:true,source,target,targetProduct}
}

function canonicalAliasMap(db){
  const aliases=new Map()
  duplicateFigureGroups(db).forEach(g=>g.names.forEach(name=>aliases.set(normalizeFigureKey(name),g.canonical)))
  ;(db.customerCatalog||[]).forEach(p=>{const key=normalizeFigureKey(p?.name);if(key)aliases.set(key,p.name)})
  return aliases
}

function mergeItemsByFigure(items,rename){
  const out=[],byKey=new Map()
  ;(items||[]).forEach(item=>{
    if(!item?.figure){out.push(item);return}
    const figure=rename(item.figure)
    const key=normalizeFigureKey(figure)
    if(!byKey.has(key)){
      const next={...item,figure}
      byKey.set(key,next);out.push(next)
    }else{
      const current=byKey.get(key)
      current.qty=Number(current.qty||0)+Number(item.qty||0)
    }
  })
  return out
}

export function mergeDuplicateFigures(db){
  const groups=duplicateFigureGroups(db)
  if(!groups.length)return {db,groups:[],changes:0}
  const aliases=canonicalAliasMap(db)
  const rename=value=>{
    const clean=String(value||'').trim(),key=normalizeFigureKey(clean)
    return aliases.get(key)||clean
  }

  const figureSet=new Map()
  ;(db.figures||[]).forEach(name=>{const n=rename(name),k=normalizeFigureKey(n);if(k&&!figureSet.has(k))figureSet.set(k,n)})
  ;(db.customerCatalog||[]).forEach(p=>{if(!p?.name)return;const k=normalizeFigureKey(p.name);figureSet.set(k,p.name)})

  const stockMin={}
  Object.entries(db.stockMin||{}).forEach(([name,value])=>{
    const n=rename(name)
    stockMin[n]=Math.max(Number(stockMin[n]||0),Number(value||0))
  })

  const svgLibrary=(db.svgLibrary||[]).map(item=>{
    const current=item.productName||item.modelName||''
    if(!current)return item
    const name=rename(current)
    if(name===current)return item
    return {...item,productName:name,modelName:name,name:item.role?`${name} · ${item.role}`:name}
  })

  const next={
    ...db,
    figures:[...figureSet.values()].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),
    stockMin,
    orders:(db.orders||[]).map(o=>({...o,items:mergeItemsByFigure(o.items,rename)})),
    movements:(db.movements||[]).map(m=>m.figure?{...m,figure:rename(m.figure)}:m),
    cutBatches:(db.cutBatches||[]).map(b=>({...b,items:mergeItemsByFigure(b.items,rename)})),
    generatedSheets:(db.generatedSheets||[]).map(plan=>({...plan,sheets:(plan.sheets||[]).map(sheet=>({...sheet,pieces:(sheet.pieces||[]).map(piece=>piece.figure?{...piece,figure:rename(piece.figure),name:String(piece.name||'').replace(String(piece.figure),rename(piece.figure))}:piece)}))})),
    svgLibrary
  }
  return {db:next,groups,changes:groups.reduce((n,g)=>n+g.names.length-1,0)}
}


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

/**
 * Asigna el stock físico y las piezas que ya están en corte a los pedidos
 * por fecha de salida, siempre desde la entrega más próxima hacia las siguientes.
 * El stock nunca se reserva primero para un pedido futuro si existe uno anterior.
 */
export function pendingCutByDelivery(db){
  const physical=physicalStockBalance(db)
  const inCut=activeCutQty(db)
  const available={}
  const aliases=canonicalAliasMap(db)
  const canonical=value=>aliases.get(normalizeFigureKey(value))||String(value||'').trim()

  const names=new Set([...Object.keys(physical),...Object.keys(inCut)])
  names.forEach(name=>{
    const figure=canonical(name)
    available[figure]=(available[figure]||0)+Number(physical[name]||0)+Number(inCut[name]||0)
  })

  const groups={}
  ;(db.orders||[])
    .filter(o=>isOrderCommitted(o))
    .slice()
    .sort((a,b)=>(orderDate(a)||'9999-12-31').localeCompare(orderDate(b)||'9999-12-31') || String(a.number||'').localeCompare(String(b.number||'')))
    .forEach(order=>{
      const date=orderDate(order)
      const key=date||'sin-fecha'
      if(!groups[key])groups[key]={key,date,orders:[],rows:{}}
      groups[key].orders.push(order.number)
      ;(order.items||[]).forEach(item=>{
        if(!item?.figure || Number(item.qty||0)<=0)return
        const figure=canonical(item.figure)
        const qty=Number(item.qty||0)
        const onHand=Math.max(0,Number(available[figure]||0))
        const covered=Math.min(onHand,qty)
        available[figure]=onHand-covered
        const pending=qty-covered
        if(pending>0)groups[key].rows[figure]=(groups[key].rows[figure]||0)+pending
      })
    })

  return Object.values(groups)
    .map(g=>({
      key:g.key,
      date:g.date,
      orders:[...new Set(g.orders)].filter(Boolean),
      rows:Object.entries(g.rows)
        .map(([figure,qty])=>({figure,qty:Number(qty||0)}))
        .filter(r=>r.qty>0)
        .sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'}))
    }))
    .filter(g=>g.rows.length)
    .sort((a,b)=>(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31'))
}

export function pendingCutRows(db){
  const totals={}
  pendingCutByDelivery(db).forEach(group=>group.rows.forEach(row=>{
    totals[row.figure]=(totals[row.figure]||0)+Number(row.qty||0)
  }))
  const byFigure=Object.fromEntries(stockRows(db).map(row=>[normalizeFigureKey(row.figure),row]))
  return Object.entries(totals).map(([figure,pending])=>{
    const base=byFigure[normalizeFigureKey(figure)]||{figure,cut:0,available:0,ordered:0,inCut:0,free:0,total:0,projected:0}
    return {...base,figure,pending}
  }).filter(r=>r.pending>0)
}
