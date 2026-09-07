import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../supabase'
import {Title} from '../components/UI'
import {money} from '../lib/format'
import {upsertClientFromOrder} from '../lib/clients'
import {estimateProductionAvailability,todayArgentinaISO} from '../lib/production'
import {downloadOrderReceiptJpg} from '../lib/orderReceipt'

const pending=r=>['Pendiente de pago','Presupuesto enviado'].includes(r.status)
export default function WebRequests({db,onSave}){
 const [rows,setRows]=useState([]),[detail,setDetail]=useState(null),[view,setView]=useState('pending')
 async function load(){const {data,error}=await supabase.from('web_requests').select('*').order('created_at',{ascending:false});if(error)alert('No se pudieron cargar las solicitudes: '+error.message);else setRows(data||[])}
 useEffect(()=>{load()},[])
 async function confirmRow(r){
  if(!window.confirm(`¿Confirmar el pago de ${r.code} y crear el pedido?`))return
  const {data:fresh,error}=await supabase.from('app_state').select('data').eq('id','main').maybeSingle();if(error)return alert('No se pudo verificar el número de pedido: '+error.message)
  const freshOrders=Array.isArray(fresh?.data?.orders)?fresh.data.orders:[]
  const existing=freshOrders.find(o=>String(o.notes||'').includes(`Solicitud ${r.code}`));if(existing){await supabase.from('web_requests').update({status:'Pago confirmado'}).eq('id',r.id);await load();setDetail(null);return alert(`La solicitud ya corresponde al pedido #${existing.number}. No se creó un duplicado.`)}
  const next=String(Math.max(0,...freshOrders.map(o=>Number(o.number)||0))+1).padStart(3,'0'),c=r.customer||{},pickup=(c.method||'Logística')==='Retiro en el local';let shippingCost=0,shippingPaid='No corresponde'
  if(!pickup){const value=window.prompt('Costo de envío ya presupuestado (solo números):','0');if(value===null)return;shippingCost=Math.max(0,Number(String(value).replace(/[^0-9.,]/g,'').replace(',','.'))||0);shippingPaid=window.confirm('¿El costo de envío ya está PAGADO?\nAceptar = Pagado · Cancelar = Pendiente de pago')?'Pagado':'Pendiente de pago'}
  const estimate=!r.estimated_from?estimateProductionAvailability(freshOrders,Number(r.quantity||0),db.productionClosedDates||[]):null,now=new Date().toISOString()
  const order={id:crypto.randomUUID(),number:next,date:todayArgentinaISO(),delivery:r.estimated_from||estimate?.productionDate||'',firstName:c.firstName||'',lastName:c.lastName||'',client:c.name||[c.firstName,c.lastName].filter(Boolean).join(' '),phone:c.phone||'',dni:c.dni||'',email:c.email||'',address:c.address||'',betweenStreets:c.betweenStreets||'',locality:c.locality||'',district:c.district||'',province:c.province||'',postalCode:c.postalCode||'',zone:[c.locality,c.province].filter(Boolean).join(' · '),deliveryType:c.method||'Logística',carrier:c.method||'Logística',agencyDelivery:c.agencyDelivery||'',priority:'Normal',status:'Ingresado',paid:'Sí',shippingPackaging:pickup?'No':'Sí',shippingCost,shippingPaid,items:(r.items||[]).map(i=>({figure:i.name||i.figure,productId:i.productId||'',qty:Number(i.qty||0)})),total:Number(r.estimated_total||0),notes:[r.notes,`Solicitud ${r.code}`].filter(Boolean).join(' · '),createdAt:now,updatedAt:now}
  const saved=await onSave({...db,orders:[...freshOrders,order],clients:upsertClientFromOrder(db.clients||[],order)});if(saved?.ok===false)return alert('El pedido NO se guardó. La solicitud sigue pendiente; recargá y volvé a confirmar.')
  const verify=await supabase.from('app_state').select('data').eq('id','main').maybeSingle(),verified=verify.data?.data?.orders?.some(o=>o.id===order.id&&String(o.number)===next);if(!verified)return alert('No pude verificar el pedido guardado. La solicitud queda pendiente para no perderla.')
  try{await downloadOrderReceiptJpg(order)}catch(e){console.error(e)}
  const updated=await supabase.from('web_requests').update({status:'Pago confirmado'}).eq('id',r.id);if(updated.error)return alert(`Pedido #${next} creado, pero la solicitud quedó pendiente: ${updated.error.message}`)
  await load();setDetail(null);alert(`Pedido #${next} creado y verificado.`)
 }
 const visible=useMemo(()=>view==='pending'?rows.filter(pending):rows.filter(r=>!pending(r)),[rows,view])
 return <><Title title="Solicitudes web" sub="Confirmación segura: el número se calcula con los pedidos actuales y la solicitud sólo se marca confirmada después de verificar el pedido."/><div className="request-tabs"><button className={view==='pending'?'active':''} onClick={()=>setView('pending')}>Pendientes</button><button className={view==='history'?'active':''} onClick={()=>setView('history')}>Historial</button></div><div className="panel table-wrap"><table><thead><tr><th>Código</th><th>Cliente</th><th>Piezas</th><th>Entrega</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><b>{r.code}</b></td><td>{r.customer?.name||''}</td><td>{r.quantity}</td><td>{r.estimated_from||'A confirmar'}</td><td>{money(r.estimated_total)}</td><td>{r.status}</td><td><button className="ghost" onClick={()=>setDetail(r)}>Ver</button>{pending(r)&&<button className="primary" onClick={()=>confirmRow(r)}>Confirmar directo</button>}</td></tr>)}</tbody></table></div>{detail&&<div className="web-request-modal-backdrop"><div className="web-request-modal panel"><div className="panel-heading"><div><h2>{detail.code}</h2><small>{detail.customer?.name}</small></div><button className="ghost" onClick={()=>setDetail(null)}>Cerrar</button></div><div className="request-summary-cards"><span><b>{detail.quantity}</b> piezas</span><span><b>{money(detail.estimated_total)}</b> total</span></div><div className="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad</th></tr></thead><tbody>{(detail.items||[]).map((i,n)=><tr key={n}><td>{i.name||i.figure}</td><td>{i.qty}</td></tr>)}</tbody></table></div>{pending(detail)&&<button className="primary" onClick={()=>confirmRow(detail)}>Confirmar pago y crear pedido</button>}</div></div>}</>
}
