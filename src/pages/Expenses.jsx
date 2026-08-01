import React, { useMemo, useState } from 'react'
import { Title, Field, Kpi } from '../components/UI'
import { money } from '../lib/format'

const categories=['Placas de polifan','Cajas','Pegamento','Vinilo / DTF','Bolsas y embalaje','Transporte','Servicios','Herramientas','Otros']

function localISO(){
  const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10)
}

const blank=()=>({date:localISO(),category:'Placas de polifan',description:'',amount:'',notes:''})

export default function Expenses({db,onSave}){
  const [form,setForm]=useState(blank())
  const [editingId,setEditingId]=useState(null)
  const [filter,setFilter]=useState('')
  const expenses=db.expenses||[]

  const visible=useMemo(()=>expenses
    .filter(e=>!filter || [e.category,e.description,e.notes,e.date].join(' ').toLowerCase().includes(filter.toLowerCase()))
    .slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))),[expenses,filter])

  const monthKey=localISO().slice(0,7)
  const monthTotal=expenses.filter(e=>String(e.date||'').slice(0,7)===monthKey).reduce((a,e)=>a+Number(e.amount||0),0)
  const total=expenses.reduce((a,e)=>a+Number(e.amount||0),0)

  function submit(e){
    e.preventDefault()
    const amount=Number(form.amount)
    if(!form.date || !form.category || !form.description.trim() || !amount || amount<0){
      alert('Completá la fecha, la categoría, el detalle y un importe válido.')
      return
    }
    let next
    if(editingId){
      next=expenses.map(x=>x.id===editingId?{...x,...form,amount,updatedAt:new Date().toISOString()}:x)
    }else{
      next=[...expenses,{...form,id:crypto.randomUUID(),amount,createdAt:new Date().toISOString()}]
    }
    onSave({...db,expenses:next})
    setForm(blank()); setEditingId(null)
  }

  function edit(item){
    setEditingId(item.id)
    setForm({date:item.date||localISO(),category:item.category||'Otros',description:item.description||'',amount:String(item.amount||''),notes:item.notes||''})
    window.scrollTo({top:0,behavior:'smooth'})
  }

  function remove(item){
    if(!confirm(`¿Eliminar el gasto “${item.description}” por ${money(item.amount)}?`)) return
    onSave({...db,expenses:expenses.filter(x=>x.id!==item.id)})
    if(editingId===item.id){setEditingId(null);setForm(blank())}
  }

  return <>
    <Title title="Gastos" sub="Registrá compras e insumos para calcular la ganancia libre del negocio."/>
    <div className="cards expense-kpis">
      <Kpi label="Gastos del mes" value={money(monthTotal)}/>
      <Kpi label="Gastos registrados" value={expenses.length}/>
      <Kpi label="Total histórico" value={money(total)}/>
    </div>

    <form className="panel" onSubmit={submit}>
      <div className="panel-heading"><h3>{editingId?'Editar gasto':'Agregar gasto'}</h3>{editingId&&<button type="button" className="ghost" onClick={()=>{setEditingId(null);setForm(blank())}}>Cancelar edición</button>}</div>
      <div className="form-grid expense-form">
        <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
        <Field label="Categoría"><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{categories.map(c=><option key={c}>{c}</option>)}</select></Field>
        <Field label="Detalle"><input placeholder="Ej.: 5 placas de polifan" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field>
        <Field label="Importe total"><input type="number" min="0" step="0.01" placeholder="$ 0" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></Field>
      </div>
      <Field label="Observaciones (opcional)"><textarea placeholder="Proveedor, cantidad, forma de pago u otra referencia" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
      <button className="primary" type="submit">{editingId?'Guardar cambios':'＋ Registrar gasto'}</button>
    </form>

    <div className="panel">
      <div className="panel-heading expense-list-head"><h3>Historial de gastos</h3><input className="expense-search" placeholder="Buscar gasto…" value={filter} onChange={e=>setFilter(e.target.value)}/></div>
      <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Detalle</th><th>Observaciones</th><th>Importe</th><th>Acciones</th></tr></thead>
      <tbody>{visible.map(item=><tr key={item.id}><td>{item.date?new Date(item.date+'T12:00:00').toLocaleDateString('es-AR'):'—'}</td><td><span className="badge purple">{item.category}</span></td><td><b>{item.description}</b></td><td>{item.notes||'—'}</td><td className="expense-amount">{money(item.amount)}</td><td><div className="row-actions"><button className="ghost" onClick={()=>edit(item)}>Editar</button><button className="danger smallbtn" onClick={()=>remove(item)}>Eliminar</button></div></td></tr>)}</tbody></table>
      {!visible.length&&<p className="empty-message">Todavía no hay gastos para mostrar.</p>}</div>
    </div>
  </>
}
