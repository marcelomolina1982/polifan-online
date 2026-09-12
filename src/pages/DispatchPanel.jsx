import React,{useEffect,useMemo,useRef,useState} from 'react'
import {advanceOperationalJourney,effectiveJourneyEvent,markJourneyFinal} from '../lib/customerJourneyOperational.js'
import {JOURNEY_EVENTS} from '../lib/customerJourney.js'

export default function DispatchPanel({db,onSave}){
  const syncing=useRef(false)
  const [busy,setBusy]=useState('')

  useEffect(()=>{
    if(syncing.current)return
    const result=advanceOperationalJourney(db)
    if(!result.changed)return
    syncing.current=true
    Promise.resolve(onSave({...db,orders:result.orders})).finally(()=>{syncing.current=false})
  },[db.orders,db.movements,db.cutBatches])

  const ready=useMemo(()=>(db.orders||[]).filter(o=>effectiveJourneyEvent(o)===JOURNEY_EVENTS.PACKING),[db.orders])

  async function dispatch(order){
    if(!window.confirm(`¿Marcar el pedido #${order.number} como despachado?`))return
    setBusy(String(order.id||order.number))
    try{
      const nextOrder=markJourneyFinal(order)
      const result=await onSave({...db,orders:(db.orders||[]).map(o=>o.id===order.id?nextOrder:o)})
      if(result?.ok===false)return
      alert(`Pedido #${order.number} marcado como despachado.`)
    }finally{setBusy('')}
  }

  if(!ready.length)return null
  return <div className="panel" style={{marginBottom:16}}>
    <div className="panel-heading"><div><h3>Pedidos listos para despachar</h3><small>El seguimiento sólo pasa a Despachado cuando vos lo confirmás.</small></div></div>
    <div style={{display:'grid',gap:10,marginTop:12}}>{ready.map(o=><div key={o.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'12px 14px',border:'1px solid #e5e7eb',borderRadius:14}}><div><b>#{o.number} · {o.client}</b><small className="block">Fecha prevista: {o.delivery||'Sin fecha'}</small></div><button className="primary" disabled={busy===String(o.id||o.number)} onClick={()=>dispatch(o)}>{busy===String(o.id||o.number)?'Guardando…':'Marcar despachado'}</button></div>)}</div>
  </div>
}
