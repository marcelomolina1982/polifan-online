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
    const esc=(value)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))
    const items=(o.items||[]).map(i=>`<tr><td>${esc(i.figure)}</td><td>${Number(i.qty||0)}</td></tr>`).join('')
    const delivery=o.delivery ? (()=>{const [y,m,d]=o.delivery.split('-');return `${d}/${m}/${y}`})() : 'SIN FECHA'
    const win=window.open('','_blank')
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${esc(o.number)}</title>
      <style>
      @page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;color:#111;display:flex;justify-content:center}.ticket{width:92mm;border:1.5px solid #111;padding:8mm 6mm;font-size:11px}.brand{text-align:center;font-size:16px;font-weight:800;margin:0 0 7px}.delivery{text-align:center;border-top:1px solid #bbb;border-bottom:1px solid #bbb;padding:6px 0;margin-bottom:7px}.delivery small{display:block;font-weight:800;font-size:10px}.delivery strong{display:block;font-size:24px;line-height:1.05;margin-top:2px}.order-number{text-align:center;background:#111;color:#fff;padding:4px;font-size:15px;font-weight:800;margin-bottom:8px}.grid{display:grid;grid-template-columns:29mm 1fr}.grid div{padding:3px 2px;border-bottom:1px solid #ccc;min-height:19px}.grid b{font-size:10px}table{width:100%;border-collapse:collapse;margin-top:9px}th,td{border:1px solid #111;padding:5px;text-align:left}th:last-child,td:last-child{width:28%;text-align:center}.total{font-size:13px;margin:9px 0 4px}.notes{margin:4px 0;min-height:22px}.footer{text-align:center;border-top:1px dashed #555;margin-top:10px;padding-top:7px;font-size:10px;font-style:italic}@media print{body{display:block}.ticket{margin:0 auto;break-inside:avoid}}
      </style></head><body><article class="ticket"><div class="brand">TU VIDA EN TINTA · POLIFAN</div>
      <div class="delivery"><small>FECHA DE ENTREGA</small><strong>${delivery}</strong></div>
      <div class="order-number">PEDIDO #${esc(o.number)}</div>
      <div class="grid">
      <div><b>Cliente</b></div><div>${esc(o.client)}</div>
      <div><b>Teléfono</b></div><div>${esc(o.phone||'-')}</div>
      <div><b>Zona</b></div><div>${esc(o.zone||'-')}</div>
      <div><b>Transporte</b></div><div>${esc(o.carrier||'-')}</div>
      <div><b>Estado</b></div><div>${esc(o.status)}</div>
      </div>
      <table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>${items}</tbody></table>
      <p class="total"><b>Total:</b> ${money(o.total)}</p><p class="notes"><b>Observaciones:</b> ${esc(o.notes||'-')}</p><div class="footer">¡Gracias por tu compra!</div></article>
      <script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  return <>
    <Title title="Pedidos" sub="Buscá, editá y actualizá el estado de cada pedido."/>
    <div className="panel filters">
      <input placeholder="Buscar cliente, teléfono, número o figura…" value={q} onChange={e=>setQ(e.target.value)}/>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select>
    </div>
    <div className="panel table-wrap"><table><thead><tr><th>Pedido</th><th>Entrega</th><th>Cliente</th><th>Piezas</th><th>Estado</th><th>Total</th><th>Acciones</th></tr></thead>
      <tbody>{list.map(o=><tr key={o.id}><td>#{o.number}</td><td><b>{o.delivery||'Sin fecha'}</b></td><td><b>{o.client}</b><small className="block">{o.phone}</small></td>
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

