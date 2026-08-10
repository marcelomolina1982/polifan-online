import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../supabase'

const value=(...rows)=>rows.find(x=>String(x??'').trim())||'-'
function deliveryType(o){
  const raw=String(o?.deliveryType||o?.carrier||'Logística')
  const k=raw.toLocaleLowerCase('es')
  if(k.includes('retiro'))return 'Retiro en el local'
  if(k.includes('via cargo')||k.includes('vía cargo'))return 'Vía Cargo'
  if(k.includes('correo argentino'))return 'Correo Argentino'
  if(k.includes('otro'))return 'Otro expreso'
  return 'Logística GBA/CABA'
}
function Info({label,children,wide=false}){
  return <div style={{gridColumn:wide?'1 / -1':undefined,padding:'10px 12px',border:'1px solid #d7deea',borderRadius:10,background:'#f8fafc',minWidth:0}}><small style={{display:'block',fontSize:11,fontWeight:900,color:'#607089',textTransform:'uppercase',marginBottom:3}}>{label}</small><b style={{fontSize:15,overflowWrap:'anywhere'}}>{children||'-'}</b></div>
}

export default function OrderControl(){
  const id=new URLSearchParams(window.location.search).get('control')||''
  const [order,setOrder]=useState(null)
  const [loading,setLoading]=useState(true)
  useEffect(()=>{(async()=>{try{
    const {data}=await supabase.from('app_state').select('data').eq('id','main').maybeSingle()
    setOrder((data?.data?.orders||[]).find(o=>String(o.id)===String(id))||null)
  }finally{setLoading(false)}})()},[id])
  const pieces=useMemo(()=>order?(order.items||[]).reduce((a,i)=>a+Number(i.qty||0),0):0,[order])
  if(loading)return <div className="control-page"><div className="control-card">Cargando pedido…</div></div>
  if(!order)return <div className="control-page"><div className="control-card"><h1>Pedido no encontrado</h1><p>El enlace puede ser incorrecto o el pedido fue eliminado.</p></div></div>

  const fullName=value(order.client,[order.firstName,order.lastName].filter(Boolean).join(' '))
  const address=value(order.address,order.customer?.address,order.shippingAddress)
  const between=value(order.betweenStreets,order.customer?.betweenStreets)
  const locality=value(order.locality,order.customer?.locality,order.city,order.zone)
  const district=value(order.district,order.customer?.district,order.party)
  const province=value(order.province,order.customer?.province)
  const postal=value(order.postalCode,order.customer?.postalCode,order.cp)
  const email=value(order.email,order.customer?.email)
  const dispatch=deliveryType(order)

  return <div className="control-page"><div className="control-card" style={{maxWidth:820}}>
    <div className="control-brand"><img src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta"/><div><small>TU VIDA EN TINTA</small><h1>Datos del pedido y despacho</h1></div></div>

    <div className="control-head"><div><small>PEDIDO</small><b>#{order.number}</b></div><div><small>CLIENTE</small><b>{fullName}</b></div><div><small>TOTAL</small><b>{pieces} piezas</b></div></div>

    <div style={{margin:'18px 0 10px',padding:'13px 15px',borderRadius:12,background:'#102f55',color:'#fff'}}><small style={{display:'block',opacity:.8,fontWeight:800}}>DESPACHAR POR</small><b style={{display:'block',fontSize:24,marginTop:2}}>{dispatch}{order.agencyDelivery?` · ${order.agencyDelivery}`:''}</b></div>

    <h2 style={{fontSize:18,margin:'18px 0 10px'}}>Datos del destinatario</h2>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:9}}>
      <Info label="Nombre y apellido">{fullName}</Info>
      <Info label="DNI">{value(order.dni)}</Info>
      <Info label="Teléfono">{value(order.phone)}</Info>
      <Info label="Email">{email}</Info>
      <Info label="Domicilio" wide>{address}</Info>
      <Info label="Entre calles" wide>{between}</Info>
      <Info label="Localidad">{locality}</Info>
      <Info label="Partido / Departamento">{district}</Info>
      <Info label="Provincia">{province}</Info>
      <Info label="Código postal">{postal}</Info>
      <Info label="Tipo de entrega">{dispatch}</Info>
      <Info label="Modalidad / Agencia">{value(order.agencyDelivery)}</Info>
      <Info label="Fecha de salida">{value(order.delivery)}</Info>
      <Info label="Estado del pedido">{value(order.status)}</Info>
      {order.notes&&<Info label="Observaciones" wide>{order.notes}</Info>}
    </div>

    <h2 style={{fontSize:18,margin:'22px 0 10px'}}>Control de piezas</h2>
    <div className="control-list">{(order.items||[]).filter(i=>i.figure&&Number(i.qty)>0).map((i,index)=><label key={index}><input type="checkbox"/><span>{i.figure}</span><b>x {Number(i.qty)}</b></label>)}</div>
    <p className="control-note">Esta ficha sirve para despacho y control interno. Las marcas de la lista de piezas quedan solamente en este dispositivo.</p>
  </div></div>
}
