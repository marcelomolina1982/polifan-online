import React,{useMemo,useState} from 'react'
import {supabase} from '../supabase'
import {advanceOperationalJourney,effectiveJourneyEvent,markJourneyFinal} from '../lib/customerJourneyOperational.js'
import {JOURNEY_EVENTS} from '../lib/customerJourney.js'

const REVIEW_URL='https://tu-vida-en-tinta-catalogo-v2.vercel.app/opiniones'
const cleanPhone=value=>{
  let digits=String(value||'').replace(/\D/g,'')
  if(digits.startsWith('00'))digits=digits.slice(2)
  if(digits.startsWith('0'))digits=digits.slice(1)
  if(digits.startsWith('549'))return digits
  if(digits.startsWith('54')&&digits.length===12)return `549${digits.slice(2)}`
  if(digits.length===10)return `549${digits}`
  return digits
}
const isPickup=order=>String(order?.deliveryType||order?.carrier||'').toLocaleLowerCase('es').includes('retiro')
const firstName=order=>String(order?.firstName||order?.client||'').trim().split(/\s+/)[0]||'Hola'

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

  async function trackingTokenFor(order){
    if(order?.trackingToken)return order.trackingToken
    const {data,error}=await supabase.rpc('get_order_tracking_admin_by_number',{p_order_number:String(order.number||'')})
    if(error)throw error
    const row=Array.isArray(data)?data[0]:data
    return row?.token||''
  }

  function whatsappMessage(order,token){
    const pickup=isPickup(order)
    const statusLine=pickup?'Tu pedido ya está listo para retirar en nuestro local.':'Tu pedido ya fue despachado.'
    const tracking=token?`${window.location.origin}/p/${token}`:''
    return [
      `¡Hola ${firstName(order)}! 😊`,
      '',
      `${statusLine} Pedido #${order.number}.`,
      '',
      '💗 ¡Muchas gracias por elegir Tu Vida en Tinta! Esperamos que disfrutes mucho tu pedido.',
      tracking?'':null,
      tracking?'Podés ver el seguimiento acá:':null,
      tracking||null,
      '',
      '⭐ Si querés ayudarnos a seguir creciendo, nos encantaría que nos dejes tu opinión:',
      REVIEW_URL,
      '',
      '¡Gracias por confiar en nosotros! 💕'
    ].filter(line=>line!==null).join('\n')
  }

  async function dispatch(order){
    const action=isPickup(order)?'listo para retirar':'despachado'
    if(!window.confirm(`¿Marcar el pedido #${order.number} como ${action}?`))return
    const popup=window.open('about:blank','_blank')
    setBusy(String(order.id||order.number))
    try{
      const nextOrder=markJourneyFinal(order)
      const orders=operationalOrders.map(o=>o.id===order.id?nextOrder:o)
      await saveOrdersSafely(orders)
      const token=await trackingTokenFor(nextOrder)
      const phone=cleanPhone(order.phone)
      if(phone){
        const url=`https://wa.me/${phone}?text=${encodeURIComponent(whatsappMessage(nextOrder,token))}`
        if(popup)popup.location.href=url
        else window.open(url,'_blank','noopener,noreferrer')
        alert(`Pedido #${order.number} marcado como ${action}. Se abrió WhatsApp con el mensaje preparado.`)
      }else{
        if(popup)popup.close()
        alert(`Pedido #${order.number} marcado como ${action}, pero no tiene un teléfono válido para abrir WhatsApp.`)
      }
      window.location.reload()
    }catch(error){
      if(popup)popup.close()
      console.error(error)
      alert('No se pudo marcar como despachado: '+(error?.message||'error de sincronización'))
    }finally{setBusy('')}
  }

  if(!ready.length)return null
  return <div className="panel" style={{marginBottom:16}}>
    <div className="panel-heading"><div><h3>Pedidos listos para despachar</h3><small>El seguimiento sólo pasa a Despachado cuando vos lo confirmás. Después se abre WhatsApp con el aviso, seguimiento y enlace de opinión.</small></div></div>
    <div style={{display:'grid',gap:10,marginTop:12}}>{ready.map(o=><div key={o.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'12px 14px',border:'1px solid #e5e7eb',borderRadius:14}}><div><b>#{o.number} · {o.client}</b><small className="block">Fecha prevista: {o.delivery||'Sin fecha'}</small></div><button className="primary" disabled={busy===String(o.id||o.number)} onClick={()=>dispatch(o)}>{busy===String(o.id||o.number)?'Guardando…':isPickup(o)?'Marcar listo para retirar':'Marcar despachado'}</button></div>)}</div>
  </div>
}
