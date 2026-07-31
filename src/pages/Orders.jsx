import React, { useState } from 'react'
import { Title } from '../components/UI'
import { statusColors } from '../lib/constants'
import { money } from '../lib/format'

export default function Orders({db,onSave,onEdit}){
  const [q,setQ]=useState('')
  const [status,setStatus]=useState('')
  const list=db.orders.filter(o=>{
    const s=(o.client+' '+o.phone+' '+o.number+' '+(o.items||[]).map(i=>i.figure).join(' ')).toLowerCase()
    return s.includes(q.toLowerCase()) && (!status || o.status===status)
  }).slice().reverse()

  async function remove(id){
    if(confirm('¿Eliminar este pedido?')) await onSave({...db,orders:db.orders.filter(o=>o.id!==id)})
  }

  async function setStatusOrder(o,newStatus){
    await onSave({...db,orders:db.orders.map(x=>x.id===o.id?{...x,status:newStatus,updatedAt:new Date().toISOString()}:x)})
  }

  function openWhatsApp(o){
    const number=String(o.phone||'').replace(/\D/g,'')
    const text=`Hola ${o.client}, te escribimos de Tu Vida En Tinta por tu pedido N° ${o.number}. Estado actual: ${o.status}.`
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`,'_blank')
  }

  function printOrder(o){
    const items=(o.items||[]).map(i=>`<tr><td>${i.figure}</td><td>${i.qty}</td></tr>`).join('')
    const win=window.open('','_blank')
    win.document.write(`
      <html><head><title>Pedido ${o.number}</title>
      <style>body{font-family:Arial;padding:25px}h1{text-align:center}.box{border:2px solid #111;padding:18px}
      .grid{display:grid;grid-template-columns:160px 1fr}.grid div{padding:7px;border-bottom:1px solid #bbb}
      table{width:100%;border-collapse:collapse;margin-top:15px}th,td{border:1px solid #111;padding:9px;text-align:left}</style></head>
      <body><div class="box"><h1>TU VIDA EN TINTA · POLIFAN</h1>
      <div class="grid">
      <div><b>Pedido</b></div><div>#${o.number}</div>
      <div><b>Cliente</b></div><div>${o.client}</div>
      <div><b>Teléfono</b></div><div>${o.phone||'-'}</div>
      <div><b>Zona</b></div><div>${o.zone||'-'}</div>
      <div><b>Transporte</b></div><div>${o.carrier||'-'}</div>
      <div><b>Estado</b></div><div>${o.status}</div>
      </div>
      <table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>${items}</tbody></table>
      <p><b>Total:</b> ${money(o.total)}</p><p><b>Observaciones:</b> ${o.notes||'-'}</p></div>
      <script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  return <>
    <Title title="Pedidos" sub="Buscá, editá y actualizá el estado de cada pedido."/>
    <div className="panel filters">
      <input placeholder="Buscar cliente, teléfono, número o figura…" value={q} onChange={e=>setQ(e.target.value)}/>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select>
    </div>
    <div className="panel table-wrap"><table><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Piezas</th><th>Estado</th><th>Total</th><th>Acciones</th></tr></thead>
      <tbody>{list.map(o=><tr key={o.id}><td>#{o.number}</td><td>{o.date}</td><td><b>{o.client}</b><small className="block">{o.phone}</small></td>
        <td>{(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)}</td>
        <td><select value={o.status} onChange={e=>setStatusOrder(o,e.target.value)}>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select></td>
        <td>{money(o.total)}</td><td className="row-actions">
          <button className="ghost" onClick={()=>printOrder(o)}>Imprimir</button>
          {o.phone&&<button className="whatsapp" onClick={()=>openWhatsApp(o)}>WhatsApp</button>}
          <button className="ghost" onClick={()=>onEdit(o)}>Editar</button>
          <button className="danger" onClick={()=>remove(o.id)}>Eliminar</button>
        </td></tr>)}</tbody>
    </table></div>
  </>
}

