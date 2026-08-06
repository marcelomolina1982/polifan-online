import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../supabase'
import {Title} from '../components/UI'
import {money} from '../lib/format'
import {upsertClientFromOrder} from '../lib/clients'
import { estimateProductionAvailability, todayArgentinaISO } from '../lib/production'
import { downloadOrderReceiptJpg } from '../lib/orderReceipt'

const isPending = row => row.status === 'Pendiente de pago'

export default function WebRequests({db,onSave}){
 const [rows,setRows]=useState([])
 const [loading,setLoading]=useState(true)
 const [view,setView]=useState('pending')

 async function load(){
  setLoading(true)
  const {data,error}=await supabase.from('web_requests').select('*').order('created_at',{ascending:false})
  if(error) alert('No se pudieron cargar las solicitudes: '+error.message)
  else setRows(data||[])
  setLoading(false)
 }
 useEffect(()=>{load()},[])

 async function confirmRow(r){
  if(!window.confirm(`¿Confirmar el pago de ${r.code} y crear el pedido?`))return
  const next=String(Math.max(0,...db.orders.map(x=>Number(x.number)||0))+1).padStart(3,'0')
  const c=r.customer||{}
  const isPickup=(c.method||'Logística')==='Retiro en el local'
  let shippingCost=0,shippingPaid='No corresponde'
  if(!isPickup){
    const shippingInput=window.prompt('Costo de envío ya presupuestado (solo números):','0')
    if(shippingInput===null)return
    shippingCost=Math.max(0,Number(String(shippingInput).replace(/[^0-9.,]/g,'').replace(',','.'))||0)
    shippingPaid=window.confirm('¿El costo de envío ya está PAGADO?\nAceptar = Pagado · Cancelar = Pendiente de pago')?'Pagado':'Pendiente de pago'
  }
  const recalculatedEstimate=!r.estimated_from?estimateProductionAvailability(db.orders||[],Number(r.quantity||0),db.productionClosedDates||[]):null
  const resolvedDelivery=r.estimated_from||recalculatedEstimate?.productionDate||''
  const order={id:crypto.randomUUID(),number:next,date:todayArgentinaISO(),delivery:resolvedDelivery,firstName:c.firstName||String(c.name||'').trim().split(/\s+/)[0]||'',lastName:c.lastName||String(c.name||'').trim().split(/\s+/).slice(1).join(' '),client:c.name||[c.firstName,c.lastName].filter(Boolean).join(' '),phone:c.phone||'',dni:c.dni||'',email:c.email||'',address:c.address||'',betweenStreets:c.betweenStreets||'',locality:c.locality||'',district:c.district||'',province:c.province||'',postalCode:c.postalCode||'',zone:[c.locality,c.province].filter(Boolean).join(' · '),deliveryType:c.method||'Logística',carrier:c.method||'Logística',agencyDelivery:c.agencyDelivery||'',priority:'Normal',status:'Ingresado',paid:'Sí',shippingPackaging:c.method==='Retiro en el local'?'No':'Sí',shippingCost,shippingPaid,items:(r.items||[]).map(i=>({figure:i.name,productId:i.productId||'',qty:Number(i.qty||0)})),total:Number(r.estimated_total||0),notes:[r.notes,`Solicitud ${r.code}`].filter(Boolean).join(' · '),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  const orders=[...db.orders,order]
  const clients=upsertClientFromOrder(db.clients||[],order)
  await onSave({...db,orders,clients})
  try{ await downloadOrderReceiptJpg(order) }catch(err){ console.error('No se pudo generar el comprobante JPG',err) }
  const {error}=await supabase.from('web_requests').update({status:'Pago confirmado'}).eq('id',r.id)
  if(error){alert('El pedido se creó, pero no se pudo actualizar la solicitud: '+error.message);return}
  setRows(current=>current.map(item=>item.id===r.id?{...item,status:'Pago confirmado'}:item))
  alert(`Pedido #${next} creado.`)
 }

 async function removeRow(r){
  if(!window.confirm(`¿Eliminar la solicitud ${r.code}? Esta acción la quitará de pendientes.`))return
  const {error}=await supabase.from('web_requests').update({status:'Eliminada'}).eq('id',r.id)
  if(error){alert('No se pudo eliminar la solicitud: '+error.message);return}
  setRows(current=>current.map(item=>item.id===r.id?{...item,status:'Eliminada'}:item))
 }

 const visible=useMemo(()=>view==='pending'?rows.filter(isPending):rows.filter(row=>!isPending(row)),[rows,view])
 const pendingCount=rows.filter(isPending).length

 return <>
  <Title title="Solicitudes web" sub="Las aprobadas y eliminadas salen automáticamente de la lista de pendientes."/>
  <div className="request-tabs">
   <button className={view==='pending'?'active':''} onClick={()=>setView('pending')}>Pendientes ({pendingCount})</button>
   <button className={view==='history'?'active':''} onClick={()=>setView('history')}>Historial</button>
  </div>
  <div className="panel table-wrap"><table><thead><tr><th>Código</th><th>Cliente</th><th>Piezas</th><th>Entrega estimada</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><b>{r.code}</b><small className="block">{r.created_at?new Date(r.created_at).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'}):''}</small></td><td>{r.customer?.name}<small className="block">{r.customer?.phone}</small></td><td>{r.quantity}</td><td>{r.customer?.estimatedDeliveryStart||r.estimated_from?<>{r.customer?.estimatedDeliveryStart||r.estimated_from} a {r.customer?.estimatedDeliveryEnd||r.estimated_to||r.customer?.estimatedDeliveryStart||r.estimated_from}</>:<b>Fecha a confirmar</b>}</td><td>{money(r.estimated_total)}</td><td>{r.status}</td><td><div className="request-actions">{isPending(r)&&<button className="primary" onClick={()=>confirmRow(r)}>Confirmar pago y crear pedido</button>}{isPending(r)&&<button className="danger" onClick={()=>removeRow(r)}>Eliminar</button>}</div></td></tr>)}</tbody></table>{loading&&<p>Cargando…</p>}{!loading&&!visible.length&&<p>{view==='pending'?'No hay solicitudes pendientes.':'Todavía no hay solicitudes en el historial.'}</p>}</div>
 </>
}
