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

function compactItems(o,limit=6){
  const all=(o.items||[]).filter(i=>i.figure && Number(i.qty||0)>0)
  const shown=all.slice(0,limit)
  const rows=shown.map(i=>`<tr><td>${esc(i.figure)}</td><td>x ${Number(i.qty||0)}</td></tr>`).join('')
  const remaining=all.length-shown.length
  return rows+(remaining>0?`<tr class="more-row"><td colspan="2">+ ${remaining} figuras más</td></tr>`:'')
}

function orderTicket(o){
  const totalPieces=(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
  const delivery=deliveryParts(o.delivery)
  return `<article class="ticket internal-ticket">
    <div class="internal-title">PEDIDO INTERNO</div>
    <div class="brand">TU VIDA EN TINTA · POLIFAN</div>
    <div class="delivery ${esc(delivery.dayClass)}">
      <strong class="delivery-day">${esc(delivery.day)}</strong>
      <span class="delivery-date">${esc(delivery.date)}</span>
    </div>
    <div class="internal-client"><small>CLIENTE</small><strong>${esc(o.client||'-')}</strong></div>
    <div class="internal-data">
      <div><b>Pedido</b><span>#${esc(o.number)}</span></div>
      <div><b>Transporte</b><span>${esc(o.carrier||'-')}</span></div>
      <div><b>Zona</b><span>${esc(o.zone||'-')}</span></div>
      <div><b>Estado</b><span>${esc(o.status||'-')}</span></div>
    </div>
    <div class="pieces-highlight"><small>TOTAL DE PIEZAS</small><strong>${totalPieces}</strong></div>
    <table class="compact-table"><thead><tr><th>RESUMEN DE FIGURAS</th><th></th></tr></thead><tbody>${compactItems(o,5)}</tbody></table>
    <p class="notes"><b>Observaciones:</b> ${esc(o.notes||'-')}</p>
  </article>`
}

function boxLabelHtml(o){
  const totalPieces=(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
  const delivery=deliveryParts(o.delivery)
  return `<section class="box-label">
    <div class="box-day ${esc(delivery.dayClass)}">
      <strong>${esc(delivery.day)}</strong>
      <span>${esc(delivery.date)}</span>
    </div>
    <div class="box-main">
      <div class="box-brand">TU VIDA EN TINTA <small>· POLIFAN ·</small></div>
      <div class="box-client"><small>CLIENTE</small><strong>${esc(o.client||'-')}</strong></div>
      <div class="box-summary">
        <div class="box-pieces"><small>TOTAL</small><strong>${totalPieces}</strong><b>PIEZAS</b></div>
        <div class="box-details">
          <div><b>Pedido</b><span>#${esc(o.number)}</span></div>
          <div><b>Transporte</b><span>${esc(o.carrier||'-')}</span></div>
          <div><b>Destino</b><span>${esc(o.zone||'-')}</span></div>
          <div class="fragile"><b>FRÁGIL</b><span>Manipular con cuidado</span></div>
        </div>
      </div>
    </div>
  </section>`
}

function remitoHtml(o){
  const pieces=(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
  const delivery=deliveryParts(o.delivery)
  const rows=(o.items||[]).map(i=>`<tr><td>${esc(i.figure)}</td><td>${Number(i.qty||0)}</td></tr>`).join('')
  return `<section class="remito">
    <div class="remito-head">
      <div><b>TU VIDA EN TINTA</b><small>REMITO PARA EL CLIENTE</small></div>
      <strong>PEDIDO #${esc(o.number)}</strong>
      <div class="remito-date"><small>FECHA DE SALIDA</small><b>${esc(delivery.date)}</b><span>${esc(delivery.day)}</span></div>
    </div>
    <div class="remito-body">
      <div class="remito-left">
        <div class="remito-grid">
          <div><b>Cliente</b><span>${esc(o.client||'-')}</span></div>
          <div><b>Teléfono</b><span>${esc(o.phone||'-')}</span></div>
          <div><b>Dirección / zona</b><span>${esc(o.zone||'-')}</span></div>
          <div><b>Transporte</b><span>${esc(o.carrier||'-')}</span></div>
        </div>
        <div class="payment-box">
          <div><b>SEÑA / PAGÓ</b><span>$ __________</span></div>
          <div><b>SALDO</b><span>$ __________</span></div>
          <div><b>TOTAL</b><strong>${money(o.total)}</strong></div>
        </div>
        <p class="remito-notes"><b>Observaciones:</b><br>${esc(o.notes||'-')}</p>
      </div>
      <div class="remito-right">
        <table><thead><tr><th>Producto</th><th>Cantidad</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="remito-total"><span>Total de piezas: <b>${pieces}</b></span><span>Total: <b>${money(o.total)}</b></span></div>
        <div class="remito-sign"><span>Firma: ____________________</span><span>Aclaración: ____________________</span><span>DNI: ____________________</span></div>
      </div>
    </div>
    <footer>¡Gracias por elegir Tu Vida En Tinta! · WhatsApp 11-5919-2358 · @tuvidaentinta</footer>
  </section>`
}

function orderAndRemito(o){
  return `<div class="combined-sheet">
    <div class="top-print-row">
      ${orderTicket(o)}
      <div class="top-label-wrap"><div class="section-caption">✂ ETIQUETA PARA LA CAJA — RECORTAR Y PEGAR</div>${boxLabelHtml(o)}</div>
    </div>
    <div class="cut-line">✂ REMITO PARA EL CLIENTE</div>
    ${remitoHtml(o)}
  </div>`
}

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

function printStyles(perPage=1){
  return `
    @page{size:A4 portrait;margin:6mm}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .print-grid{display:block}
    .combined-sheet{width:198mm;height:285mm;break-after:page;page-break-after:always;overflow:hidden}
    .combined-sheet:last-child{break-after:auto;page-break-after:auto}
    .top-print-row{height:132mm;display:grid;grid-template-columns:52mm 1fr;gap:7mm;align-items:stretch}
    .ticket{border:1.2px solid #111;background:#fff;overflow:hidden}
    .internal-ticket{height:132mm;padding:2.3mm;font-size:7.6px;display:flex;flex-direction:column}
    .internal-title{text-align:center;background:#111;color:#fff;border-radius:2px;padding:2px;font-size:8px;font-weight:900;letter-spacing:.4px}
    .brand{text-align:center;font-size:9px;font-weight:900;margin:2mm 0 1.5mm}
    .delivery{text-align:center;border:1.2px solid #111;border-radius:2px;padding:2mm 1mm;margin-bottom:1.5mm}
    .delivery-day{display:block;font-size:20px;line-height:1;font-weight:900}
    .delivery-date{display:block;font-size:11px;line-height:1.1;font-weight:800;margin-top:1mm}
    .day-monday{background:#2eaf63;color:#fff}.day-tuesday{background:#2f70d0;color:#fff}.day-wednesday{background:#f3d43b;color:#111}.day-thursday{background:#ee8a2f;color:#111}.day-friday{background:#d94343;color:#fff}.day-saturday{background:#8a55c5;color:#fff}.day-sunday,.day-none{background:#e5e5e5;color:#111}
    .internal-client{border-bottom:1px solid #bbb;padding:1mm 0 1.5mm}
    .internal-client small{display:block;font-size:6.5px;font-weight:800;color:#555}
    .internal-client strong{display:block;font-size:14px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .internal-data{margin-top:1mm}
    .internal-data div{display:grid;grid-template-columns:15mm 1fr;gap:1mm;padding:.7mm 0;border-bottom:1px solid #ddd}
    .internal-data b{font-size:6.5px}.internal-data span{font-size:7.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pieces-highlight{text-align:center;border:1.2px solid #111;border-radius:2px;padding:1mm;margin:1.5mm 0}
    .pieces-highlight small{display:block;font-size:6.5px;font-weight:800}.pieces-highlight strong{display:block;font-size:22px;line-height:.95;font-weight:900}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #777;padding:1.1mm;text-align:left}
    .compact-table{font-size:6.8px;margin:0}
    .compact-table th{background:#111;color:#fff;font-size:6.4px;padding:.8mm}
    .compact-table th:last-child,.compact-table td:last-child{width:12mm;text-align:right;font-weight:800}
    .compact-table .more-row td{text-align:center!important;font-weight:800;background:#f4f4f4}
    .notes{font-size:6.8px;margin:1.2mm 0 0;min-height:8mm;overflow:hidden}
    .top-label-wrap{height:132mm;display:flex;flex-direction:column}
    .section-caption{text-align:center;font-size:8px;font-weight:900;color:#175fb8;margin-bottom:2mm}
    .box-label{flex:1;border:1.5px dashed #555;border-radius:4mm;padding:4mm;display:grid;grid-template-columns:35mm 1fr;background:#fff}
    .box-day{border-radius:3mm 0 0 3mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2mm;writing-mode:vertical-rl;transform:rotate(180deg)}
    .box-day strong{font-size:27px;line-height:1;font-weight:900;letter-spacing:1px}.box-day span{font-size:13px;font-weight:800;margin-top:3mm}
    .box-main{padding:2mm 4mm;display:flex;flex-direction:column}
    .box-brand{text-align:center;font-size:22px;font-weight:900;border-bottom:1px solid #999;padding-bottom:2mm}.box-brand small{display:block;font-size:9px;letter-spacing:2px}
    .box-client{margin:4mm 0 3mm}.box-client small{display:block;font-size:9px;font-weight:800;color:#555}.box-client strong{display:block;font-size:28px;line-height:1;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .box-summary{display:grid;grid-template-columns:1fr 1.2fr;gap:5mm;flex:1}
    .box-pieces{border:1px solid #aaa;border-radius:3mm;display:flex;flex-direction:column;align-items:center;justify-content:center}.box-pieces small{font-size:10px;font-weight:800}.box-pieces strong{font-size:48px;line-height:.9;color:#155fb8}.box-pieces b{font-size:16px}
    .box-details{display:flex;flex-direction:column;justify-content:space-around}.box-details div{border-bottom:1px dashed #999;padding:2mm 0}.box-details b{display:block;font-size:8px;text-transform:uppercase}.box-details span{display:block;font-size:13px;font-weight:800}
    .box-details .fragile{border:1px solid #e33;border-radius:2mm;padding:2mm;color:#d7193f}.box-details .fragile b{font-size:16px}.box-details .fragile span{color:#111;font-size:10px}
    .cut-line{border-top:1.2px dashed #555;margin:4mm 0 2.5mm;padding-top:1mm;text-align:center;font-size:8px;font-weight:900;color:#175fb8;height:6mm}
    .remito{height:141mm;border:1.2px solid #111;border-radius:2mm;padding:3mm;font-size:7.5px;display:flex;flex-direction:column;overflow:hidden}
    .remito-head{height:18mm;display:grid;grid-template-columns:1fr 1fr 45mm;align-items:center;border-bottom:2px solid #155fb8;padding-bottom:2mm;margin-bottom:2mm}
    .remito-head>div:first-child b{display:block;font-size:15px}.remito-head>div:first-child small{font-size:8px;font-weight:900;color:#155fb8}
    .remito-head>strong{text-align:center;font-size:15px}
    .remito-date{text-align:center;border:1px solid #9ab8dc;border-radius:2mm;padding:1mm}.remito-date small{display:block;font-size:6.5px}.remito-date b{display:block;font-size:11px;color:#155fb8}.remito-date span{display:block;font-weight:900}
    .remito-body{display:grid;grid-template-columns:60mm 1fr;gap:4mm;flex:1;min-height:0}
    .remito-left{display:flex;flex-direction:column;min-height:0}.remito-grid div{display:grid;grid-template-columns:24mm 1fr;border-bottom:1px solid #bbb;padding:1.2mm}.remito-grid b{font-size:7px}.remito-grid span{font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .payment-box{margin-top:auto;border:1px solid #aaa}.payment-box div{display:grid;grid-template-columns:28mm 1fr;padding:1.5mm;border-bottom:1px solid #bbb}.payment-box div:last-child{border-bottom:0}.payment-box strong{font-size:11px;color:#155fb8}
    .remito-notes{border:1px dashed #aaa;min-height:20mm;margin:2mm 0 0;padding:2mm}
    .remito-right{display:flex;flex-direction:column;min-height:0}.remito-right table{font-size:7px}.remito-right th{background:#155fb8;color:#fff}.remito-right th:last-child,.remito-right td:last-child{width:22mm;text-align:center}.remito-right td{padding:.7mm 1mm}
    .remito-total{display:flex;justify-content:flex-end;gap:12mm;border:1px solid #777;border-top:0;padding:1.5mm 3mm;font-size:10px}.remito-total b{font-size:14px;color:#155fb8}
    .remito-sign{margin-top:auto;border:1px solid #aaa;border-radius:2mm;padding:2mm;display:grid;grid-template-columns:1fr 1fr;gap:2mm}.remito-sign span:last-child{grid-column:1/-1}
    .remito footer{text-align:center;background:#f2f6fc;border-radius:2mm;margin-top:2mm;padding:2mm;font-size:7.5px;font-style:italic}
    .cut-page{break-after:page;font-size:12px}.cut-page header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}.cut-page h1{font-size:20px;margin:0 0 4px}.cut-section{break-inside:avoid;margin-bottom:14px}.cut-section h2{font-size:15px;margin:0;background:#eee;padding:7px;border:1px solid #111}.cut-section p{font-size:10px;margin:5px 0;color:#444}.cut-section table{margin-top:0}.cut-section tfoot th{background:#f3f3f3}.cut-note{text-align:center;font-size:10px;margin-top:12px}
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
    const css=printStyles(1)+'.combined-sheet{break-after:auto!important;page-break-after:auto!important}'
    downloadHtmlAsJpg(`<div class="print-grid">${orderAndRemito(o)}</div>`,css,`pedido-completo-${o.number}.jpg`,1000)
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
