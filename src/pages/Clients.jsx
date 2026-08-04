import React, { useMemo, useState } from 'react'
import { Title, Field, Badge } from '../components/UI'
import { money } from '../lib/format'
import { importClientsFromOrders, upsertClient } from '../lib/clients'

export default function Clients({db,onSave}){
  const [q,setQ]=useState('')
  const blank={name:'',phone:'',dni:'',address:'',locality:'',province:'',postalCode:'',notes:''}
  const [form,setForm]=useState(blank)
  const [openId,setOpenId]=useState(null)
  const clients=db.clients||[]

  async function add(e){
    e.preventDefault()
    if(!form.name.trim()) return alert('Ingresá el nombre del cliente.')
    const next=upsertClient(clients,form)
    await onSave({...db,clients:next})
    setForm(blank)
    alert(next.length>clients.length?'Cliente guardado.':'Cliente actualizado sin duplicarlo.')
  }
  async function importHistory(){
    if(!db.orders?.length) return alert('Todavía no hay pedidos para importar.')
    const next=importClientsFromOrders(clients,db.orders)
    await onSave({...db,clients:next})
    alert(`Importación terminada. Ahora hay ${next.length} clientes registrados.`)
  }
  async function remove(id){if(confirm('¿Eliminar este cliente?'))await onSave({...db,clients:clients.filter(c=>c.id!==id)})}
  const list=clients.filter(c=>`${c.name} ${c.phone} ${c.dni||''} ${c.address||''} ${c.locality||c.zone||''} ${c.province||''} ${c.postalCode||''}`.toLowerCase().includes(q.toLowerCase()))
  function clientOrders(c){
    const phone=String(c.phone||'').replace(/\D/g,'')
    const dni=String(c.dni||'').replace(/\D/g,'')
    return db.orders.filter(o=>{
      const op=String(o.phone||'').replace(/\D/g,'')
      const od=String(o.dni||'').replace(/\D/g,'')
      return (phone&&op===phone)||(dni&&od===dni)||String(o.client||'').toLowerCase()===c.name.toLowerCase()
    }).slice().reverse()
  }
  function openWA(c){const n=String(c.phone||'').replace(/\D/g,'');window.open(`https://wa.me/${n}?text=${encodeURIComponent('Hola '+c.name+', te escribimos de Tu Vida En Tinta.')}`,'_blank')}
  const stats=useMemo(()=>({withOrders:clients.filter(c=>clientOrders(c).length).length,total:db.orders.filter(o=>o.status!=='Cancelado').reduce((a,o)=>a+Number(o.total||0),0)}),[clients,db.orders])
  function favorites(orders){const totals={};orders.forEach(o=>(o.items||[]).forEach(i=>{if(i.figure)totals[i.figure]=(totals[i.figure]||0)+Number(i.qty||0)}));return Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,3)}
  return <>
    <Title title="Historial de clientes" sub="Los pedidos nuevos y las solicitudes confirmadas actualizan esta agenda automáticamente." actions={<button className="primary" onClick={importHistory}>Importar clientes desde pedidos</button>}/>
    <div className="cards client-summary"><div className="kpi"><small>Clientes guardados</small><b>{clients.length}</b></div><div className="kpi"><small>Con pedidos</small><b>{stats.withOrders}</b></div><div className="kpi"><small>Ventas históricas</small><b>{money(stats.total)}</b></div></div>
    <form className="panel" onSubmit={add}><div className="form-grid">
      <Field label="Nombre"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
      <Field label="Teléfono"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
      <Field label="DNI (opcional)"><input inputMode="numeric" value={form.dni} onChange={e=>setForm({...form,dni:e.target.value.replace(/\D/g,'')})}/></Field>
      <Field label="Dirección"><input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></Field>
      <Field label="Localidad"><input value={form.locality} onChange={e=>setForm({...form,locality:e.target.value})}/></Field>
      <Field label="Provincia"><input value={form.province} onChange={e=>setForm({...form,province:e.target.value})}/></Field>
      <Field label="Código postal"><input value={form.postalCode} onChange={e=>setForm({...form,postalCode:e.target.value})}/></Field>
      <Field label="Observaciones"><input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
    </div><button className="primary">Guardar o actualizar cliente</button></form>
    <div className="panel filters"><input placeholder="Buscar por nombre, teléfono, DNI, localidad o CP…" value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="client-list">{list.map(c=>{const orders=clientOrders(c),valid=orders.filter(o=>o.status!=='Cancelado'),spent=valid.reduce((a,o)=>a+Number(o.total||0),0),pieces=valid.flatMap(o=>o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0),fav=favorites(valid),vip=valid.length>=5||spent>=200000,isOpen=openId===c.id;return <div className="panel client-card" key={c.id}><div className="client-card-head"><div><div className="client-name-row"><h3>{c.name}</h3>{vip&&<span className="vip-badge">★ CLIENTE FRECUENTE</span>}</div><p>{c.phone||'Sin teléfono'}{c.dni?` · DNI ${c.dni}`:''}</p><small>{c.address||'Sin dirección'} · {[c.locality||c.zone,c.province].filter(Boolean).join(', ')} · CP {c.postalCode||'-'}</small>{c.notes&&<small>{c.notes}</small>}</div><div className="client-metrics"><span><b>{orders.length}</b><small>pedidos</small></span><span><b>{pieces}</b><small>piezas</small></span><span><b>{money(spent)}</b><small>gastado</small></span></div><div className="row-actions">{c.phone&&<button className="whatsapp" onClick={()=>openWA(c)}>WhatsApp</button>}<button className="ghost" onClick={()=>setOpenId(isOpen?null:c.id)}>{isOpen?'Ocultar':'Ver historial'}</button><button className="danger" onClick={()=>remove(c.id)}>Eliminar</button></div></div>{isOpen&&<div className="client-history"><div className="favorite-box"><b>Figuras favoritas</b>{fav.length?<div>{fav.map(([name,qty])=><span key={name}>{name}: {qty}</span>)}</div>:<small>Sin datos todavía.</small>}</div><div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Fecha</th><th>Entrega</th><th>Piezas</th><th>Estado</th><th>Total</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>#{o.number}</td><td>{o.date||'-'}</td><td>{o.delivery||'-'}</td><td>{(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)}</td><td><Badge status={o.status}/></td><td>{money(o.total)}</td></tr>)}{!orders.length&&<tr><td colSpan="6">Todavía no tiene pedidos.</td></tr>}</tbody></table></div></div>}</div>})}{!list.length&&<div className="panel">No hay clientes cargados.</div>}</div>
  </>
}
