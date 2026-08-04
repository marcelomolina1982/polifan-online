import React, { useEffect, useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { statusColors } from '../lib/constants'
import { money, pricePerUnit, today } from '../lib/format'
import { DAILY_PIECE_LIMIT, PIECES_PER_SHEET, daysForPieces, piecesScheduledForDate, sheetsForPieces, isSunday } from '../lib/production'
import { packagingForPieces } from '../lib/packaging'
import { upsertClientFromOrder } from '../lib/clients'

export default function OrderForm({db,onSave,editing,clearEdit}){
  const DRAFT_KEY='polifan-order-draft-v1'
  const nextOrderNumber=(orders=db.orders)=>String(
    Math.max(0,...(orders||[]).map(o=>Number(o.number)||0))+1
  ).padStart(3,'0')
  const blank=()=>({
    id:crypto.randomUUID(), number:nextOrderNumber(),
    date:today(), client:'',phone:'',dni:'',email:'',address:'',betweenStreets:'',locality:'',province:'',postalCode:'',zone:'',deliveryType:'Logística',carrier:'Logística',agencyDelivery:'Envío a domicilio',delivery:'',priority:'Normal',
    status:'Ingresado',paid:'No',shippingPackaging:'No',notes:'',items:[{figure:'',qty:1}]
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
      const copy=JSON.parse(JSON.stringify(editing))
      if(!copy.deliveryType){
        const legacy=String(copy.carrier||'').toLocaleLowerCase('es')
        copy.deliveryType=legacy.includes('retiro')?'Retiro en el local':(legacy.includes('via cargo')||legacy.includes('vía cargo')||legacy.includes('correo argentino'))?'Vía Cargo / Correo Argentino':'Logística'
      }
      setForm({...blank(),...copy})
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
  const packaging=packagingForPieces(qty)
  const matchingClients=useMemo(()=>{
    const term=String(form.phone||form.client||'').trim().toLowerCase()
    if(term.length<3) return []
    const source=[...(db.clients||[]),...(db.orders||[]).map(o=>({name:o.client,phone:o.phone,dni:o.dni,email:o.email,address:o.address,betweenStreets:o.betweenStreets,locality:o.locality,province:o.province,postalCode:o.postalCode}))]
    const seen=new Set()
    return source.filter(c=>{const key=String(c.phone||c.name||'').toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return `${c.name||''} ${c.phone||''}`.toLowerCase().includes(term)}).slice(0,5)
  },[db.clients,db.orders,form.phone,form.client])
  function useClient(c){setForm(f=>({...f,client:c.name||f.client,phone:c.phone||f.phone,dni:c.dni||f.dni,email:c.email||f.email,address:c.address||f.address,betweenStreets:c.betweenStreets||f.betweenStreets,locality:c.locality||f.locality,province:c.province||f.province,postalCode:c.postalCode||f.postalCode}))}

  function updateItem(ix,key,val){
    setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:val}:it)}))
  }

  async function submit(e){
    e.preventDefault()
    if(!form.client.trim()) return alert('Ingresá el nombre y apellido del cliente.')
    if(!form.phone.trim()) return alert('Ingresá el teléfono del cliente.')
    const deliveryType=form.deliveryType||form.carrier||'Logística'
    if(deliveryType==='Logística'){
      if(!form.address?.trim()) return alert('Ingresá el domicilio.')
      if(!form.betweenStreets?.trim()) return alert('Ingresá las entre calles.')
      if(!form.locality?.trim()) return alert('Ingresá la localidad.')
      if(!form.postalCode?.trim()) return alert('Ingresá el código postal.')
      if(!form.email?.trim()) return alert('Ingresá el correo electrónico.')
    }
    if(deliveryType==='Vía Cargo / Correo Argentino'){
      if(!form.dni?.trim()) return alert('Ingresá el DNI.')
      if(!form.address?.trim()) return alert('Ingresá el domicilio.')
      if(!form.locality?.trim()) return alert('Ingresá la localidad.')
      if(!form.province?.trim()) return alert('Ingresá la provincia.')
      if(!form.postalCode?.trim()) return alert('Ingresá el código postal.')
      if(!form.email?.trim()) return alert('Ingresá el correo electrónico.')
    }
    if(!form.items.some(i=>i.figure && Number(i.qty)>0)) return alert('Agregá al menos una figura.')
    if(form.delivery && isSunday(form.delivery)) return alert('Los domingos no se cuentan como días de producción. Elegí otra fecha de entrega.')
    if(form.delivery && projectedPieces>=DAILY_PIECE_LIMIT){
      const excess=Math.max(0,projectedPieces-DAILY_PIECE_LIMIT)
      const message=projectedPieces===DAILY_PIECE_LIMIT
        ? `Ese día llegará exactamente a ${DAILY_PIECE_LIMIT} piezas (${sheetsForPieces(projectedPieces)} planchas). ¿Querés guardar el pedido igualmente?`
        : `Ese día ya tiene ${alreadyScheduled} piezas. Con este pedido pasará a ${projectedPieces} piezas (${sheetsForPieces(projectedPieces)} planchas), superando el límite por ${excess}. ¿Querés seguir agregando para ese día?`
      if(!window.confirm(message)) return
    }
    const automaticNumber=editing ? form.number : nextOrderNumber(db.orders)
    const final={...form,zone:[form.locality,form.province].filter(Boolean).join(' · '),number:automaticNumber,total,unitPrice:pricePerUnit(qty),productionSheets:sheets,productionDays,updatedAt:new Date().toISOString()}
    const orders=editing ? db.orders.map(o=>o.id===final.id?final:o) : [...db.orders,{...final,createdAt:new Date().toISOString()}]
    const clients=upsertClientFromOrder(db.clients||[],final)
    await onSave({...db,orders,clients})
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
        <Field label="Tipo de entrega"><select value={form.deliveryType||'Logística'} onChange={e=>setForm({...form,deliveryType:e.target.value,carrier:e.target.value})}><option>Logística</option><option>Retiro en el local</option><option>Vía Cargo / Correo Argentino</option></select></Field>
        <Field label={(form.deliveryType||'Logística')==='Vía Cargo / Correo Argentino'?'DNI *':'DNI (opcional)'}><input inputMode="numeric" value={form.dni||''} onChange={e=>setForm({...form,dni:e.target.value.replace(/\D/g,'')})} placeholder="DNI del cliente"/></Field>
        <Field label="Correo electrónico"><input type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})} placeholder="cliente@email.com"/></Field>
        {matchingClients.length>0&&<div className="client-autofill"><small>Clientes encontrados</small>{matchingClients.map((c,i)=><button type="button" key={(c.phone||c.name)+i} onClick={()=>useClient(c)}><b>{c.name}</b><span>{c.phone||'Sin teléfono'} · {[c.locality,c.province].filter(Boolean).join(', ')||'Sin dirección'}</span></button>)}</div>}
        {(form.deliveryType||'Logística')!=='Retiro en el local'&&<>
          <Field label="Domicilio"><input value={form.address||''} onChange={e=>setForm({...form,address:e.target.value})} placeholder="Calle y número"/></Field>
          {(form.deliveryType||'Logística')==='Logística'&&<Field label="Entre calles"><input value={form.betweenStreets||''} onChange={e=>setForm({...form,betweenStreets:e.target.value})} placeholder="Entre calle... y calle..."/></Field>}
          <Field label="Localidad"><input value={form.locality||''} onChange={e=>setForm({...form,locality:e.target.value})} placeholder="Ej.: Rosario"/></Field>
          <Field label="Provincia"><input value={form.province||''} onChange={e=>setForm({...form,province:e.target.value})} placeholder="Ej.: Santa Fe"/></Field>
          <Field label="Código postal"><input value={form.postalCode||''} onChange={e=>setForm({...form,postalCode:e.target.value.replace(/[^0-9A-Za-z-]/g,'')})} placeholder="Ej.: 2000" autoComplete="postal-code"/></Field>
        </>}
        {(form.deliveryType||'Logística')==='Vía Cargo / Correo Argentino'&&<Field label="Modalidad del expreso"><select value={form.agencyDelivery||'Envío a domicilio'} onChange={e=>setForm({...form,agencyDelivery:e.target.value})}><option>Envío a domicilio</option><option>Retiro en agencia</option></select></Field>}
        <Field label="Fecha de entrega"><input type="date" value={form.delivery} onChange={e=>setForm({...form,delivery:e.target.value})}/></Field>
        <Field label="Prioridad"><select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option>Normal</option><option>Urgente</option></select></Field>
        <Field label="Estado"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Pagado"><select value={form.paid} onChange={e=>setForm({...form,paid:e.target.value})}><option>No</option><option>Sí</option></select></Field>
        <Field label="¿Lleva embalaje de envío?"><select value={form.shippingPackaging||'No'} onChange={e=>setForm({...form,shippingPackaging:e.target.value})}><option>No</option><option>Sí</option></select></Field>
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

      {form.delivery&&<div className={'production-capacity '+(projectedPieces>DAILY_PIECE_LIMIT?'over':projectedPieces===DAILY_PIECE_LIMIT?'full':projectedPieces>=75?'near':'available')}>
        <div className="production-capacity-head"><b>Capacidad para la fecha de entrega</b><span>{projectedPieces} / {DAILY_PIECE_LIMIT} piezas</span></div>
        <div className="capacity-track"><span style={{width:`${Math.min(100,(projectedPieces/DAILY_PIECE_LIMIT)*100)}%`}}/></div>
        <small>Ya programadas: {alreadyScheduled} · Este pedido: {qty} · Disponibles antes de cargarlo: {availablePieces}</small>
        {projectedPieces>DAILY_PIECE_LIMIT&&<strong>⚠ Se supera la capacidad diaria por {projectedPieces-DAILY_PIECE_LIMIT} piezas.</strong>}
      </div>}

      <div className="order-total production-totals">
        <div><small>Total de piezas</small><b>{qty}</b></div>
        <div><small>Caja sugerida</small><b className="packaging-value">{packaging.label}</b><span>Film negro + cinta</span></div>
        <div><small>Días necesarios</small><b>{productionDays}</b><span>Máximo {DAILY_PIECE_LIMIT} piezas por día</span></div>
        <div><small>Precio unitario</small><b>{money(pricePerUnit(qty))}</b></div>
        <div><small>Valor del pedido</small><b>{money(total)}</b></div>
      </div>
      <div className="actions"><button className="primary">{editing?'Guardar cambios':'Guardar pedido'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{localStorage.removeItem(DRAFT_KEY);clearEdit();setForm(blank());setDraftSaved(false)}}>Cancelar</button>}</div>
    </form>
  </>
}
