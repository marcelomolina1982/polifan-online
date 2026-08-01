import React, { useEffect, useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { statusColors } from '../lib/constants'
import { money, pricePerUnit, today } from '../lib/format'
import { DAILY_PIECE_LIMIT, PIECES_PER_SHEET, daysForPieces, piecesScheduledForDate, sheetsForPieces } from '../lib/production'

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
  const alreadyScheduled=piecesScheduledForDate(db.orders,form.delivery,editing?.id||null)
  const projectedPieces=alreadyScheduled+qty
  const availablePieces=Math.max(0,DAILY_PIECE_LIMIT-alreadyScheduled)
  const sheets=sheetsForPieces(qty)
  const productionDays=daysForPieces(qty)

  function updateItem(ix,key,val){
    setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:val}:it)}))
  }

  async function submit(e){
    e.preventDefault()
    if(!form.client.trim()) return alert('Ingresá el nombre del cliente.')
    if(!form.items.some(i=>i.figure && Number(i.qty)>0)) return alert('Agregá al menos una figura.')
    if(form.delivery && projectedPieces>=DAILY_PIECE_LIMIT){
      const excess=Math.max(0,projectedPieces-DAILY_PIECE_LIMIT)
      const message=projectedPieces===DAILY_PIECE_LIMIT
        ? `Ese día llegará exactamente a ${DAILY_PIECE_LIMIT} piezas (${sheetsForPieces(projectedPieces)} planchas). ¿Querés guardar el pedido igualmente?`
        : `Ese día ya tiene ${alreadyScheduled} piezas. Con este pedido pasará a ${projectedPieces} piezas (${sheetsForPieces(projectedPieces)} planchas), superando el límite por ${excess}. ¿Querés seguir agregando para ese día?`
      if(!window.confirm(message)) return
    }
    const automaticNumber=editing ? form.number : nextOrderNumber(db.orders)
    const final={...form,number:automaticNumber,total,unitPrice:pricePerUnit(qty),productionSheets:sheets,productionDays,updatedAt:new Date().toISOString()}
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

      {form.delivery&&<div className={'production-capacity '+(projectedPieces>DAILY_PIECE_LIMIT?'over':projectedPieces===DAILY_PIECE_LIMIT?'full':projectedPieces>=90?'near':'available')}>
        <div className="production-capacity-head"><b>Capacidad para la fecha de entrega</b><span>{projectedPieces} / {DAILY_PIECE_LIMIT} piezas</span></div>
        <div className="capacity-track"><span style={{width:`${Math.min(100,(projectedPieces/DAILY_PIECE_LIMIT)*100)}%`}}/></div>
        <small>Ya programadas: {alreadyScheduled} · Este pedido: {qty} · Disponibles antes de cargarlo: {availablePieces}</small>
        {projectedPieces>DAILY_PIECE_LIMIT&&<strong>⚠ Se supera la capacidad diaria por {projectedPieces-DAILY_PIECE_LIMIT} piezas.</strong>}
      </div>}

      <div className="order-total production-totals">
        <div><small>Total de piezas</small><b>{qty}</b></div>
        <div><small>Planchas necesarias</small><b>{sheets}</b><span>{PIECES_PER_SHEET} figuras por plancha</span></div>
        <div><small>Días necesarios</small><b>{productionDays}</b><span>Máximo {DAILY_PIECE_LIMIT} piezas por día</span></div>
        <div><small>Precio unitario</small><b>{money(pricePerUnit(qty))}</b></div>
        <div><small>Valor del pedido</small><b>{money(total)}</b></div>
      </div>
      <div className="actions"><button className="primary">{editing?'Guardar cambios':'Guardar pedido'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{localStorage.removeItem(DRAFT_KEY);clearEdit();setForm(blank());setDraftSaved(false)}}>Cancelar</button>}</div>
    </form>
  </>
}
