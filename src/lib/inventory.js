export function orderDemand(db){
  const demand={}
  ;(db.orders||[]).filter(o=>o.status!=='Cancelado').forEach(o=>{
    ;(o.items||[]).forEach(i=>{
      if(!i.figure)return
      demand[i.figure]=(demand[i.figure]||0)+Number(i.qty||0)
    })
  })
  return demand
}

export function manualBalance(db){
  const balance={}
  ;(db.movements||[]).forEach(m=>{
    if(!m.figure)return
    const q=Number(m.qty||0)
    const positive=['Entrada extra','Ajuste positivo','Entrada de corte'].includes(m.type)
    balance[m.figure]=(balance[m.figure]||0)+(positive?q:-q)
  })
  return balance
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
  const balance=manualBalance(db)
  const names=new Set([...(db.figures||[]),...Object.keys(demand),...Object.keys(balance)])
  return [...names].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})).map(f=>({
    figure:f,
    available:Number(balance[f]||0),
    ordered:Number(demand[f]||0),
    total:Number(balance[f]||0)-Number(demand[f]||0),
    min:Number(db.stockMin?.[f]||0)
  }))
}

export function pendingCutRows(db){
  const inCut=activeCutQty(db)
  return stockRows(db).map(r=>({
    ...r,
    inCut:Number(inCut[r.figure]||0),
    pending:Math.max(0,-r.total-Number(inCut[r.figure]||0))
  })).filter(r=>r.pending>0)
}

