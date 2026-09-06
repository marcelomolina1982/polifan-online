from pathlib import Path
p=Path('src/lib/inventory.js')
s=p.read_text()
start=s.index('export function pendingCutByDelivery(db){')
end=s.index('\nexport function pendingCutRows(db){', start)
new=r'''export function pendingCutByDelivery(db){
  const physical=physicalStockBalance(db)
  const inCut=activeCutQty(db)
  const loose=looseComponentBalance(db)
  const inCutParts=activeCutComponents(db)
  const complete={},tapas={},bases={}
  const aliases=canonicalAliasMap(db)
  const canonical=value=>aliases.get(normalizeFigureKey(value))||String(value||'').trim()
  const add=(bucket,name,qty)=>{const figure=canonical(name);bucket[figure]=(bucket[figure]||0)+Math.max(0,Number(qty||0))}

  const names=new Set([...Object.keys(physical),...Object.keys(inCut),...Object.keys(loose),...Object.keys(inCutParts)])
  names.forEach(name=>{
    add(complete,name,Number(physical[name]||0)+Number(inCut[name]||0))
    const rawTapa=Math.max(0,Number(loose[name]?.tapa||0)),rawBase=Math.max(0,Number(loose[name]?.base||0))
    const paired=Math.min(rawTapa,rawBase)
    add(tapas,name,rawTapa-paired+Number(inCutParts[name]?.tapa||0))
    add(bases,name,rawBase-paired+Number(inCutParts[name]?.base||0))
  })

  const groups={}
  const addNeed=(group,figure,component,qty)=>{
    qty=Math.max(0,Number(qty||0));if(!qty)return
    const key=`${figure}|${component}`
    if(!group.rows[key])group.rows[key]={figure,component,qty:0}
    group.rows[key].qty+=qty
  }
  ;(db.orders||[])
    .filter(o=>isOrderCommitted(o))
    .slice()
    .sort((a,b)=>(orderDate(a)||'9999-12-31').localeCompare(orderDate(b)||'9999-12-31') || String(a.number||'').localeCompare(String(b.number||'')))
    .forEach(order=>{
      const date=orderDate(order),key=date||'sin-fecha'
      if(!groups[key])groups[key]={key,date,orders:[],rows:{}}
      groups[key].orders.push(order.number)
      ;(order.items||[]).forEach(item=>{
        if(!item?.figure || item.inventoryTracked===false || Number(item.qty||0)<=0)return
        const figure=canonical(item.figure)
        let need=Math.max(0,Number(item.qty||0))
        const useComplete=Math.min(need,Math.max(0,Number(complete[figure]||0)))
        complete[figure]=Math.max(0,Number(complete[figure]||0)-useComplete);need-=useComplete
        const readyPairs=Math.min(need,Math.max(0,Number(tapas[figure]||0)),Math.max(0,Number(bases[figure]||0)))
        tapas[figure]=Math.max(0,Number(tapas[figure]||0)-readyPairs);bases[figure]=Math.max(0,Number(bases[figure]||0)-readyPairs);need-=readyPairs
        const useBases=Math.min(need,Math.max(0,Number(bases[figure]||0)))
        if(useBases){bases[figure]-=useBases;addNeed(groups[key],figure,'tapa',useBases);need-=useBases}
        const useTapas=Math.min(need,Math.max(0,Number(tapas[figure]||0)))
        if(useTapas){tapas[figure]-=useTapas;addNeed(groups[key],figure,'base',useTapas);need-=useTapas}
        if(need>0)addNeed(groups[key],figure,'complete',need)
      })
    })

  return Object.values(groups).map(g=>({
    key:g.key,date:g.date,orders:[...new Set(g.orders)].filter(Boolean),
    rows:Object.values(g.rows).filter(r=>r.qty>0).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'})||a.component.localeCompare(b.component))
  })).filter(g=>g.rows.length).sort((a,b)=>(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31'))
}'''
s=s[:start]+new+s[end:]
p.write_text(s)

p=Path('src/pages/SheetPlanner.jsx')
s=p.read_text()
old="""    const components=checked.components.filter(c=>['tapa','base','simple','capa'].includes(c.role||'simple'))
    if(!components.length){missing.push(`${row.figure}${checked.reason?` (${checked.reason})`:''}`);return}
    const roles=new Set(components.map(c=>c.role||'simple'))
    if(roles.has('tapa')!==roles.has('base')){
      missing.push(`${row.figure} (falta ${roles.has('tapa')?'base':'tapa'})`)
      return
    }"""
new="""    const allComponents=checked.components.filter(c=>['tapa','base','simple','capa'].includes(c.role||'simple'))
    const requested=row.component||'complete'
    const components=requested==='complete'?allComponents:allComponents.filter(c=>(c.role||'simple')===requested)
    if(!components.length){missing.push(`${row.figure}${requested!=='complete'?` (${requested} sin SVG)`:checked.reason?` (${checked.reason})`:''}`);return}
    const roles=new Set(allComponents.map(c=>c.role||'simple'))
    if(requested==='complete'&&roles.has('tapa')!==roles.has('base')){
      missing.push(`${row.figure} (falta ${roles.has('tapa')?'base':'tapa'})`)
      return
    }"""
if old not in s: raise SystemExit('buildCompleteKits target not found')
s=s.replace(old,new,1)
old2="""function sheetProductionRows(sheet,multiplier=1){
  const totals={}
  ;(sheet?.placed||[]).forEach(p=>{
    const figure=p.figure||p.name?.split(' · ')[0]||''
    if(!figure)return
    totals[figure]=(totals[figure]||0)+num(p.unitWeight,1)
  })
  return Object.entries(totals).map(([figure,baseQty])=>({figure,baseQty,qty:baseQty*num(multiplier,1)}))
}"""
new2="""function sheetProductionRows(sheet,multiplier=1){
  const totals={}
  ;(sheet?.placed||[]).forEach(p=>{
    const figure=p.figure||p.name?.split(' · ')[0]||''
    if(!figure)return
    const role=['tapa','base'].includes(p.role)?p.role:'complete'
    const key=`${figure}|${role}`
    if(!totals[key])totals[key]={figure,component:role,baseQty:0}
    totals[key].baseQty+=role==='complete'?num(p.unitWeight,1):1
  })
  return Object.values(totals).map(row=>({...row,qty:row.baseQty*num(multiplier,1)}))
}"""
if old2 not in s: raise SystemExit('sheetProductionRows target not found')
s=s.replace(old2,new2,1)
p.write_text(s)
