import React, { useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { today, money } from '../lib/format'
import { downloadOrderReceiptJpg } from '../lib/orderReceipt'

const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)
const nextOrderNumber=orders=>String(Math.max(0,...(orders||[]).map(o=>Number(o.number)||0))+1).padStart(3,'0')

export default function ManualSale({db,onSave}){
  const blank=()=>({firstName:'',lastName:'',dni:'',phone:'',email:'',address:'',betweenStreets:'',locality:'',district:'',province:'',postalCode:'',date:today(),delivery:today(),notes:'',items:[{figure:'',qty:1,unitPrice:''}]})
  const [form,setForm]=useState(blank())
  const [saving,setSaving]=useState(false)
  const total=useMemo(()=>form.items.reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.unitPrice)||0),0),[form.items])
  const qty=useMemo(()=>form.items.reduce((s,i)=>s+(Number(i.qty)||0),0),[form.items])
  const set=(key,value)=>setForm(f=>({...f,[key]:value}))
  function update(ix,key,value){setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:value}:it)}))}
  async function submit(e){
    e.preventDefault()
    const items=form.items.filter(i=>String(i.figure||'').trim()&&Number(i.qty)>0&&Number(i.unitPrice)>=0).map(i=>({figure:String(i.figure).trim(),qty:Number(i.qty),unitPrice:Number(i.unitPrice),subtotal:Number(i.qty)*Number(i.unitPrice),inventoryTracked:false,manualItem:true}))
    if(!form.firstName.trim())return alert('Ingresá el nombre del cliente.')
    if(!items.length)return alert('Agregá al menos un producto con cantidad y precio.')
    if(total<=0&&!confirm('El total de esta venta es $0. ¿Querés guardarla igualmente?'))return
    const number=nextOrderNumber(db.orders),client=[form.firstName,form.lastName].filter(Boolean).join(' ').trim()
    const order={id:uid(),number,date:form.date,delivery:form.delivery,firstName:form.firstName,lastName:form.lastName,client:client||'Consumidor final',phone:form.phone,dni:form.dni,email:form.email,address:form.address,betweenStreets:form.betweenStreets,locality:form.locality,district:form.district,province:form.province,postalCode:form.postalCode,zone:'Venta manual',deliveryType:'Venta manual',carrier:'Venta manual',agencyDelivery:'',priority:'Normal',status:'Entregado',paid:'Sí',shippingCost:0,shippingPaid:'No corresponde',shippingPackaging:'No',notes:form.notes||'',items,total,unitPrice:null,manualSale:true,inventoryTracked:false,skipProduction:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
    setSaving(true)
    try{const saved=await onSave({...db,orders:[...(db.orders||[]),order]});if(saved?.ok===false)return;try{await downloadOrderReceiptJpg(order)}catch(err){console.error(err)}setForm(blank());alert(`Venta manual #${number} guardada. El comprobante incluye cliente, productos y precios.`)}finally{setSaving(false)}
  }
  return <><Title title="Venta manual" sub="Venta fuera de inventario con datos completos del cliente y precio individual de cada producto."/><form className="panel" onSubmit={submit}>
    <div className="notice"><b>Fuera de inventario</b><span>Cuenta en facturación, pero no descuenta stock ni entra en producción.</span></div>
    <h3>Datos del cliente</h3><div className="form-grid">
      <Field label="Nombre"><input value={form.firstName} onChange={e=>set('firstName',e.target.value)}/></Field><Field label="Apellido"><input value={form.lastName} onChange={e=>set('lastName',e.target.value)}/></Field><Field label="DNI"><input value={form.dni} onChange={e=>set('dni',e.target.value.replace(/\D/g,''))}/></Field><Field label="Teléfono"><input value={form.phone} onChange={e=>set('phone',e.target.value)}/></Field><Field label="Email"><input type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></Field><Field label="Fecha"><input type="date" value={form.date} onChange={e=>{set('date',e.target.value);set('delivery',e.target.value)}}/></Field>
      <Field label="Domicilio"><input value={form.address} onChange={e=>set('address',e.target.value)}/></Field><Field label="Entre calles"><input value={form.betweenStreets} onChange={e=>set('betweenStreets',e.target.value)}/></Field><Field label="Localidad"><input value={form.locality} onChange={e=>set('locality',e.target.value)}/></Field><Field label="Partido / Departamento"><input value={form.district} onChange={e=>set('district',e.target.value)}/></Field><Field label="Provincia"><input value={form.province} onChange={e=>set('province',e.target.value)}/></Field><Field label="Código postal"><input value={form.postalCode} onChange={e=>set('postalCode',e.target.value)}/></Field>
    </div><h3>Productos / trabajos</h3>
    {form.items.map((it,ix)=><div className="item-row manual-sale-row" key={ix}><input placeholder="Descripción" value={it.figure} onChange={e=>update(ix,'figure',e.target.value)}/><input type="number" min="1" step="1" placeholder="Cantidad" value={it.qty} onChange={e=>update(ix,'qty',e.target.value)}/><input type="number" min="0" step="1" placeholder="Precio unitario" value={it.unitPrice} onChange={e=>update(ix,'unitPrice',e.target.value)}/><b>{money((Number(it.qty)||0)*(Number(it.unitPrice)||0))}</b><button type="button" className="danger smallbtn" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,i)=>i!==ix)}))}>×</button></div>)}
    <button type="button" className="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{figure:'',qty:1,unitPrice:''}]}))}>＋ Agregar producto</button><Field label="Notas"><textarea value={form.notes} onChange={e=>set('notes',e.target.value)}/></Field><div className="manual-sale-total"><span>{qty} unidad(es)</span><strong>Total: {money(total)}</strong></div><div className="actions"><button className="primary" disabled={saving}>{saving?'Guardando…':'Guardar venta + generar kit'}</button></div>
  </form></>
}
