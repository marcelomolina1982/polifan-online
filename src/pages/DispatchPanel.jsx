import React,{useMemo,useState} from 'react'
import {supabase} from '../supabase'
import {advanceOperationalJourney,effectiveJourneyEvent,markJourneyFinal} from '../lib/customerJourneyOperational.js'
import {JOURNEY_EVENTS} from '../lib/customerJourney.js'

export default function DispatchPanel({db}){
  const [busy,setBusy]=useState('')

  const operationalOrders=useMemo(()=>advanceOperationalJourney(db).orders||db.orders||[],[db.orders,db.movements,db.cutBatches])
  const ready=useMemo(()=>operationalOrders.filter(o=>effectiveJourneyEvent(o)===JOURNEY_EVENTS.PACKING),[operationalOrders])

  async function saveOrdersSafely(orders){
    const {data:revisionRows,error:revisionError}=await supabase.rpc('get_v2_section_revisions',{p_keys:['orders']})
    if(revisionError)throw revisionError
    const expected=Object.fromEntries((revisionRows||[]).map(r=>[r.section_key,r.updated_at||'']))
    const {data:sessionData}=await supabase.auth.getSession()
    const {data,error}=await supabase.rpc('patch_v2_sections_checked',{p_patch:{orders},p_expected_revisions:expected,p_updated_by:sessionData?.session?.user?.id||null})
    if(error)throw error
    const row=Array.isArray(data)?data[0]:data
    if((row?.conflict_keys||[]).length)throw new Error('Otra sesión modificó Pedidos. Recargá y volvé a intentar.')
  }

  async function dispatch(order){
    if(!window.confirm(`¿Marcar el pedido #${order.number} como despachado?`))return
    setBusy(String(order.id||order.number))
    try{
      const nextOrder=markJourneyFinal(order)
      const orders=operationalOrders.map(o=>o.id===order.id?nextOrder:o)
      await saveOrdersSafely(orders)
      alert(`Pedido #${order.number} marcado como despachado.`)
      window.location.reload()
    }catch(error){
      console.error(error)
      alert('No se pudo marcar como despachado: '+(error?.message||'error de sincronización'))
    }finally{setBusy('')}
  }

  if(!ready.length)return null
  return <div className="panel" style={{marginBottom:16}}>
    <div className="panel-heading"><div><h3>Pedidos listos para despachar</h3><small>El seguimiento sólo pasa a Despachado cuando vos lo confirmás.</small></div></div>
    <div style={{display:'grid',gap:10,marginTop:12}}>{ready.map(o=><div key={o.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'12px 14px',border:'1px solid #e5e7eb',borderRadius:14}}><div><b>#{o.number} · {o.client}</b><small className="block">Fecha prevista: {o.delivery||'Sin fecha'}</small></div><button className="primary" disabled={busy===String(o.id||o.number)} onClick={()=>dispatch(o)}>{busy===String(o.id||o.number)?'Guardando…':'Marcar despachado'}</button></div>)}</div>
  </div>
}
