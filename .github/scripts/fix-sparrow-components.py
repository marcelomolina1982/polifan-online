from pathlib import Path
p=Path('src/pages/MotorDefinitivo.jsx')
s=p.read_text()
old="""function componentsForFigure(index,figure){
  const target=normalizeFigureKey(figure)
  if(!target)return null
  const exact=uniqueComplete(index.exact.get(target)||[])
  if(exact)return exact
  const flexible=index.groups.filter(group=>group.aliases.some(alias=>alias===target||alias.includes(target)||target.includes(alias)))
  return uniqueComplete(flexible)
}"""
new="""function componentsForFigure(index,figure,requested='complete'){
  const target=normalizeFigureKey(figure)
  if(!target)return null
  const candidates=[...(index.exact.get(target)||[]),...index.groups.filter(group=>group.aliases.some(alias=>alias===target||alias.includes(target)||target.includes(alias)))]
  const groups=[...new Map(candidates.map(g=>[g.key,g])).values()]
  if(requested==='complete')return uniqueComplete(groups)
  const matches=[]
  groups.forEach(group=>{
    const comp=group.items.find(x=>x.role===requested&&x.svgText)
    if(comp)matches.push({key:group.key,comp})
  })
  const unique=[...new Map(matches.map(x=>[x.key,x])).values()]
  return unique.length===1?[unique[0].comp]:null
}"""
if old not in s: raise SystemExit('componentsForFigure target not found')
s=s.replace(old,new,1)
old="""  pendingCutByDelivery(db).forEach(group=>group.rows.forEach(row=>{
    const comps=componentsForFigure(index,row.figure)
    if(!comps){missing.set(row.figure,(missing.get(row.figure)||0)+Number(row.qty||0));return}
    for(let i=0;i<Number(row.qty||0);i++)units.push({figure:row.figure,date:group.date||'',orders:group.orders||[],components:comps})
  }))"""
new="""  pendingCutByDelivery(db).forEach(group=>group.rows.forEach(row=>{
    const component=row.component||'complete'
    const comps=componentsForFigure(index,row.figure,component)
    if(!comps){const label=component==='complete'?row.figure:`${row.figure} · ${component}`;missing.set(label,(missing.get(label)||0)+Number(row.qty||0));return}
    for(let i=0;i<Number(row.qty||0);i++)units.push({figure:row.figure,component,date:group.date||'',orders:group.orders||[],components:comps})
  }))"""
if old not in s: raise SystemExit('pendingUnits target not found')
s=s.replace(old,new,1)
old="""function summarizeUnits(units){
  const m=new Map();units.forEach(u=>m.set(u.figure,(m.get(u.figure)||0)+1))
  return [...m.entries()].map(([figure,qty])=>({figure,qty}))
}"""
new="""function summarizeUnits(units){
  const m=new Map();units.forEach(u=>{const component=u.component||'complete',key=`${u.figure}|${component}`;const row=m.get(key)||{figure:u.figure,component,qty:0};row.qty++;m.set(key,row)})
  return [...m.values()]
}"""
if old not in s: raise SystemExit('summarizeUnits target not found')
s=s.replace(old,new,1)
# Preserve component in compact local storage too
s=s.replace("u=>({figure:u.figure,date:u.date||''})","u=>({figure:u.figure,component:u.component||'complete',date:u.date||''})",1)
p.write_text(s)
