import React,{useMemo,useState} from 'react'
import {Title} from '../components/UI'
import {money,today} from '../lib/format'
import {upsertClientFromOrder} from '../lib/clients'
import {downloadQuoteJpg} from '../lib/quoteReceipt'
import {supabase} from '../supabase'

const active=q=>!['Aprobado','Cancelado'].includes(q.status)
const nextOrderNumber=orders=>String(Math.max(0,...(orders||[]).map(o=>Number(o.number)||0))+1).padStart(3,'0')
const phoneDigits=v=>String(v||'').replace(/\D/g,'')

export default function Quotes({db,onSave}){
 const [view,setView]=useState('pending')
 const quotes=db.quotes||[]
 const visible=useMemo(()=>quotes.filter(q=>view==='pending'?active(q):!active(q)).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))),[quotes,view])
 async function approve(q){
  if(!window.confirm(`¿El cliente aprobó ${q.code}? Se creará el pedido y comenzará a contar en producción e inventario.`))return
  const number=nextOrderNumber(db.orders)
  const order={...q,id:crypto.randomUUID(),number,date:today(),client:q.client||q.customer?.name||'',firstName:q.firstName||q.customer?.firstName||'',lastName:q.lastName||q.customer?.lastName||'',phone:q.phone||q.customer?.phone||'',dni:q.dni||q.customer?.dni||'',email:q.email||q.customer?.email||'',address:q.address||q.customer?.address||'',betweenStreets:q.betweenStreets||q.customer?.betweenStreets||'',locality:q.locality||q.customer?.locality||'',district:q.district||q.customer?.district||'',province:q.province||q.customer?.province||'',postalCode:q.postalCode||q.customer?.postalCode||'',deliveryType:q.deliveryType||q.customer?.method||'Logística',carrier:q.deliveryType||q.customer?.method||'Logística',agencyDelivery:q.agencyDelivery||q.customer?.agencyDelivery||'',status:'Ingresado',paid:'No',shippingCost:0,shippingPaid:'No corresponde',shippingPackaging:(q.deliveryType||q.customer?.method)==='Retiro en el local'?'No':'Sí',items:(q.items||[]).map(i=>({figure:i.figure||i.name,productId:i.productId||'',qty:Number(i.qty||0)})),quoteId:q.id,notes:[q.notes,`Presupuesto ${q.code} aprobado`].filter(Boolean).join(' · '),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  delete order.code;delete order.source;delete order.sourceId;delete order.customer;delete order.approvedAt
  const orders=[...(db.orders||[]),order]
  const clients=upsertClientFromOrder(db.clients||[],order)
  const updatedQuotes=quotes.map(x=>x.id===q.id?{...x,status:'Aprobado',approvedAt:new Date().toISOString(),orderNumber:number}:x)
  const saved=await onSave({...db,orders,clients,quotes:updatedQuotes})
  if(saved?.ok===false)return
  if(q.source==='Web'&&q.sourceId){
    const {error}=await supabase.from('web_requests').update({status:'Presupuesto aprobado'}).eq('id',q.sourceId)
    if(error)console.error('No se pudo actualizar la solicitud web',error)
  }
  alert(`Presupuesto aprobado. Se creó el pedido #${number}.`)
 }
 async function cancel(q){if(!window.confirm(`¿Cancelar ${q.code}?`))return;await onSave({...db,quotes:quotes.map(x=>x.id===q.id?{...x,status:'Cancelado',updatedAt:new Date().toISOString()}:x)})}
 function whatsapp(q){const phone=phoneDigits(q.phone||q.customer?.phone);if(!phone)return alert('Este presupuesto no tiene WhatsApp.');const normalized=phone.startsWith('54')?phone:`54${phone}`;const text=encodeURIComponent(`Hola ${q.firstName||q.customer?.firstName||q.client||''}, te enviamos el presupuesto ${q.code} por ${money(q.total)}. Si estás de acuerdo, respondé APROBADO y lo pasamos a producción.`);window.open(`https://wa.me/${normalized}?text=${text}`,'_blank','noopener,noreferrer')}
 return <>
  <Title title="Presupuestos" sub="Creá, enviá y aprobá presupuestos antes de que ingresen como pedidos."/>
  <div className="request-tabs"><button className={view==='pending'?'active':''} onClick={()=>setView('pending')}>Pendientes ({quotes.filter(active).length})</button><button className={view==='history'?'active':''} onClick={()=>setView('history')}>Historial</button></div>
  <div className="panel table-wrap"><table><thead><tr><th>Presupuesto</th><th>Cliente</th><th>Origen</th><th>Piezas</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visible.map(q=><tr key={q.id}><td><b>{q.code}</b><small className="block">{q.date||''}</small></td><td><b>{q.client||q.customer?.name||'Sin nombre'}</b><small className="block">{q.phone||q.customer?.phone||''}</small></td><td>{q.source||'Manual'}</td><td>{(q.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)}</td><td><b>{money(q.total)}</b></td><td><span className={`quote-status ${q.status==='Aprobado'?'approved':q.status==='Cancelado'?'cancelled':'pending'}`}>{q.status||'Pendiente'}</span></td><td><div className="request-actions"><button className="ghost" onClick={()=>downloadQuoteJpg(q)}>⬇ JPG</button>{active(q)&&<button className="whatsapp" onClick={()=>whatsapp(q)}>WhatsApp</button>}{active(q)&&<button className="primary" onClick={()=>approve(q)}>✓ Cliente aprobó → Pedido</button>}{active(q)&&<button className="danger" onClick={()=>cancel(q)}>Cancelar</button>}</div></td></tr>)}{!visible.length&&<tr><td colSpan="7">No hay presupuestos en esta sección.</td></tr>}</tbody></table></div>
 </>
}
