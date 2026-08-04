import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../supabase'

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
  return <div className="control-page"><div className="control-card">
    <div className="control-brand"><img src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta"/><div><small>TU VIDA EN TINTA</small><h1>Control de piezas</h1></div></div>
    <div className="control-head"><div><small>PEDIDO</small><b>#{order.number}</b></div><div><small>CLIENTE</small><b>{order.client}</b></div><div><small>TOTAL</small><b>{pieces} piezas</b></div></div>
    <div className="control-list">{(order.items||[]).filter(i=>i.figure&&Number(i.qty)>0).map((i,index)=><label key={index}><input type="checkbox"/><span>{i.figure}</span><b>x {Number(i.qty)}</b></label>)}</div>
    <p className="control-note">Usá esta lista desde el celular para controlar el armado. Las marcas quedan solamente en este dispositivo.</p>
  </div></div>
}
