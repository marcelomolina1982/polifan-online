import React, { useMemo, useState } from 'react'
import html2canvas from 'html2canvas'
import { Title } from '../components/UI'
import { statusColors } from '../lib/constants'
import { money } from '../lib/format'

const esc=(value)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))

function deliveryParts(value){
  if(!value) return {day:'SIN FECHA',date:'-',dayClass:'day-none'}
  const [y,m,d]=value.split('-').map(Number)
  const date=new Date(y,m-1,d)
  const day=date.toLocaleDateString('es-AR',{weekday:'long'}).toUpperCase()
  const classes=['day-sunday','day-monday','day-tuesday','day-wednesday','day-thursday','day-friday','day-saturday']
  return {day,date:`${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`,dayClass:classes[date.getDay()]}
}

function formatDelivery(value){
  return deliveryParts(value).date
}

function orderTicket(o){
  const totalPieces=(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
  const entryDate=o.createdAt?new Date(o.createdAt):null
  const entryText=entryDate?entryDate.toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}):'-'
  const delivery=deliveryParts(o.delivery)
  const items=(o.items||[]).map(i=>`<tr><td>${esc(i.figure)}</td><td>${Number(i.qty||0)}</td></tr>`).join('')
  return `<article class="ticket">
    <div class="brand">TU VIDA EN TINTA · POLIFAN</div>
    <div class="delivery ${esc(delivery.dayClass)}"><small>FECHA DE SALIDA</small><strong class="delivery-day">${esc(delivery.day)}</strong><span class="delivery-date">${esc(delivery.date)}</span></div>
    <div class="order-number">PEDIDO #${esc(o.number)}</div>
    <div class="grid">
      <div><b>Cliente</b></div><div>${esc(o.client)}</div>
      <div><b>Teléfono</b></div><div>${esc(o.phone||'-')}</div>
      <div><b>Zona</b></div><div>${esc(o.zone||'-')}</div>
      <div><b>Transporte</b></div><div>${esc(o.carrier||'-')}</div>
      <div><b>Estado</b></div><div>${esc(o.status)}</div>
    </div>
    <div class="pieces-highlight"><small>TOTAL DE PIEZAS</small><strong>${totalPieces}</strong></div>
    <table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>${items}</tbody></table>
    <p class="total"><b>Total:</b> ${money(o.total)}</p>
    <p class="notes"><b>Observaciones:</b> ${esc(o.notes||'-')}</p>
    <div class="entry-reference">Fecha de entrada: ${esc(entryText)}</div>
    <div class="footer">¡Gracias por tu compra!</div>
  </article>`
}


function remitoHtml(o){
  const pieces=(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
  const rows=(o.items||[]).map(i=>`<tr><td>${esc(i.figure)}</td><td>${Number(i.qty||0)}</td></tr>`).join('')
  return `<section class="remito"><div class="remito-head"><div><b>TU VIDA EN TINTA</b><small>REMITO PARA EL CLIENTE</small></div><strong>Pedido #${esc(o.number)}</strong></div><div class="remito-grid"><div><b>Cliente</b><span>${esc(o.client)}</span></div><div><b>Teléfono</b><span>${esc(o.phone||'-')}</span></div><div><b>Dirección / zona</b><span>${esc(o.zone||'-')}</span></div><div><b>Entrega</b><span>${esc(o.carrier||'-')}</span></div></div><table><thead><tr><th>Producto</th><th>Cantidad</th></tr></thead><tbody>${rows}</tbody></table><div class="remito-total"><span>Total de piezas: <b>${pieces}</b></span><span>Total: <b>${money(o.total)}</b></span></div><p><b>Observaciones:</b> ${esc(o.notes||'-')}</p><div class="remito-sign"><span>Recibí conforme: ____________________</span><span>Aclaración: ____________________</span></div><footer>Gracias por elegir Tu Vida En Tinta · WhatsApp 11-5919-2358 · @tuvidaentinta</footer></section>`
}
function orderAndRemito(o){return `<div class="combined-sheet">${orderTicket(o)}<div class="cut-line">✂</div>${remitoHtml(o)}</div>`}

async function downloadHtmlAsJpg(bodyHtml,css,filename,width=900){
  const frame=document.createElement('iframe')
  frame.setAttribute('aria-hidden','true')
  frame.style.position='fixed'
  frame.style.left='-10000px'
  frame.style.top='0'
  frame.style.width=width+'px'
  frame.style.height='1400px'
  frame.style.border='0'
  frame.style.background='#fff'
  document.body.appendChild(frame)
  const doc=frame.contentDocument
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${css}html,body{background:#fff!important}body{padding:20px}</style></head><body>${bodyHtml}</body></html>`)
  doc.close()
  await new Promise(resolve=>setTimeout(resolve,180))
  try{
    const target=doc.body
    frame.style.height=Math.max(600,target.scrollHeight+40)+'px'
    const canvas=await html2canvas(target,{backgroundColor:'#ffffff',scale:2,useCORS:true,logging:false,width:target.scrollWidth,height:target.scrollHeight})
    const link=document.createElement('a')
    link.download=filename
    link.href=canvas.toDataURL('image/jpeg',0.95)
    link.click()
  }catch(error){
    console.error(error)
    alert('No se pudo generar el JPG. Intentá nuevamente.')
  }finally{
    frame.remove()
  }
}

function labelHtml(o){
  const totalPieces=(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
  return `<div class="label"><div class="brand">TU VIDA EN TINTA · POLIFAN</div><div class="number">PEDIDO #${esc(o.number)}</div><div class="client">${esc(o.client)}</div><div class="details"><div><b>Entrega</b>${formatDelivery(o.delivery)}</div><div><b>Total de piezas</b>${totalPieces}</div></div></div>`
}

function labelStyles(){
  return `*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;width:100mm}.label{border:2px solid #111;width:100mm;height:60mm;padding:5mm;display:flex;flex-direction:column;justify-content:space-between;background:#fff}.brand{text-align:center;font-size:12px;font-weight:800}.number{text-align:center;font-size:25px;font-weight:900;background:#111;color:#fff;padding:3px}.client{text-align:center;font-size:20px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.details{display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px}.details div{border-top:1px solid #999;padding-top:3px}.details b{display:block;font-size:9px;text-transform:uppercase}`
}

function printStyles(perPage=2){
  const columns=perPage===1?1:2
  const ticketWidth=perPage===1?'92mm':'100%'
  const fontSize=perPage===4?'9px':'10.5px'
  const padding=perPage===4?'4mm':'5mm'
  return `
    @page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;color:#111}.print-grid{display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:6mm;align-items:start}.ticket{width:${ticketWidth};border:1.5px solid #111;padding:${padding};font-size:${fontSize};break-inside:avoid;page-break-inside:avoid}.brand{text-align:center;font-size:14px;font-weight:800;margin:0 0 5px}.delivery{text-align:center;border:2px solid #111;padding:${perPage===4?'5px 3px':'7px 4px'};margin-bottom:6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.delivery small{display:block;font-weight:800;font-size:9px;letter-spacing:.8px}.delivery-day{display:block;font-size:${perPage===4?'24px':'32px'};line-height:1;font-weight:900;margin-top:3px}.delivery-date{display:block;font-size:${perPage===4?'16px':'21px'};line-height:1.05;font-weight:800;margin-top:4px}.day-monday{background:#2eaf63;color:#fff}.day-tuesday{background:#2f70d0;color:#fff}.day-wednesday{background:#f3d43b;color:#111}.day-thursday{background:#ee8a2f;color:#111}.day-friday{background:#d94343;color:#fff}.day-saturday{background:#8a55c5;color:#fff}.day-sunday,.day-none{background:#e5e5e5;color:#111}.order-number{text-align:center;background:#111;color:#fff;padding:4px;font-size:14px;font-weight:800;margin-bottom:6px}.grid{display:grid;grid-template-columns:26mm 1fr}.grid div{padding:2px;border-bottom:1px solid #ccc;min-height:16px}.grid b{font-size:9px}.pieces-highlight{text-align:center;border:2px solid #111;padding:${perPage===4?'5px 3px':'7px 4px'};margin:6px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.pieces-highlight small{display:block;font-weight:800;font-size:9px;letter-spacing:.8px}.pieces-highlight strong{display:block;font-size:${perPage===4?'24px':'32px'};line-height:1;font-weight:900;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:7px}th,td{border:1px solid #111;padding:${perPage===4?'3px':'4px'};text-align:left}th:last-child,td:last-child{width:27%;text-align:center}.total{font-size:12px;margin:7px 0 3px}.notes{margin:3px 0;min-height:18px}.entry-reference{text-align:right;margin-top:6px;font-size:8px;color:#444}.footer{text-align:center;border-top:1px dashed #555;margin-top:7px;padding-top:5px;font-size:9px;font-style:italic}
    ${perPage===2?'.ticket:nth-child(2n){break-after:page}':perPage===4?'.ticket:nth-child(4n){break-after:page}':'.ticket{break-after:page}.ticket:last-child{break-after:auto}'}
    .combined-sheet{break-after:page;page-break-after:always;min-height:275mm;display:flex;flex-direction:column}.combined-sheet:last-child{break-after:auto}.combined-sheet>.ticket{width:100%;break-after:auto!important;page-break-after:auto!important;flex:0 1 auto}.cut-line{border-top:1px dashed #555;margin:5mm 0 3mm;text-align:right;font-size:11px;height:2mm}.remito{border:1.5px solid #111;padding:4mm;font-size:10px;break-inside:avoid}.remito-head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:5px}.remito-head div{display:flex;flex-direction:column}.remito-head b{font-size:15px}.remito-head small{font-weight:800}.remito-head>strong{font-size:15px}.remito-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;margin-bottom:5px}.remito-grid div{display:flex;gap:5px;border-bottom:1px solid #bbb;padding:2px}.remito-total{display:flex;justify-content:space-between;font-size:12px;margin:5px 0}.remito-sign{display:flex;justify-content:space-between;margin-top:8px}.remito footer{text-align:center;border-top:1px dashed #777;margin-top:8px;padding-top:5px;font-size:9px}.print-grid{display:block}
    @media print{body{display:block}}
  `
}

export default function Orders({db,onSave,onEdit}){
  const [q,setQ]=useState('')
  const [status,setStatus]=useState('')
  const [selected,setSelected]=useState([])

  const list=useMemo(()=>db.orders.filter(o=>{
    const s=(o.client+' '+o.phone+' '+o.number+' '+(o.items||[]).map(i=>i.figure).join(' ')).toLowerCase()
    return s.includes(q.toLowerCase()) && (!status || o.status===status)
  }).slice().reverse(),[db.orders,q,status])

  const selectedOrders=useMemo(()=>db.orders.filter(o=>selected.includes(o.id)),[db.orders,selected])
  const visibleIds=list.map(o=>o.id)
  const allVisibleSelected=visibleIds.length>0 && visibleIds.every(id=>selected.includes(id))

  async function remove(id){
    if(confirm('¿Eliminar este pedido?')){
      setSelected(prev=>prev.filter(x=>x!==id))
      await onSave({...db,orders:db.orders.filter(o=>o.id!==id)})
    }
  }

  async function setStatusOrder(o,newStatus){
    await onSave({...db,orders:db.orders.map(x=>x.id===o.id?{...x,status:newStatus,updatedAt:new Date().toISOString()}:x)})
  }

  function openWhatsApp(o){
    const number=String(o.phone||'').replace(/\D/g,'')
    if(!number) return alert('Este pedido no tiene un teléfono cargado.')
    const pieces=(o.items||[]).reduce((sum,item)=>sum+Number(item.qty||0),0)
    const delivery=o.delivery?formatDelivery(o.delivery):'a confirmar'
    const status=String(o.status||'Ingresado')
    const statusMessages={
      'Ingresado':'ya fue registrado y está esperando su turno de producción',
      'En producción':'ya está en producción',
      'Listo':'ya está listo',
      'Despachado':'ya fue despachado',
      'Entregado':'figura como entregado'
    }
    const text=[
      `Hola ${o.client} 😊`,
      '',
      `Te escribimos de *Tu Vida En Tinta* por tu pedido *#${o.number}*.`,
      `📦 Cantidad de piezas: *${pieces}*`,
      `💰 Total: *${money(o.total)}*`,
      `📌 Estado: *${status}*`,
      `📅 Fecha de salida: *${delivery}*`,
      '',
      `Tu pedido ${statusMessages[status]||'se encuentra actualizado en nuestro sistema'}.`,
      'Ante cualquier consulta, podés responder este mensaje.',
      '',
      '¡Gracias por elegirnos! 💜'
    ].join('\n')
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`,'_blank','noopener,noreferrer')
  }


  async function duplicateOrder(o){
    const nextNumber=String(Math.max(0,...db.orders.map(x=>Number(x.number)||0))+1).padStart(3,'0')
    const copy={...JSON.parse(JSON.stringify(o)),id:crypto.randomUUID(),number:nextNumber,date:new Date().toISOString().slice(0,10),delivery:'',status:'Ingresado',paid:'No',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),notes:[o.notes,'Pedido duplicado del #'+o.number].filter(Boolean).join(' · ')}
    await onSave({...db,orders:[...db.orders,copy]})
    alert(`Pedido duplicado correctamente. Nuevo pedido #${nextNumber}.`)
  }

  function printLabel(o){
    const win=window.open('','_blank')
    if(!win) return alert('El navegador bloqueó la ventana de impresión.')
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiqueta #${esc(o.number)}</title><style>@page{size:100mm 60mm;margin:0}${labelStyles()}</style></head><body>${labelHtml(o)}<script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  function downloadLabelJpg(o){
    downloadHtmlAsJpg(labelHtml(o),labelStyles(),`etiqueta-pedido-${o.number}.jpg`,430)
  }

  function downloadOrderJpg(o){
    const css=printStyles(1)+'.print-grid{display:block}.ticket{margin:0 auto;break-after:auto!important}'
    downloadHtmlAsJpg(`<div class="print-grid">${orderTicket(o)}</div>`,css,`pedido-${o.number}.jpg`,900)
  }

  function printOrders(orders,perPage=2,includeCutList=false){
    if(!orders.length) return alert('Seleccioná al menos un pedido para imprimir.')
    const sorted=orders.slice().sort((a,b)=>(a.delivery||'9999-12-31').localeCompare(b.delivery||'9999-12-31') || String(a.number||'').localeCompare(String(b.number||'')))
    let cutHtml=''
    if(includeCutList){
      const byDate={}
      sorted.forEach(o=>{
        const key=o.delivery||'sin-fecha'
        if(!byDate[key]) byDate[key]={date:o.delivery||'',orders:[],rows:{}}
        byDate[key].orders.push(o.number)
        ;(o.items||[]).forEach(i=>{
          if(!i.figure) return
          byDate[key].rows[i.figure]=(byDate[key].rows[i.figure]||0)+Number(i.qty||0)
        })
      })
      const sections=Object.values(byDate).map(g=>{
        const rows=Object.entries(g.rows).sort((a,b)=>a[0].localeCompare(b[0],'es',{sensitivity:'base'})).map(([figure,qty])=>`<tr><td>${esc(figure)}</td><td>${qty}</td></tr>`).join('')
        const total=Object.values(g.rows).reduce((a,n)=>a+Number(n||0),0)
        return `<section class="cut-section"><h2>Entrega: ${formatDelivery(g.date)}</h2><p>Pedidos: ${g.orders.map(n=>'#'+esc(n)).join(', ')}</p><table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th>Total de piezas</th><th>${total}</th></tr></tfoot></table></section>`
      }).join('')
      cutHtml=`<div class="cut-page"><header><h1>TU VIDA EN TINTA · POLIFAN</h1><b>LISTA DE CORTE DE PEDIDOS SELECCIONADOS</b></header>${sections}<p class="cut-note">Esta lista resume las piezas de los pedidos seleccionados.</p></div>`
    }
    const win=window.open('','_blank')
    if(!win) return alert('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes e intentá nuevamente.')
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pedidos seleccionados</title><style>${printStyles(perPage)}
      .cut-page{break-after:page;font-size:12px}.cut-page header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}.cut-page h1{font-size:20px;margin:0 0 4px}.cut-section{break-inside:avoid;margin-bottom:14px}.cut-section h2{font-size:15px;margin:0;background:#eee;padding:7px;border:1px solid #111}.cut-section p{font-size:10px;margin:5px 0;color:#444}.cut-section table{margin-top:0}.cut-section tfoot th{background:#f3f3f3}.cut-note{text-align:center;font-size:10px;margin-top:12px}
    </style></head><body>${cutHtml}<div class="print-grid">${sorted.map(orderAndRemito).join('')}</div><script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  function toggleOne(id){
    setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])
  }

  function toggleVisible(){
    setSelected(prev=>allVisibleSelected?prev.filter(id=>!visibleIds.includes(id)):[...new Set([...prev,...visibleIds])])
  }

  function selectByDelivery(){
    const dates=[...new Set(list.map(o=>o.delivery).filter(Boolean))].sort()
    if(!dates.length) return alert('No hay fechas de entrega en los pedidos visibles.')
    const options=dates.map((d,i)=>`${i+1}. ${formatDelivery(d)}`).join('\n')
    const answer=prompt(`Elegí el número de la fecha que querés seleccionar:\n\n${options}`)
    if(answer===null) return
    const index=Number(answer)-1
    if(index<0||index>=dates.length) return alert('Opción inválida.')
    const ids=list.filter(o=>o.delivery===dates[index]).map(o=>o.id)
    setSelected(prev=>[...new Set([...prev,...ids])])
  }

  return <>
    <Title title="Pedidos" sub="Buscá, editá, seleccioná e imprimí varios pedidos juntos."/>
    <div className="panel filters">
      <input placeholder="Buscar cliente, teléfono, número o figura…" value={q} onChange={e=>setQ(e.target.value)}/>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select>
    </div>

    <div className="panel bulk-toolbar">
      <div><b>{selected.length} pedido{selected.length===1?'':'s'} seleccionado{selected.length===1?'':'s'}</b><small>Cada pedido se imprime en una hoja A4 con su remito debajo.</small></div>
      <div className="bulk-actions">
        <button className="ghost" onClick={toggleVisible}>{allVisibleSelected?'Quitar selección visible':'Seleccionar visibles'}</button>
        <button className="ghost" onClick={selectByDelivery}>Seleccionar por fecha</button>
        <button className="primary" disabled={!selected.length} onClick={()=>printOrders(selectedOrders,1,false)}>Imprimir seleccionados</button>
        <button className="primary" disabled={!selected.length} onClick={()=>printOrders(selectedOrders,1,true)}>Lista de corte + pedidos</button>
        {selected.length>0&&<button className="ghost" onClick={()=>setSelected([])}>Cancelar selección</button>}
      </div>
    </div>

    <div className="panel table-wrap"><table><thead><tr><th className="select-cell"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Seleccionar pedidos visibles"/></th><th>Pedido</th><th>Entrega</th><th>Cliente</th><th>Piezas</th><th>Estado</th><th>Total</th><th>Acciones</th></tr></thead>
      <tbody>{list.map(o=><tr key={o.id} className={selected.includes(o.id)?'selected-row':''}><td className="select-cell"><input type="checkbox" checked={selected.includes(o.id)} onChange={()=>toggleOne(o.id)} aria-label={`Seleccionar pedido ${o.number}`}/></td><td>#{o.number}</td><td><b>{o.delivery||'Sin fecha'}</b></td><td><b>{o.client}</b><small className="block">{o.phone}</small></td>
        <td>{(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)}</td>
        <td><select value={o.status} onChange={e=>setStatusOrder(o,e.target.value)}>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select></td>
        <td>{money(o.total)}</td><td className="row-actions">
          <button className="ghost" onClick={()=>printOrders([o],1,false)}>Imprimir pedido</button>
          <button className="ghost" onClick={()=>downloadOrderJpg(o)}>Pedido JPG</button>
          {o.phone&&<button className="whatsapp" onClick={()=>openWhatsApp(o)}>WhatsApp</button>}
          <button className="ghost" onClick={()=>duplicateOrder(o)}>Duplicar</button>
          <button className="ghost" onClick={()=>onEdit(o)}>Editar</button>
          <button className="danger" onClick={()=>remove(o.id)}>Eliminar</button>
        </td></tr>)}</tbody>
    </table></div>
  </>
}
