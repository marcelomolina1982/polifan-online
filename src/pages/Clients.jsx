import React, { useState } from 'react'
import { Title, Field } from '../components/UI'

export default function Clients({db,onSave}){
  const [q,setQ]=useState('')
  const [form,setForm]=useState({name:'',phone:'',zone:'',notes:''})
  const clients=db.clients||[]

  async function add(e){
    e.preventDefault()
    if(!form.name.trim())return
    const existing=clients.find(c=>c.phone&&form.phone&&c.phone===form.phone)
    if(existing)return alert('Ya existe un cliente con ese teléfono.')
    await onSave({...db,clients:[...clients,{...form,id:crypto.randomUUID(),createdAt:new Date().toISOString()}]})
    setForm({name:'',phone:'',zone:'',notes:''})
  }

  async function remove(id){
    if(confirm('¿Eliminar este cliente?')) await onSave({...db,clients:clients.filter(c=>c.id!==id)})
  }

  const list=clients.filter(c=>(c.name+' '+c.phone+' '+c.zone).toLowerCase().includes(q.toLowerCase()))
  function ordersCount(c){return db.orders.filter(o=>(c.phone&&o.phone===c.phone)||o.client.toLowerCase()===c.name.toLowerCase()).length}
  function openWA(c){
    const n=String(c.phone||'').replace(/\D/g,'')
    window.open(`https://wa.me/${n}?text=${encodeURIComponent('Hola '+c.name+', te escribimos de Tu Vida En Tinta.')}`,'_blank')
  }

  return <>
    <Title title="Clientes" sub="Guardá sus datos y consultá cuántos pedidos realizó cada uno."/>
    <form className="panel" onSubmit={add}>
      <div className="form-grid">
        <Field label="Nombre"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
        <Field label="Teléfono"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
        <Field label="Zona"><input value={form.zone} onChange={e=>setForm({...form,zone:e.target.value})}/></Field>
        <Field label="Observaciones"><input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
      </div>
      <button className="primary">Guardar cliente</button>
    </form>
    <div className="panel filters"><input placeholder="Buscar cliente…" value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="panel table-wrap"><table><thead><tr><th>Cliente</th><th>Teléfono</th><th>Zona</th><th>Pedidos</th><th>Acciones</th></tr></thead>
    <tbody>{list.map(c=><tr key={c.id}><td><b>{c.name}</b><small className="block">{c.notes}</small></td><td>{c.phone||'-'}</td><td>{c.zone||'-'}</td><td>{ordersCount(c)}</td>
    <td className="row-actions">{c.phone&&<button className="whatsapp" onClick={()=>openWA(c)}>WhatsApp</button>}<button className="danger" onClick={()=>remove(c.id)}>Eliminar</button></td></tr>)}
    {!list.length&&<tr><td colSpan="5">No hay clientes cargados.</td></tr>}</tbody></table></div>
  </>
}

