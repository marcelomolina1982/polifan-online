import React, { useMemo, useState } from 'react'
import { Title, Field, Kpi } from '../components/UI'
import { money } from '../lib/format'

const expenseCategories=['Placas de polifan','Cajas','Pegamento','Vinilo / DTF','Bolsas y embalaje','Transporte','Servicios','Herramientas','Otros']
const incomeCategories=['Seña de pedido','Saldo de pedido','Pedido completo','Venta en local','Otro ingreso']

function localISO(){
  const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10)
}
const blankExpense=()=>({date:localISO(),category:'Placas de polifan',description:'',amount:'',notes:''})
const blankIncome=()=>({date:localISO(),category:'Seña de pedido',description:'',amount:'',notes:''})

export default function Expenses({db,onSave}){
  const incomes=db.incomes||[]
  const expenses=db.expenses||[]
  const [incomeForm,setIncomeForm]=useState(blankIncome())
  const [expenseForm,setExpenseForm]=useState(blankExpense())
  const [editingIncome,setEditingIncome]=useState(null)
  const [editingExpense,setEditingExpense]=useState(null)
  const [filter,setFilter]=useState('')

  const monthKey=localISO().slice(0,7)
  const monthIncome=incomes.filter(x=>String(x.date||'').slice(0,7)===monthKey).reduce((a,x)=>a+Number(x.amount||0),0)
  const monthExpense=expenses.filter(x=>String(x.date||'').slice(0,7)===monthKey).reduce((a,x)=>a+Number(x.amount||0),0)

  const visibleIncomes=useMemo(()=>incomes.filter(x=>!filter||[x.category,x.description,x.notes,x.date].join(' ').toLowerCase().includes(filter.toLowerCase())).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt).localeCompare(String(a.createdAt))),[incomes,filter])
  const visibleExpenses=useMemo(()=>expenses.filter(x=>!filter||[x.category,x.description,x.notes,x.date].join(' ').toLowerCase().includes(filter.toLowerCase())).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt).localeCompare(String(a.createdAt))),[expenses,filter])

  function saveIncome(e){
    e.preventDefault(); const amount=Number(incomeForm.amount)
    if(!incomeForm.date||!incomeForm.description.trim()||!amount||amount<0) return alert('Completá fecha, detalle e importe del ingreso.')
    const next=editingIncome?incomes.map(x=>x.id===editingIncome?{...x,...incomeForm,amount,updatedAt:new Date().toISOString()}:x):[...incomes,{...incomeForm,id:crypto.randomUUID(),amount,createdAt:new Date().toISOString()}]
    onSave({...db,incomes:next}); setIncomeForm(blankIncome()); setEditingIncome(null)
  }
  function saveExpense(e){
    e.preventDefault(); const amount=Number(expenseForm.amount)
    if(!expenseForm.date||!expenseForm.description.trim()||!amount||amount<0) return alert('Completá fecha, detalle e importe del gasto.')
    const next=editingExpense?expenses.map(x=>x.id===editingExpense?{...x,...expenseForm,amount,updatedAt:new Date().toISOString()}:x):[...expenses,{...expenseForm,id:crypto.randomUUID(),amount,createdAt:new Date().toISOString()}]
    onSave({...db,expenses:next}); setExpenseForm(blankExpense()); setEditingExpense(null)
  }
  function editIncome(x){setEditingIncome(x.id);setIncomeForm({...x,amount:String(x.amount||'')});window.scrollTo({top:0,behavior:'smooth'})}
  function editExpense(x){setEditingExpense(x.id);setExpenseForm({...x,amount:String(x.amount||'')});window.scrollTo({top:0,behavior:'smooth'})}
  function removeIncome(x){if(confirm(`¿Eliminar el ingreso “${x.description}”?`)) onSave({...db,incomes:incomes.filter(i=>i.id!==x.id)})}
  function removeExpense(x){if(confirm(`¿Eliminar el gasto “${x.description}”?`)) onSave({...db,expenses:expenses.filter(i=>i.id!==x.id)})}

  return <>
    <Title title="Caja: ingresos y gastos" sub="Registrá toda la plata que entra y sale del negocio."/>
    <div className="cards expense-kpis">
      <Kpi label="Ingresos del mes" value={money(monthIncome)}/>
      <Kpi label="Gastos del mes" value={money(monthExpense)}/>
      <Kpi label="Saldo de caja del mes" value={money(monthIncome-monthExpense)}/>
    </div>

    <div className="grid2 cash-forms">
      <form className="panel cash-income-panel" onSubmit={saveIncome}>
        <div className="panel-heading"><h3>{editingIncome?'Editar ingreso':'Registrar ingreso'}</h3>{editingIncome&&<button type="button" className="ghost" onClick={()=>{setEditingIncome(null);setIncomeForm(blankIncome())}}>Cancelar</button>}</div>
        <Field label="Fecha"><input type="date" value={incomeForm.date} onChange={e=>setIncomeForm({...incomeForm,date:e.target.value})}/></Field>
        <Field label="Tipo"><select value={incomeForm.category} onChange={e=>setIncomeForm({...incomeForm,category:e.target.value})}>{incomeCategories.map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Detalle"><input placeholder="Ej.: Seña pedido #154" value={incomeForm.description} onChange={e=>setIncomeForm({...incomeForm,description:e.target.value})}/></Field>
        <Field label="Importe recibido"><input type="number" min="0" step="0.01" placeholder="$ 0" value={incomeForm.amount} onChange={e=>setIncomeForm({...incomeForm,amount:e.target.value})}/></Field>
        <Field label="Observaciones"><textarea value={incomeForm.notes} onChange={e=>setIncomeForm({...incomeForm,notes:e.target.value})}/></Field>
        <button className="primary" type="submit">＋ Guardar ingreso</button>
      </form>

      <form className="panel cash-expense-panel" onSubmit={saveExpense}>
        <div className="panel-heading"><h3>{editingExpense?'Editar gasto':'Registrar gasto'}</h3>{editingExpense&&<button type="button" className="ghost" onClick={()=>{setEditingExpense(null);setExpenseForm(blankExpense())}}>Cancelar</button>}</div>
        <Field label="Fecha"><input type="date" value={expenseForm.date} onChange={e=>setExpenseForm({...expenseForm,date:e.target.value})}/></Field>
        <Field label="Categoría"><select value={expenseForm.category} onChange={e=>setExpenseForm({...expenseForm,category:e.target.value})}>{expenseCategories.map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Detalle"><input placeholder="Ej.: Compra de 5 placas" value={expenseForm.description} onChange={e=>setExpenseForm({...expenseForm,description:e.target.value})}/></Field>
        <Field label="Importe pagado"><input type="number" min="0" step="0.01" placeholder="$ 0" value={expenseForm.amount} onChange={e=>setExpenseForm({...expenseForm,amount:e.target.value})}/></Field>
        <Field label="Observaciones"><textarea value={expenseForm.notes} onChange={e=>setExpenseForm({...expenseForm,notes:e.target.value})}/></Field>
        <button className="primary" type="submit">＋ Guardar gasto</button>
      </form>
    </div>

    <div className="panel"><div className="panel-heading expense-list-head"><h3>Movimientos registrados</h3><input className="expense-search" placeholder="Buscar movimiento…" value={filter} onChange={e=>setFilter(e.target.value)}/></div></div>
    <div className="grid2 cash-history">
      <div className="panel table-wrap"><h3>Dinero ingresado</h3><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Importe</th><th></th></tr></thead><tbody>{visibleIncomes.map(x=><tr key={x.id}><td>{new Date(x.date+'T12:00:00').toLocaleDateString('es-AR')}</td><td>{x.category}</td><td><b>{x.description}</b><small className="block">{x.notes||''}</small></td><td className="income-amount">+ {money(x.amount)}</td><td><div className="row-actions"><button className="ghost" onClick={()=>editIncome(x)}>Editar</button><button className="danger smallbtn" onClick={()=>removeIncome(x)}>Eliminar</button></div></td></tr>)}</tbody></table>{!visibleIncomes.length&&<p className="empty-message">Todavía no registraste ingresos.</p>}</div>
      <div className="panel table-wrap"><h3>Dinero salido</h3><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Detalle</th><th>Importe</th><th></th></tr></thead><tbody>{visibleExpenses.map(x=><tr key={x.id}><td>{new Date(x.date+'T12:00:00').toLocaleDateString('es-AR')}</td><td>{x.category}</td><td><b>{x.description}</b><small className="block">{x.notes||''}</small></td><td className="expense-amount">- {money(x.amount)}</td><td><div className="row-actions"><button className="ghost" onClick={()=>editExpense(x)}>Editar</button><button className="danger smallbtn" onClick={()=>removeExpense(x)}>Eliminar</button></div></td></tr>)}</tbody></table>{!visibleExpenses.length&&<p className="empty-message">Todavía no registraste gastos.</p>}</div>
    </div>
  </>
}
