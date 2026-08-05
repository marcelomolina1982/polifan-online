import React, { useState } from 'react'
import { Title, Kpi } from '../components/UI'
import { money } from '../lib/format'
import { PACKAGING_COST, estimatedOrderProfit, orderPieces } from '../lib/finance'
import { argentinaNow } from '../lib/production'

function sameMonth(dateValue,month,year){
  if(!dateValue) return false
  const d=new Date(String(dateValue).slice(0,10)+'T12:00:00')
  return d.getMonth()+1===Number(month)&&d.getFullYear()===Number(year)
}

export default function Monthly({db}){
  const [currentYear,currentMonth]=argentinaNow().date.split('-')
  const [month,setMonth]=useState(Number(currentMonth))
  const [year,setYear]=useState(Number(currentYear))

  const orders=(db.orders||[]).filter(o=>sameMonth(o.date||o.createdAt,month,year))
  const valid=orders.filter(o=>o.status!=='Cancelado')
  const pieces=valid.reduce((a,o)=>a+orderPieces(o),0)
  const billed=valid.reduce((a,o)=>a+Number(o.total||0),0)
  const incomes=(db.incomes||[]).filter(x=>sameMonth(x.date,month,year))
  const incomeTotal=incomes.reduce((a,x)=>a+Number(x.amount||0),0)
  const expenses=(db.expenses||[]).filter(x=>sameMonth(x.date,month,year))
  const expenseTotal=expenses.reduce((a,x)=>a+Number(x.amount||0),0)
  const packagingOrders=valid.filter(o=>o.shippingPackaging==='Sí')
  const packagingTotal=packagingOrders.length*PACKAGING_COST
  const cashOut=expenseTotal+packagingTotal
  const cashBalance=incomeTotal-cashOut
  const grossEstimatedProfit=valid.reduce((a,o)=>a+estimatedOrderProfit(o).base,0)
  const estimatedProfit=grossEstimatedProfit-packagingTotal

  const byFig={}
  valid.forEach(o=>(o.items||[]).forEach(i=>byFig[i.figure]=(byFig[i.figure]||0)+Number(i.qty||0)))
  const byExpense={}
  expenses.forEach(e=>byExpense[e.category||'Otros']=(byExpense[e.category||'Otros']||0)+Number(e.amount||0))
  const profitRows=valid.map(o=>({o,...estimatedOrderProfit(o)})).sort((a,b)=>String(b.o.date||'').localeCompare(String(a.o.date||'')))

  return <>
    <Title title="Resumen mensual" sub="Separá facturación, dinero realmente cobrado, gastos y ganancia estimada."/>
    <div className="panel filters"><select value={month} onChange={e=>setMonth(e.target.value)}>{Array.from({length:12},(_,i)=><option value={i+1} key={i}>{new Date(2024,i,1).toLocaleString('es-AR',{month:'long'})}</option>)}</select><input type="number" value={year} onChange={e=>setYear(e.target.value)}/></div>

    <h3 className="monthly-section-title">Ganancia estimada por producción</h3>
    <div className="cards monthly-finance-cards">
      <Kpi label="Piezas vendidas" value={pieces}/>
      <Kpi label="Ganancia antes de embalajes" value={money(grossEstimatedProfit)}/>
      <Kpi label={`Embalajes (${packagingOrders.length} × ${money(PACKAGING_COST)})`} value={money(packagingTotal)}/>
      <div className={'kpi net-profit '+(estimatedProfit<0?'negative':'')}><small>Ganancia mensual estimada</small><b>{money(estimatedProfit)}</b><span>Ganancia por figuras menos embalajes</span></div>
    </div>
    <div className="profit-rules panel"><b>Ganancia aplicada por cantidad total del pedido:</b><span>1 a 5: $4.900 por figura</span><span>6 a 11: $3.100 por figura</span><span>12 o más: $2.300 por figura</span></div>

    <h3 className="monthly-section-title">Movimiento real de dinero</h3>
    <div className="cards monthly-finance-cards">
      <Kpi label="Facturación de pedidos" value={money(billed)}/>
      <Kpi label="Dinero ingresado" value={money(incomeTotal)}/>
      <Kpi label="Gastos cargados" value={money(expenseTotal)}/>
      <Kpi label="Embalajes automáticos" value={money(packagingTotal)}/>
      <div className={'kpi net-profit '+(cashBalance<0?'negative':'')}><small>Saldo de caja</small><b>{money(cashBalance)}</b><span>Ingresos menos gastos y embalajes</span></div>
      <Kpi label="Pedidos del mes" value={valid.length}/>
    </div>

    <div className="panel table-wrap"><h3>Ganancia estimada por pedido</h3><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Piezas</th><th>Ganancia por pieza</th><th>Ganancia figuras</th><th>Embalaje</th><th>Ganancia estimada</th></tr></thead><tbody>{profitRows.map(({o,pieces,perPiece,base,packaging,total})=><tr key={o.id}><td>#{o.number}</td><td>{o.client}</td><td>{pieces}</td><td>{money(perPiece)}</td><td>{money(base)}</td><td>{packaging?'- '+money(packaging):'—'}</td><td><b>{money(total)}</b></td></tr>)}</tbody></table>{!profitRows.length&&<p className="empty-message">No hay pedidos registrados en este mes.</p>}</div>

    <div className="grid2 monthly-details">
      <div className="panel table-wrap"><h3>Figuras vendidas</h3><table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>{Object.entries(byFig).sort((a,b)=>b[1]-a[1]).map(([f,q])=><tr key={f}><td>{f}</td><td><b>{q}</b></td></tr>)}</tbody></table>{!Object.keys(byFig).length&&<p className="empty-message">No hay ventas registradas.</p>}</div>
      <div className="panel table-wrap"><h3>Gastos por categoría</h3><table><thead><tr><th>Categoría</th><th>Total</th></tr></thead><tbody>{Object.entries(byExpense).sort((a,b)=>b[1]-a[1]).map(([c,v])=><tr key={c}><td>{c}</td><td><b>{money(v)}</b></td></tr>)}</tbody></table>{!Object.keys(byExpense).length&&<p className="empty-message">No hay gastos registrados.</p>}</div>
    </div>
  </>
}
