import React, { useState } from 'react'
import { Title, Kpi } from '../components/UI'
import { money } from '../lib/format'

export default function Monthly({db}){
  const now=new Date()
  const [month,setMonth]=useState(now.getMonth()+1)
  const [year,setYear]=useState(now.getFullYear())
  const list=db.orders.filter(o=>{
    const raw=o.date||o.createdAt
    const d=new Date((raw||'').slice(0,10)+'T12:00:00')
    return d.getMonth()+1===Number(month)&&d.getFullYear()===Number(year)
  })
  const valid=list.filter(o=>o.status!=='Cancelado')
  const pieces=valid.reduce((a,o)=>a+(o.items||[]).reduce((b,i)=>b+Number(i.qty||0),0),0)
  const revenue=valid.reduce((a,o)=>a+Number(o.total||0),0)
  const expenses=(db.expenses||[]).filter(e=>{
    const d=new Date((e.date||'').slice(0,10)+'T12:00:00')
    return d.getMonth()+1===Number(month)&&d.getFullYear()===Number(year)
  })
  const expenseTotal=expenses.reduce((a,e)=>a+Number(e.amount||0),0)
  const netProfit=revenue-expenseTotal
  const byFig={}
  valid.forEach(o=>(o.items||[]).forEach(i=>byFig[i.figure]=(byFig[i.figure]||0)+Number(i.qty||0)))
  const byExpense={}
  expenses.forEach(e=>byExpense[e.category||'Otros']=(byExpense[e.category||'Otros']||0)+Number(e.amount||0))

  return <>
    <Title title="Resumen de facturación" sub="Consultá facturación, gastos y ganancia libre por mes."/>
    <div className="panel filters"><select value={month} onChange={e=>setMonth(e.target.value)}>{Array.from({length:12},(_,i)=><option value={i+1} key={i}>{new Date(2024,i,1).toLocaleString('es-AR',{month:'long'})}</option>)}</select><input type="number" value={year} onChange={e=>setYear(e.target.value)}/></div>
    <div className="cards monthly-finance-cards">
      <Kpi label="Facturación" value={money(revenue)}/>
      <Kpi label="Gastos" value={money(expenseTotal)}/>
      <div className={'kpi net-profit '+(netProfit<0?'negative':'')}><small>Ganancia libre</small><b>{money(netProfit)}</b><span>Facturación menos gastos</span></div>
      <Kpi label="Pedidos" value={valid.length}/>
      <Kpi label="Piezas" value={pieces}/>
      <Kpi label="Entregados" value={valid.filter(o=>o.status==='Entregado').length}/>
    </div>
    <div className="grid2 monthly-details">
      <div className="panel table-wrap"><h3>Figuras vendidas</h3><table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>{Object.entries(byFig).sort((a,b)=>b[1]-a[1]).map(([f,q])=><tr key={f}><td>{f}</td><td><b>{q}</b></td></tr>)}</tbody></table>{!Object.keys(byFig).length&&<p className="empty-message">No hay ventas registradas en este mes.</p>}</div>
      <div className="panel table-wrap"><h3>Gastos por categoría</h3><table><thead><tr><th>Categoría</th><th>Total</th></tr></thead><tbody>{Object.entries(byExpense).sort((a,b)=>b[1]-a[1]).map(([c,v])=><tr key={c}><td>{c}</td><td><b>{money(v)}</b></td></tr>)}</tbody></table>{!Object.keys(byExpense).length&&<p className="empty-message">No hay gastos registrados en este mes.</p>}</div>
    </div>
  </>
}
