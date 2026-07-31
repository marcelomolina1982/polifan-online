import React, { useEffect, useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { statusColors } from '../lib/constants'
import { money, pricePerUnit, today } from '../lib/format'

export default function OrderForm({db,onSave,editing,clearEdit}){
  const DRAFT_KEY='polifan-order-draft-v1'
  const nextOrderNumber=(orders=db.orders)=>String(
    Math.max(0,...(orders||[]).map(o=>Number(o.number)||0))+1
  ).padStart(3,'0')
  const blank=()=>({
    id:crypto.randomUUID(), number:nextOrderNumber(),
    date:today(), client:'',phone:'',zone:'',carrier:'Logística',delivery:'',priority:'Normal',
    status:'Ingresado',paid:'No',notes:'',items:[{figure:'',qty:1}]
  })
  const [form,setForm]=useState(()=>{
    try{
      const saved=localStorage.getItem(DRAFT_KEY)
      if(!saved) return blank()
      const draft=JSON.parse(saved)
      return {...blank(),...draft,number:nextOrderNumber()}
    }catch{return blank()}
  })
  const [draftSaved,setDraftSaved]=useState(false)
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])

  useEffect(()=>{
    if(editing){
      setForm(JSON.parse(JSON.stringify(editing)))
      setDraftSaved(false)
    }
  },[editing])

  useEffect(()=>{
    const timer=setTimeout(()=>{
      try{
        localStorage.setItem(DRAFT_KEY,JSON.stringify(form))
        setDraftSaved(true)
      }catch{}
    },400)
    return ()=>clearTimeout(timer)
  },[form])

  const qty=form.items.reduce((a,i)=>a+Number(i.qty||0),0)
  const total=qty*pricePerUnit(qty)

  function updateItem(ix,key,val){
    setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:val}:it)}))
  }

  async function submit(e){
    e.preventDefault()
    if(!form.client.trim()) return alert('Ingresá el nombre del cliente.')
    if(!form.items.some(i=>i.figure && Number(i.qty)>0)) return alert('Agregá al menos una figura.')
    const automaticNumber=editing ? form.number : nextOrderNumber(db.orders)
    const final={...form,number:automaticNumber,total,unitPrice:pricePerUnit(qty),updatedAt:new Date().toISOString()}
    const orders=editing ? db.orders.map(o=>o.id===final.id?final:o) : [...db.orders,{...final,createdAt:new Date().toISOString()}]
    await onSave({...db,orders})
    localStorage.removeItem(DRAFT_KEY)
    const nextBlank={...blank(),number:nextOrderNumber(orders)}
    setForm(nextBlank); setDraftSaved(false); clearEdit()
    alert(editing?'Pedido actualizado.':'Pedido guardado.')
  }

  return <>
    <Title title={editing?'Editar pedido':'Nuevo pedido'} sub="Cargá todos los datos del pedido y las figuras solicitadas." actions={<span className="draft-status">{draftSaved?'Borrador guardado automáticamente':'Guardando borrador…'}</span>}/>
    <form className="panel" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
        <Field label="Nº de pedido (automático)"><input value={form.number} readOnly title="Se asigna automáticamente al guardar el pedido"/></Field>
        <Field label="Cliente"><input value={form.client} onChange={e=>setForm({...form,client:e.target.value})}/></Field>
        <Field label="Teléfono"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
        <Field label="Zona de envío"><input value={form.zone} onChange={e=>setForm({...form,zone:e.target.value})}/></Field>
        <Field label="Despachado por"><select value={form.carrier} onChange={e=>setForm({...form,carrier:e.target.value})}>
          {['Via Cargo','Andreani','Correo Argentino','Logística','Retiro en local'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Fecha de entrega"><input type="date" value={form.delivery} onChange={e=>setForm({...form,delivery:e.target.value})}/></Field>
        <Field label="Prioridad"><select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option>Normal</option><option>Urgente</option></select></Field>
        <Field label="Estado"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Pagado"><select value={form.paid} onChange={e=>setForm({...form,paid:e.target.value})}><option>No</option><option>Sí</option></select></Field>
      </div>

      <h3>Figuras</h3>
      {form.items.map((it,ix)=><div className="item-row" key={ix}>
        <input list={`fig-${ix}`} placeholder="🔍 Buscar figura" value={it.figure} onChange={e=>updateItem(ix,'figure',e.target.value)}/>
        <datalist id={`fig-${ix}`}>{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist>
        <input type="number" min="1" value={it.qty} onChange={e=>updateItem(ix,'qty',e.target.value)}/>
        <button type="button" className="danger smallbtn" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,i)=>i!==ix)}))}>×</button>
      </div>)}
      <button type="button" className="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{figure:'',qty:1}]}))}>＋ Agregar figura</button>

      <Field label="Observaciones"><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>

      <div className="order-total">
        <div><small>Total de piezas</small><b>{qty}</b></div>
        <div><small>Precio unitario</small><b>{money(pricePerUnit(qty))}</b></div>
        <div><small>Valor del pedido</small><b>{money(total)}</b></div>
      </div>
      <div className="actions"><button className="primary">{editing?'Guardar cambios':'Guardar pedido'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{localStorage.removeItem(DRAFT_KEY);clearEdit();setForm(blank());setDraftSaved(false)}}>Cancelar</button>}</div>
    </form>
  </>
}
