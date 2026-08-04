import React,{useEffect,useState} from 'react'
import {supabase} from '../supabase'
import {Title} from '../components/UI'
import {money} from '../lib/format'
import {upsertClientFromOrder} from '../lib/clients'
export default function WebRequests({db,onSave}){
 const [rows,setRows]=useState([]); const [loading,setLoading]=useState(true)
 async function load(){const {data,error}=await supabase.from('web_requests').select('*').order('created_at',{ascending:false});if(!error)setRows(data||[]);setLoading(false)}
 useEffect(()=>{load()},[])
 async function confirmRow(r){
  if(!confirm(`¿Confirmar el pago de ${r.code} y crear el pedido?`))return
  const next=String(Math.max(0,...db.orders.map(x=>Number(x.number)||0))+1).padStart(3,'0')
  const c=r.customer||{}; const order={id:crypto.randomUUID(),number:next,date:new Date().toISOString().slice(0,10),delivery:r.estimated_from||'',client:c.name||'',phone:c.phone||'',dni:c.dni||'',email:c.email||'',address:c.address||'',betweenStreets:c.betweenStreets||'',locality:c.locality||'',province:c.province||'',postalCode:c.postalCode||'',zone:[c.locality,c.province].filter(Boolean).join(' · '),deliveryType:c.method||'Logística',carrier:c.method||'Logística',agencyDelivery:c.agencyDelivery||'',priority:'Normal',status:'Ingresado',paid:'Sí',shippingPackaging:c.method==='Envío'?'Sí':'No',items:(r.items||[]).map(i=>({figure:i.name,productId:i.productId||'',qty:Number(i.qty||0)})),total:Number(r.estimated_total||0),notes:[r.notes,`Solicitud ${r.code}`].filter(Boolean).join(' · '),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  const orders=[...db.orders,order]; const clients=upsertClientFromOrder(db.clients||[],order);
  await onSave({...db,orders,clients}); await supabase.from('web_requests').update({status:'Pago confirmado'}).eq('id',r.id); await load(); alert(`Pedido #${next} creado.`)
 }
 return <><Title title="Solicitudes web" sub="Confirmá el pago para convertir la solicitud en un pedido real."/>
 <div className="panel table-wrap"><table><thead><tr><th>Código</th><th>Cliente</th><th>Piezas</th><th>Entrega estimada</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.code}</b></td><td>{r.customer?.name}<small className="block">{r.customer?.phone}</small></td><td>{r.quantity}</td><td>{r.estimated_from||'-'} a {r.estimated_to||'-'}</td><td>{money(r.estimated_total)}</td><td>{r.status}</td><td>{r.status==='Pendiente de pago'&&<button className="primary" onClick={()=>confirmRow(r)}>Confirmar pago y crear pedido</button>}</td></tr>)}</tbody></table>{loading&&<p>Cargando…</p>}{!loading&&!rows.length&&<p>No hay solicitudes.</p>}</div></>
}
