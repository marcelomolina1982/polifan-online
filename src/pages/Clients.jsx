import React, { useMemo, useState } from 'react'
import { Title, Field, Badge } from '../components/UI'
import { money } from '../lib/format'

export default function Clients({db,onSave}){
  const [q,setQ]=useState('')
  const [form,setForm]=useState({name:'',phone:'',zone:'',notes:''})
  const [openId,setOpenId]=useState(null)
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
  function clientOrders(c){
    return db.orders.filter(o=>(c.phone&&o.phone===c.phone)||String(o.client||'').toLowerCase()===c.name.toLowerCase()).slice().reverse()
  }
  function openWA(c){
    const n=String(c.phone||'').replace(/\D/g,'')
    window.open(`https://wa.me/${n}?text=${encodeURIComponent('Hola '+c.name+', te escribimos de Tu Vida En Tinta.')}`,'_blank')
  }

  const globalStats=useMemo(()=>{
    const uniqueWithOrders=clients.filter(c=>clientOrders(c).length).length
    const totalSpent=db.orders.filter(o=>o.status!=='Cancelado').reduce((a,o)=>a+Number(o.total||0),0)
    return {uniqueWithOrders,totalSpent}
  },[clients,db.orders])

  function favoriteFigures(orders){
    const totals={}
    orders.forEach(o=>(o.items||[]).forEach(i=>{if(i.figure) totals[i.figure]=(totals[i.figure]||0)+Number(i.qty||0)}))
    return Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,3)
  }

  return <>
    <Title title="Clientes" sub="Datos, historial de pedidos, gasto total y productos favoritos."/>
    <div className="cards client-summary">
      <div className="kpi"><small>Clientes guardados</small><b>{clients.length}</b></div>
      <div className="kpi"><small>Clientes con pedidos</small><b>{globalStats.uniqueWithOrders}</b></div>
      <div className="kpi"><small>Ventas históricas</small><b>{money(globalStats.totalSpent)}</b></div>
    </div>
    <form className="panel" onSubmit={add}>
      <div className="form-grid">
        <Field label="Nombre"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
        <Field label="Teléfono"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
        <Field label="Zona"><input value={form.zone} onChange={e=>setForm({...form,zone:e.target.value})}/></Field>
        <Field label="Observaciones"><input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
      </div>
      <button className="primary">Guardar cliente</button>
    </form>
    <div className="panel filters"><input placeholder="Buscar cliente, teléfono o zona…" value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="client-list">{list.map(c=>{
      const orders=clientOrders(c)
      const valid=orders.filter(o=>o.status!=='Cancelado')
      const spent=valid.reduce((a,o)=>a+Number(o.total||0),0)
      const pieces=valid.flatMap(o=>o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
      const favorites=favoriteFigures(valid)
      const isOpen=openId===c.id
      return <div className="panel client-card" key={c.id}>
        <div className="client-card-head">
          <div><h3>{c.name}</h3><p>{c.phone||'Sin teléfono'} · {c.zone||'Sin zona'}</p>{c.notes&&<small>{c.notes}</small>}</div>
          <div className="client-metrics"><span><b>{orders.length}</b><small>pedidos</small></span><span><b>{pieces}</b><small>piezas</small></span><span><b>{money(spent)}</b><small>gastado</small></span></div>
          <div className="row-actions">{c.phone&&<button className="whatsapp" onClick={()=>openWA(c)}>WhatsApp</button>}<button className="ghost" onClick={()=>setOpenId(isOpen?null:c.id)}>{isOpen?'Ocultar historial':'Ver historial'}</button><button className="danger" onClick={()=>remove(c.id)}>Eliminar</button></div>
        </div>
        {isOpen&&<div className="client-history">
          <div className="favorite-box"><b>Figuras más pedidas</b>{favorites.length?<div>{favorites.map(([name,qty])=><span key={name}>{name}: {qty}</span>)}</div>:<small>Todavía no hay figuras registradas.</small>}</div>
          <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Fecha</th><th>Entrega</th><th>Piezas</th><th>Estado</th><th>Total</th></tr></thead><tbody>
          {orders.map(o=><tr key={o.id}><td>#{o.number}</td><td>{o.date||'-'}</td><td>{o.delivery||'-'}</td><td>{(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)}</td><td><Badge status={o.status}/></td><td>{money(o.total)}</td></tr>)}
          {!orders.length&&<tr><td colSpan="6">Este cliente todavía no tiene pedidos.</td></tr>}
          </tbody></table></div>
        </div>}
      </div>
    })}{!list.length&&<div className="panel">No hay clientes cargados.</div>}</div>
  </>
}
