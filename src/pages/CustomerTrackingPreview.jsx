import React from 'react'
import {customerFirstName,trackingState} from '../lib/customerJourney'
import './customer-tracking-preview.css'

export default function CustomerTrackingPreview({order={},event='confirmed'}){
  const stages=trackingState(order,event)
  return <main className="ct-preview-shell">
    <section className="ct-preview-card">
      <div className="ct-preview-brand">TU VIDA EN TINTA</div>
      <p className="ct-preview-kicker">SEGUIMIENTO DE PEDIDO</p>
      <h1>Hola, {customerFirstName(order)} 💜</h1>
      <p className="ct-preview-copy">Tu pedido <b>#{order.number||'—'}</b> está avanzando. Acá podés ver en qué etapa se encuentra.</p>
      <div className="ct-preview-track" role="list" aria-label="Estado del pedido">
        {stages.map((stage,index)=><div className={`ct-preview-step ${stage.state}`} role="listitem" key={stage.key}>
          <div className="ct-preview-dot">{stage.state==='done'?'✓':index+1}</div>
          <div className="ct-preview-label">{stage.label}</div>
          {index<stages.length-1&&<div className="ct-preview-line"/>}
        </div>)}
      </div>
      <div className="ct-preview-note">
        <b>Te mantenemos al tanto.</b>
        <span>Cada vez que tu pedido avance a una etapa importante vas a recibir una actualización por WhatsApp.</span>
      </div>
      <p className="ct-preview-safe">Por seguridad, esta página no muestra DNI, teléfono ni domicilio completo.</p>
    </section>
  </main>
}
