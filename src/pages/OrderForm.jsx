import React, { useEffect, useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { statusColors } from '../lib/constants'
import { money, pricePerUnit, today } from '../lib/format'
import { DAILY_PIECE_LIMIT, daysForPieces, piecesScheduledForDate, sheetsForPieces, isSunday } from '../lib/production'
import { packagingForPieces } from '../lib/packaging'
import { upsertClientFromOrder } from '../lib/clients'
import { downloadOrderReceiptJpg } from '../lib/orderReceipt'
import { downloadQuoteJpg } from '../lib/quoteReceipt'

export default function OrderForm({db,onSave,editing,clearEdit}){
  const DRAFT_KEY='polifan-order-draft-v1'
  const nextOrderNumber=(orders=db.orders)=>String(Math.max(0,...(orders||[]).map(o=>Number(o.number)||0))+1).padStart(3,'0')
  const blank=()=>({
    id:crypto.randomUUID(),number:nextOrderNumber(),date:today(),firstName:'',lastName:'',client:'',phone:'',dni:'',email:'',address:'',betweenStreets:'',locality:'',district:'',province:'',postalCode:'',zone:'',
    deliveryType:'Logística GBA/CABA',carrier:'Logística GBA/CABA',agencyDelivery:'Envío a domicilio',delivery:'',priority:'Normal',status:'Ingresado',paid:'Sí',shippingCost:'',shippingPaid:'Pendiente de pago',shippingPackaging:'No',notes:'',
    items:[{figure:'',qty:1,inventoryTracked:true}],manualItems:[]
  })
  const [form,setForm]=useState(()=>{try{const saved=localStorage.getItem(DRAFT_KEY);if(!saved)return blank();const draft=JSON.parse(saved);return {...blank(),...draft,number:nextOrderNumber()}}catch{return blank()}})
  const [draftSaved,setDraftSaved]=useState(false)
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])

  useEffect(()=>{
    if(!editing)return
    const copy=JSON.parse(JSON.stringify(editing))
    const legacy=String(copy.deliveryType||copy.carrier||'').toLocaleLowerCase('es')
    copy.deliveryType=legacy.includes('retiro')?'Retiro en el local':legacy.includes('via cargo')||legacy.includes('vía cargo')?'Vía Cargo':legacy.includes('otro')?'Otro expreso':'Logística GBA/CABA'
    const regular=(copy.items||[]).filter(i=>i.inventoryTracked!==false&&!i.manualItem)
    const manual=(copy.items||[]).filter(i=>i.inventoryTracked===false||i.manualItem).map(i=>({...i,unitPrice:Number(i.unitPrice||i.price||0)}))
    setForm({...blank(),...copy,items:regular.length?regular:[{figure:'',qty:1,inventoryTracked:true}],manualItems:manual,firstName:copy.firstName||String(copy.client||'').trim().split(/\s+/)[0]||'',lastName:copy.lastName||String(copy.client||'').trim().split(/\s+/).slice(1).join(' ')})
    setDraftSaved(false)
  },[editing])

  useEffect(()=>{const timer=setTimeout(()=>{try{localStorage.setItem(DRAFT_KEY,JSON.stringify(form));setDraftSaved(true)}catch{}},400);return()=>clearTimeout(timer)},[form])

  const regularItems=(form.items||[]).filter(i=>i.figure&&Number(i.qty)>0)
  const qty=regularItems.reduce((a,i)=>a+Number(i.qty||0),0)
  const regularTotal=qty*pricePerUnit(qty)
  const validManualItems=(form.manualItems||[]).filter(i=>String(i.figure||'').trim()&&Number(i.qty)>0&&Number(i.unitPrice)>=0)
  const manualQty=validManualItems.reduce((a,i)=>a+Number(i.qty||0),0)
  const manualTotal=validManualItems.reduce((a,i)=>a+Number(i.qty||0)*Number(i.unitPrice||0),0)
  const total=regularTotal+manualTotal
  const alreadyScheduled=piecesScheduledForDate(db.orders,form.delivery,editing?.id||null)
  const projectedPieces=alreadyScheduled+qty
  const availablePieces=Math.max(0,DAILY_PIECE_LIMIT-alreadyScheduled)
  const sheets=sheetsForPieces(qty)
  const productionDays=daysForPieces(qty)
  const packaging=packagingForPieces(qty)
  const deliveryType=form.deliveryType||'Logística GBA/CABA'

  const matchingClients=useMemo(()=>{
    const term=String(form.phone||form.firstName||form.lastName||form.client||'').trim().toLowerCase();if(term.length<3)return[]
    const source=[...(db.clients||[]),...(db.orders||[]).map(o=>({name:o.client,firstName:o.firstName,lastName:o.lastName,phone:o.phone,dni:o.dni,email:o.email,address:o.address,betweenStreets:o.betweenStreets,locality:o.locality,district:o.district,province:o.province,postalCode:o.postalCode}))]
    const seen=new Set();return source.filter(c=>{const key=String(c.phone||c.name||'').toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return`${c.name||''} ${c.phone||''}`.toLowerCase().includes(term)}).slice(0,5)
  },[db.clients,db.orders,form.phone,form.firstName,form.lastName])
  function useClient(c){const full=c.name||[c.firstName,c.lastName].filter(Boolean).join(' ');setForm(f=>({...f,firstName:c.firstName||String(full||'').trim().split(/\s+/)[0]||f.firstName,lastName:c.lastName||String(full||'').trim().split(/\s+/).slice(1).join(' ')||f.lastName,client:full||f.client,phone:c.phone||f.phone,dni:c.dni||f.dni,email:c.email||f.email,address:c.address||f.address,betweenStreets:c.betweenStreets||f.betweenStreets,locality:c.locality||f.locality,district:c.district||f.district,province:c.province||f.province,postalCode:c.postalCode||f.postalCode}))}
  function updateItem(ix,key,val){setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:val}:it)}))}
  function updateManual(ix,key,val){setForm(f=>({...f,manualItems:(f.manualItems||[]).map((it,i)=>i===ix?{...it,[key]:val}:it)}))}

  function nextQuoteCode(){const max=Math.max(0,...(db.quotes||[]).map(q=>Number(String(q.code||'').match(/\d+$/)?.[0]||0)));return`PRES-${String(max+1).padStart(4,'0')}`}
  function combinedItems(){
    const regular=regularItems.map(i=>({...i,qty:Number(i.qty),unitPrice:pricePerUnit(qty),inventoryTracked:true,manualItem:false}))
    const manual=validManualItems.map(i=>({figure:String(i.figure).trim(),qty:Number(i.qty),unitPrice:Number(i.unitPrice),subtotal:Number(i.qty)*Number(i.unitPrice),inventoryTracked:false,manualItem:true}))
    return [...regular,...manual]
  }
  async function saveQuote(){
    if(!form.firstName?.trim())return alert('Ingresá el nombre del cliente.')
    if(!form.lastName?.trim())return alert('Ingresá el apellido del cliente.')
    if(!form.phone?.trim())return alert('Ingresá el teléfono del cliente.')
    if(!regularItems.length&&!validManualItems.length)return alert('Agregá al menos una figura o un producto manual.')
    const fullName=[form.firstName,form.lastName].filter(Boolean).join(' ').trim(),code=nextQuoteCode()
    const quotedShipping=deliveryType==='Retiro en el local'?0:Math.max(0,Number(form.shippingCost||0)||0)
    const quote={...form,id:crypto.randomUUID(),code,source:'Manual',status:'Pendiente',client:fullName,total,items:combinedItems(),date:today(),deliveryType,carrier:deliveryType,shippingCost:quotedShipping,shippingPaid:deliveryType==='Retiro en el local'?'No corresponde':(form.shippingPaid||'Pendiente de pago'),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
    const saved=await onSave({...db,quotes:[...(db.quotes||[]),quote]});if(saved?.ok===false)return
    try{await downloadQuoteJpg(quote)}catch(err){console.error(err)}
    localStorage.removeItem(DRAFT_KEY);setForm({...blank(),number:nextOrderNumber(db.orders)});setDraftSaved(false);clearEdit();alert(`${code} guardado. Podés aprobarlo desde VENTAS → Presupuestos.`)
  }

  async function submit(e){
    e.preventDefault()
    if(!form.firstName?.trim())return alert('Ingresá el nombre del cliente.')
    if(!form.lastName?.trim())return alert('Ingresá el apellido del cliente.')
    if(!form.phone.trim())return alert('Ingresá el teléfono del cliente.')
    if(deliveryType==='Logística GBA/CABA'){
      if(!form.address?.trim())return alert('Ingresá el domicilio.');if(!form.betweenStreets?.trim())return alert('Ingresá las entre calles.');if(!form.locality?.trim())return alert('Ingresá la localidad.');if(!form.district?.trim())return alert('Ingresá el partido o departamento.');if(!form.province?.trim())return alert('Ingresá la provincia.');if(!form.postalCode?.trim())return alert('Ingresá el código postal.');if(!form.email?.trim())return alert('Ingresá el correo electrónico.')
    }
    if(deliveryType==='Vía Cargo'||deliveryType==='Otro expreso'){
      if(deliveryType==='Vía Cargo'&&!form.dni?.trim())return alert('Ingresá el DNI.');if(!form.address?.trim())return alert('Ingresá el domicilio.');if(!form.locality?.trim())return alert('Ingresá la localidad.');if(!form.district?.trim())return alert('Ingresá el partido o departamento.');if(!form.province?.trim())return alert('Ingresá la provincia.');if(!form.postalCode?.trim())return alert('Ingresá el código postal.');if(!form.email?.trim())return alert('Ingresá el correo electrónico.')
    }
    if(!regularItems.length&&!validManualItems.length)return alert('Agregá al menos una figura o un producto manual.')
    if(form.delivery&&isSunday(form.delivery))return alert('Los domingos no se cuentan como días de producción. Elegí otra fecha de entrega.')
    if(qty>0&&form.delivery&&projectedPieces>=DAILY_PIECE_LIMIT){const excess=Math.max(0,projectedPieces-DAILY_PIECE_LIMIT);const message=projectedPieces===DAILY_PIECE_LIMIT?`Ese día llegará exactamente a ${DAILY_PIECE_LIMIT} piezas. ¿Querés guardar el pedido igualmente?`:`Ese día pasará a ${projectedPieces} piezas, superando el límite por ${excess}. ¿Querés seguir?`;if(!window.confirm(message))return}
    const automaticNumber=editing?form.number:nextOrderNumber(db.orders),fullName=[form.firstName,form.lastName].filter(Boolean).join(' ').trim()
    const final={...form,...(deliveryType==='Retiro en el local'?{address:'',betweenStreets:'',locality:'',district:'',province:'',postalCode:'',agencyDelivery:'',shippingCost:0,shippingPaid:'No corresponde',shippingPackaging:'No'}:{}),deliveryType,carrier:deliveryType,client:fullName,zone:deliveryType==='Retiro en el local'?'Retiro en el local':[form.locality,form.district,form.province].filter(Boolean).join(' · '),number:automaticNumber,total,unitPrice:qty?pricePerUnit(qty):null,productionSheets:sheets,productionDays,items:combinedItems(),manualItems:undefined,updatedAt:new Date().toISOString()}
    const orders=editing?db.orders.map(o=>o.id===final.id?final:o):[...db.orders,{...final,createdAt:new Date().toISOString()}]
    const clients=upsertClientFromOrder(db.clients||[],final)
    const saved=await onSave({...db,orders,clients});if(saved?.ok===false)return
    if(!editing){try{await downloadOrderReceiptJpg(final)}catch(err){console.error(err)}}
    localStorage.removeItem(DRAFT_KEY);setForm({...blank(),number:nextOrderNumber(orders)});setDraftSaved(false);clearEdit();alert(editing?'Pedido actualizado.':'Pedido guardado.')
  }

  return <>
    <Title title={editing?'Editar pedido':'Nuevo pedido'} sub="Figuras, productos manuales, despacho y datos del cliente en un solo lugar." actions={<span className="draft-status">{draftSaved?'Borrador guardado automáticamente':'Guardando borrador…'}</span>}/>
    <form className="panel" onSubmit={submit}>
      <h3>Datos del pedido y despacho</h3>
      <div className="form-grid">
        <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
        <Field label="Nº de pedido (automático)"><input value={form.number} readOnly/></Field>
        <Field label="Nombre"><input value={form.firstName||''} onChange={e=>setForm({...form,firstName:e.target.value,client:[e.target.value,form.lastName].filter(Boolean).join(' ')})}/></Field>
        <Field label="Apellido"><input value={form.lastName||''} onChange={e=>setForm({...form,lastName:e.target.value,client:[form.firstName,e.target.value].filter(Boolean).join(' ')})}/></Field>
        <Field label="Teléfono"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
        <Field label="¿Cómo se despacha?"><select value={deliveryType} onChange={e=>{const type=e.target.value;setForm({...form,deliveryType:type,carrier:type,...(type==='Retiro en el local'?{agencyDelivery:'',shippingCost:'',shippingPaid:'No corresponde',shippingPackaging:'No'}:{})})}}><option>Logística GBA/CABA</option><option>Retiro en el local</option><option>Vía Cargo</option><option>Otro expreso</option></select></Field>
        <Field label={deliveryType==='Vía Cargo'?'DNI *':'DNI (opcional)'}><input inputMode="numeric" value={form.dni||''} onChange={e=>setForm({...form,dni:e.target.value.replace(/\D/g,'')})}/></Field>
        <Field label="Correo electrónico"><input type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})}/></Field>
        {matchingClients.length>0&&<div className="client-autofill"><small>Clientes encontrados</small>{matchingClients.map((c,i)=><button type="button" key={(c.phone||c.name)+i} onClick={()=>useClient(c)}><b>{c.name}</b><span>{c.phone||'Sin teléfono'}</span></button>)}</div>}
        {deliveryType!=='Retiro en el local'&&<><Field label="Domicilio"><input value={form.address||''} onChange={e=>setForm({...form,address:e.target.value})}/></Field>{deliveryType==='Logística GBA/CABA'&&<Field label="Entre calles"><input value={form.betweenStreets||''} onChange={e=>setForm({...form,betweenStreets:e.target.value})}/></Field>}<Field label="Localidad"><input value={form.locality||''} onChange={e=>setForm({...form,locality:e.target.value})}/></Field><Field label="Partido / Departamento"><input value={form.district||''} onChange={e=>setForm({...form,district:e.target.value})}/></Field><Field label="Provincia"><input value={form.province||''} onChange={e=>setForm({...form,province:e.target.value})}/></Field><Field label="Código postal"><input value={form.postalCode||''} onChange={e=>setForm({...form,postalCode:e.target.value.replace(/[^0-9A-Za-z-]/g,'')})}/></Field></>}
        {deliveryType==='Vía Cargo'&&<Field label="Modalidad del envío"><select value={form.agencyDelivery||'Envío a domicilio'} onChange={e=>setForm({...form,agencyDelivery:e.target.value})}><option>Envío a domicilio</option><option>Retiro en agencia</option></select></Field>}
        <Field label="Fecha de entrega"><input type="date" value={form.delivery} onChange={e=>setForm({...form,delivery:e.target.value})}/></Field>
        <Field label="Prioridad"><select value={form.priority||'Normal'} onChange={e=>setForm({...form,priority:e.target.value})}><option>Normal</option><option>Urgente</option><option>Prioridad máxima</option></select></Field>
        <Field label="Estado"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select></Field>
        {deliveryType!=='Retiro en el local'&&<><Field label="Costo de envío"><input type="number" min="0" value={form.shippingCost||''} onChange={e=>setForm({...form,shippingCost:e.target.value})}/></Field><Field label="Estado del envío"><select value={form.shippingPaid||'Pendiente de pago'} onChange={e=>setForm({...form,shippingPaid:e.target.value})}><option>Pagado</option><option>Pendiente de pago</option></select></Field><Field label="¿Lleva embalaje de envío?"><select value={form.shippingPackaging||'No'} onChange={e=>setForm({...form,shippingPackaging:e.target.value})}><option>No</option><option>Sí</option></select></Field></>}
      </div>

      <h3>Figuras de polifán</h3>
      {(form.items||[]).map((it,ix)=><div className="item-row" key={ix}><input list={`fig-${ix}`} placeholder="🔍 Buscar figura" value={it.figure} onChange={e=>updateItem(ix,'figure',e.target.value)}/><datalist id={`fig-${ix}`}>{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist><input type="number" min="1" value={it.qty} onChange={e=>updateItem(ix,'qty',e.target.value)}/><button type="button" className="danger smallbtn" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,i)=>i!==ix)}))}>×</button></div>)}
      <button type="button" className="ghost" onClick={()=>setForm(f=>({...f,items:[...(f.items||[]),{figure:'',qty:1,inventoryTracked:true}]}))}>＋ Agregar figura</button>

      <div className="manual-items-box">
        <h3>Productos / trabajos manuales</h3><p>Para agregar cualquier otro producto o trabajo con un precio que vos definís. No descuenta stock ni suma piezas a producción.</p>
        {(form.manualItems||[]).map((it,ix)=><div className="item-row manual-sale-row" key={ix}><input placeholder="Descripción" value={it.figure||''} onChange={e=>updateManual(ix,'figure',e.target.value)}/><input type="number" min="1" value={it.qty||1} onChange={e=>updateManual(ix,'qty',e.target.value)}/><input type="number" min="0" placeholder="Precio unitario" value={it.unitPrice??''} onChange={e=>updateManual(ix,'unitPrice',e.target.value)}/><b>{money((Number(it.qty)||0)*(Number(it.unitPrice)||0))}</b><button type="button" className="danger smallbtn" onClick={()=>setForm(f=>({...f,manualItems:(f.manualItems||[]).filter((_,i)=>i!==ix)}))}>×</button></div>)}
        <button type="button" className="ghost" onClick={()=>setForm(f=>({...f,manualItems:[...(f.manualItems||[]),{figure:'',qty:1,unitPrice:'',inventoryTracked:false,manualItem:true}]}))}>＋ Agregar producto manual</button>
      </div>

      <Field label="Observaciones"><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
      {qty>0&&form.delivery&&<div className={'production-capacity '+(projectedPieces>DAILY_PIECE_LIMIT?'over':projectedPieces===DAILY_PIECE_LIMIT?'full':projectedPieces>=75?'near':'available')}><div className="production-capacity-head"><b>Capacidad para la fecha de entrega</b><span>{projectedPieces} / {DAILY_PIECE_LIMIT} piezas</span></div><div className="capacity-track"><span style={{width:`${Math.min(100,(projectedPieces/DAILY_PIECE_LIMIT)*100)}%`}}/></div><small>Ya programadas: {alreadyScheduled} · Este pedido: {qty} · Disponibles: {availablePieces}</small></div>}

      <div className="order-total production-totals">
        <div><small>Figuras de polifán</small><b>{qty}</b></div><div><small>Caja sugerida</small><b className="packaging-value">{qty?packaging.label:'Sin caja'}</b></div><div><small>Productos manuales</small><b>{manualQty}</b></div><div><small>Figuras</small><b>{money(regularTotal)}</b></div><div><small>Manual</small><b>{money(manualTotal)}</b></div><div><small>Valor productos</small><b>{money(total)}</b></div>{deliveryType==='Retiro en el local'?<div><small>Retiro</small><b>GRATIS</b></div>:<><div><small>Envío</small><b>{money(Number(form.shippingCost||0))}</b></div><div><small>Total final</small><b>{money(total+Number(form.shippingCost||0))}</b></div></>}
      </div>
      <div className="actions">{!editing&&<button type="button" className="ghost quote-button" onClick={saveQuote}>🧾 Guardar presupuesto + JPG</button>}<button className="primary">{editing?'Guardar cambios':'Guardar pedido'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{localStorage.removeItem(DRAFT_KEY);setForm({...blank(),number:nextOrderNumber(db.orders)});setDraftSaved(false);clearEdit()}}>Cancelar</button>}</div>
    </form>
  </>
}
