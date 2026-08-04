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

function formatDelivery(value){return deliveryParts(value).date}
function totalPieces(o){return (o.items||[]).reduce((sum,item)=>sum+Number(item.qty||0),0)}
function orderAddress(o){return o.address||o.customer?.address||o.shippingAddress||'-'}
function orderLocality(o){return o.locality||o.customer?.locality||o.city||o.zone||'-'}
function orderProvince(o){return o.province||o.customer?.province||'-'}
function orderPostalCode(o){return o.postalCode||o.customer?.postalCode||o.cp||'-'}
function orderShipping(o){return Number(o.shippingCost||o.deliveryCost||o.shipping||0)||0}
function orderEmail(o){return o.email||o.customer?.email||'-'}
function orderBetweenStreets(o){return o.betweenStreets||o.customer?.betweenStreets||'-'}
function deliveryType(o){
  const raw=String(o.deliveryType||o.carrier||'Logística')
  const key=raw.toLocaleLowerCase('es')
  if(key.includes('retiro')) return 'Retiro en el local'
  if(key.includes('via cargo')||key.includes('vía cargo')||key.includes('correo argentino')) return 'Vía Cargo / Correo Argentino'
  return 'Logística'
}

const BOX_OPTIONS=[
  {name:'Caja 30×20×20 cm',capacity:6},
  {name:'Caja 40×30×30 cm',capacity:12},
  {name:'Caja Vía Cargo',capacity:20,note:'apta para cualquier expreso'},
  {name:'Caja 50×40×30 cm',capacity:24},
  {name:'Caja 50×40×40 cm',capacity:36},
  {name:'Caja 60×40×40 cm',capacity:48}
]
function singleBoxFor(qty){return BOX_OPTIONS.find(box=>qty<=box.capacity)||BOX_OPTIONS[BOX_OPTIONS.length-1]}
function packagingFor(qty){
  let remaining=Math.max(0,Number(qty)||0)
  if(!remaining) return {summary:'Sin caja asignada',parts:[],film:true}
  const parts=[]
  while(remaining>48){parts.push({...BOX_OPTIONS[5],qty:1});remaining-=48}
  if(remaining>0){const box=singleBoxFor(remaining);parts.push({...box,qty:1})}
  const grouped=[]
  parts.forEach(part=>{const found=grouped.find(x=>x.name===part.name);if(found) found.qty+=1;else grouped.push({...part})})
  const summary=grouped.map(p=>`${p.qty>1?p.qty+' × ':''}${p.name}`).join(' + ')
  return {summary,parts:grouped,film:true}
}

function itemSummaryHtml(o){
  const items=(o.items||[]).filter(i=>i.figure&&Number(i.qty||0)>0)
  const count=items.length
  const columns=count>48?5:count>32?4:count>18?3:2
  const density=count>48?'mega':count>32?'ultra':count>18?'dense':''
  const lines=items.map(i=>`<div><span>${esc(i.figure)}</span><b>x ${Number(i.qty||0)}</b></div>`).join('')
  return `<div class="summary-list ${density}" style="--summary-columns:${columns}">${lines}</div>`
}


function internalShippingHtml(o){
  const type=deliveryType(o)
  if(type==='Retiro en el local') return `<b>RETIRO EN EL LOCAL</b><span><strong>Nombre:</strong> ${esc(o.client)}</span><span><strong>Teléfono:</strong> ${esc(o.phone||'-')}</span>`
  if(type==='Vía Cargo / Correo Argentino') return `<b>VÍA CARGO / CORREO ARGENTINO</b><span><strong>Nombre:</strong> ${esc(o.client)}</span><span><strong>DNI:</strong> ${esc(o.dni||'-')}</span><span><strong>Domicilio:</strong> ${esc(orderAddress(o))}</span><span><strong>CP / Localidad:</strong> ${esc(orderPostalCode(o))} · ${esc(orderLocality(o))}</span><span><strong>Provincia:</strong> ${esc(orderProvince(o))}</span><span><strong>Teléfono:</strong> ${esc(o.phone||'-')}</span><span><strong>Email:</strong> ${esc(orderEmail(o))}</span><span><strong>Modalidad:</strong> ${esc(o.agencyDelivery||'A confirmar')}</span>`
  return `<b>LOGÍSTICA</b><span><strong>Nombre:</strong> ${esc(o.client)}</span><span><strong>Domicilio:</strong> ${esc(orderAddress(o))}</span><span><strong>Entre calles:</strong> ${esc(orderBetweenStreets(o))}</span><span><strong>Localidad / CP:</strong> ${esc(orderLocality(o))} · ${esc(orderPostalCode(o))}</span><span><strong>Teléfono:</strong> ${esc(o.phone||'-')}</span><span><strong>Email:</strong> ${esc(orderEmail(o))}</span>`
}

function internalOrderHtml(o){
  const pieces=totalPieces(o)
  const delivery=deliveryParts(o.delivery)
  const models=(o.items||[]).filter(i=>i.figure&&Number(i.qty||0)>0).length
  const packaging=packagingFor(pieces)
  return `<section class="internal-order">
    <div class="internal-side ${esc(delivery.dayClass)}">PEDIDO INTERNO</div>
    <div class="internal-body">
      <div class="mini-brand"><img src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta"><div><b>TU VIDA EN TINTA</b><small>POLIFAN</small></div></div>
      <div class="internal-title">PEDIDO INTERNO</div>
      <div class="internal-delivery ${esc(delivery.dayClass)}"><small>DÍA DE ENTREGA</small><strong>${esc(delivery.day)}</strong><span>${esc(delivery.date)}</span></div>
      <div class="internal-client"><div><small>CLIENTE</small><b>${esc(o.client)}</b></div><div><small>PEDIDO</small><b>#${esc(o.number)}</b></div></div>
      <div class="internal-kpis"><div><small>TOTAL DE PIEZAS</small><b>${pieces}</b><span>PIEZAS</span></div><div><small>MODELOS DISTINTOS</small><b>${models}</b><span>MODELOS</span></div><div class="box-kpi"><small>CAJA A UTILIZAR</small><b>${esc(packaging.summary)}</b><span>+ FILM NEGRO</span></div></div>
      <div class="internal-shipping">${internalShippingHtml(o)}</div>
      <div class="summary-title">LISTADO COMPLETO DE FIGURAS</div>${itemSummaryHtml(o)}
      <div class="internal-foot"><div class="internal-notes"><b>Observaciones:</b> ${esc(o.notes||'-')}</div><div class="internal-qr"><img src="${qrImageUrl(o)}" alt="QR"><small>Controlar piezas desde el celular</small></div></div>
    </div>
  </section>`
}

function qrImageUrl(o){
  const target=`${window.location.origin}${window.location.pathname}?control=${encodeURIComponent(o.id)}`
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(target)}`
}

function boxLabelHtml(o){
  const pieces=totalPieces(o)
  const delivery=deliveryParts(o.delivery)
  const packaging=packagingFor(pieces)
  return `<section class="box-label">
    <div class="label-head"><div class="label-day ${esc(delivery.dayClass)}">${esc(delivery.day)}</div><div class="label-date">${esc(delivery.date)}</div></div>
    <div class="label-brand"><img src="/logo-tu-vida-en-tinta.png" alt=""><div><b>TU VIDA EN TINTA</b><small>Pedido #${esc(o.number)}</small></div></div>
    <div class="label-client">${esc(o.client)}</div>
    <div class="label-data">
      <div><b>Dirección</b><span>${esc(orderAddress(o))}</span></div>
      ${orderBetweenStreets(o)!=='-'?`<div><b>Entre calles</b><span>${esc(orderBetweenStreets(o))}</span></div>`:''}
      <div><b>Localidad / Provincia</b><span>${esc(orderLocality(o))} · ${esc(orderProvince(o))}</span></div>
      <div><b>Código postal</b><span>${esc(orderPostalCode(o))}</span></div>
      <div><b>Teléfono</b><span>${esc(o.phone||'-')}</span></div>
      <div><b>Email</b><span>${esc(orderEmail(o))}</span></div>
      <div><b>Tipo de entrega</b><span>${esc(deliveryType(o))}${o.agencyDelivery?` · ${esc(o.agencyDelivery)}`:''}</span></div>
      <div><b>Embalaje</b><span>${esc(packaging.summary)}</span></div>
    </div>
    <div class="label-bottom"><div class="label-pieces"><b>${pieces}</b><span>PIEZAS</span></div><div class="fragile"><b>FRÁGIL</b><span>Manipular con cuidado</span></div><div class="qr"><img src="${qrImageUrl(o)}" alt="QR"><small>Escaneá para consultar</small></div></div>
  </section>`
}

function pricedRows(o,items){
  const pieces=totalPieces(o)
  const shipping=orderShipping(o)
  const productTotal=Math.max(0,Number(o.total||0)-shipping)
  const fallbackUnit=pieces?productTotal/pieces:0
  return items.map(i=>{
    const qty=Number(i.qty||0)
    const unit=Number(i.unitPrice||i.price||fallbackUnit)||0
    const subtotal=unit*qty
    return `<tr><td>${esc(i.figure)}</td><td>${qty}</td><td>${money(unit)}</td><td>${money(subtotal)}</td></tr>`
  }).join('')
}

function purchaseDetailHtml(o){
  const all=(o.items||[]).filter(i=>i.figure&&Number(i.qty||0)>0)
  const main=all.slice(0,17)
  const extra=all.slice(17)
  const pieces=totalPieces(o)
  const shipping=orderShipping(o)
  const subtotal=Math.max(0,Number(o.total||0)-shipping)
  const delivery=deliveryParts(o.delivery)
  const mainHtml=`<section class="purchase-detail ${all.length>14?'compact-rows':''}">
    <div class="purchase-head"><div class="invoice-brand"><img src="/logo-tu-vida-en-tinta.png" alt=""><div><b>TU VIDA EN TINTA</b><small>POLIFAN · COMPROBANTE DE PEDIDO</small></div></div><div><h2>DETALLE DE COMPRA</h2><b>N° ${esc(o.number)}</b></div><div class="invoice-date"><small>FECHA DE SALIDA</small><b>${esc(delivery.date)}</b><span>${esc(delivery.day)}</span></div></div>
    <div class="purchase-grid"><div class="customer-card"><h3>DATOS DEL CLIENTE</h3><p><b>Cliente:</b> ${esc(o.client)}</p><p><b>Teléfono:</b> ${esc(o.phone||'-')}</p><p><b>Email:</b> ${esc(orderEmail(o))}</p><p><b>Dirección:</b> ${esc(orderAddress(o))}</p><p><b>Localidad:</b> ${esc(orderLocality(o))}</p><p><b>Provincia:</b> ${esc(orderProvince(o))}</p><p><b>Código postal:</b> ${esc(orderPostalCode(o))}</p><p><b>Transporte:</b> ${esc(o.carrier||'-')}</p></div>
    <div class="invoice-table-wrap"><table class="invoice-table"><thead><tr><th>FIGURA</th><th>CANT.</th><th>PRECIO UNIT.</th><th>SUBTOTAL</th></tr></thead><tbody>${pricedRows(o,main)}</tbody></table>${extra.length?`<div class="continued-note">+ ${extra.length} modelo${extra.length===1?'':'s'} en la hoja de continuación</div>`:''}</div></div>
    <div class="purchase-bottom"><div class="payment-card"><h3>FORMA DE PAGO</h3><p><b>SEÑA / PAGÓ</b><span>${o.deposit?money(o.deposit):'$ __________'}</span></p><p><b>SALDO</b><span>${o.balance?money(o.balance):'$ __________'}</span></p></div><div class="observations"><b>OBSERVACIONES</b><p>${esc(o.notes||'-')}</p></div><div class="totals"><p><span>Subtotal</span><b>${money(subtotal)}</b></p><p><span>Envío</span><b>${shipping?money(shipping):'A cotizar'}</b></p><p class="grand-total"><span>TOTAL</span><b>${money(o.total)}</b></p></div></div>
    <footer class="invoice-footer"><span>♥ ¡Gracias por confiar en Tu Vida En Tinta!</span><span>WhatsApp 11-5919-2358</span><span>@tuvidaentinta</span></footer>
  </section>`
  if(!extra.length) return mainHtml
  const continuation=`<section class="invoice-continuation"><div class="purchase-head"><div class="invoice-brand"><img src="/logo-tu-vida-en-tinta.png" alt=""><div><b>TU VIDA EN TINTA</b><small>CONTINUACIÓN DEL DETALLE</small></div></div><div><h2>PEDIDO #${esc(o.number)}</h2><b>${esc(o.client)}</b></div></div><table class="invoice-table"><thead><tr><th>FIGURA</th><th>CANT.</th><th>PRECIO UNIT.</th><th>SUBTOTAL</th></tr></thead><tbody>${pricedRows(o,extra)}</tbody></table><div class="continuation-total">Total de piezas: <b>${pieces}</b> · Total del pedido: <b>${money(o.total)}</b></div></section>`
  return mainHtml+continuation
}

function orderAndRemito(o){return `<div class="combined-sheet"><div class="top-print-row">${internalOrderHtml(o)}<div class="vertical-cut">✂</div>${boxLabelHtml(o)}</div><div class="horizontal-cut">✂</div>${purchaseDetailHtml(o)}</div>`}

async function downloadHtmlAsJpg(bodyHtml,css,filename,width=1100){
  const frame=document.createElement('iframe')
  frame.setAttribute('aria-hidden','true')
  frame.style.position='fixed';frame.style.left='-10000px';frame.style.top='0';frame.style.width=width+'px';frame.style.height='1700px';frame.style.border='0';frame.style.background='#fff'
  document.body.appendChild(frame)
  const doc=frame.contentDocument
  doc.open();doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${css}html,body{background:#fff!important}body{padding:12px}</style></head><body>${bodyHtml}</body></html>`);doc.close()
  await new Promise(resolve=>setTimeout(resolve,600))
  try{
    const target=doc.body;frame.style.height=Math.max(800,target.scrollHeight+40)+'px'
    const canvas=await html2canvas(target,{backgroundColor:'#ffffff',scale:2,useCORS:true,logging:false,width:target.scrollWidth,height:target.scrollHeight})
    const link=document.createElement('a');link.download=filename;link.href=canvas.toDataURL('image/jpeg',0.95);link.click()
  }catch(error){console.error(error);alert('No se pudo generar el JPG. Intentá nuevamente.')}finally{frame.remove()}
}

function labelHtml(o){return boxLabelHtml(o)}
function labelStyles(){return printStyles(1)+'.box-label{width:100mm;height:95mm;margin:0 auto}'}

function printStyles(){return `
@page{size:A4 portrait;margin:5mm}*{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;color:#121212;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-grid{display:block}.combined-sheet{width:200mm;min-height:287mm;margin:0 auto;break-after:page;page-break-after:always}.combined-sheet:last-child{break-after:auto}.top-print-row{height:137mm;display:grid;grid-template-columns:123mm 2mm 75mm;gap:0}.vertical-cut{border-left:1px dashed #777;display:flex;align-items:flex-start;justify-content:center;font-size:11px;padding-top:2mm}.horizontal-cut{height:4mm;border-top:1px dashed #777;text-align:left;font-size:11px;line-height:3mm}.internal-order,.box-label,.purchase-detail,.invoice-continuation{border:1px solid #b8c1d1;border-radius:3mm;background:#fff;overflow:hidden}.internal-order{display:grid;grid-template-columns:9mm 1fr;height:137mm}.internal-side{writing-mode:vertical-rl;transform:rotate(180deg);display:flex;align-items:center;justify-content:center;font-weight:900;letter-spacing:.5px}.internal-body{padding:3mm 4mm;display:flex;flex-direction:column;min-width:0}.mini-brand,.label-brand,.invoice-brand{display:flex;align-items:center;gap:2mm}.mini-brand img,.label-brand img,.invoice-brand img{width:15mm;height:15mm;object-fit:contain}.mini-brand b,.label-brand b,.invoice-brand b{display:block;font-size:13px}.mini-brand small,.label-brand small,.invoice-brand small{display:block;font-size:8px;font-weight:700}.internal-title{position:absolute;margin-left:78mm;margin-top:1mm;background:#111;color:#fff;padding:1mm 3mm;border-radius:2mm;font-size:9px;font-weight:900}.internal-delivery{text-align:center;border-radius:2mm;padding:2mm;margin:2mm 0}.internal-delivery small{display:block;font-size:8px;font-weight:900}.internal-delivery strong{display:block;font-size:29px;line-height:1}.internal-delivery span{font-size:15px;font-weight:900}.day-monday{background:#2eaf63;color:#fff}.day-tuesday{background:#2f70d0;color:#fff}.day-wednesday{background:#f3d43b;color:#111}.day-thursday{background:#ee8a2f;color:#111}.day-friday{background:#d94343;color:#fff}.day-saturday{background:#8a55c5;color:#fff}.day-sunday,.day-none{background:#e5e5e5;color:#111}.internal-client{display:grid;grid-template-columns:1fr 33mm;border-bottom:1px solid #bbb;padding-bottom:2mm}.internal-client small,.internal-kpis small{display:block;font-size:7px;font-weight:900}.internal-client b{font-size:16px}.internal-client>div:last-child{text-align:center;border-left:1px solid #bbb}.internal-kpis{display:grid;grid-template-columns:28mm 29mm 1fr;gap:2mm;margin:2mm 0}.internal-kpis>div{border-right:1px solid #ccc;text-align:center}.internal-kpis>div:last-child{border:0}.internal-kpis b{display:block;font-size:24px;line-height:1}.internal-kpis span{display:inline-block;background:#1d5fbf;color:#fff;padding:.5mm 2mm;border-radius:1mm;font-size:7px;font-weight:900}.internal-kpis .box-kpi b{font-size:10px;line-height:1.15;margin:2mm 0}.internal-kpis .box-kpi span{background:#111}.summary-title{text-align:center;font-size:8px;font-weight:900;background:#111;color:#fff;border-radius:2mm;padding:.7mm}.summary-list{display:grid;grid-template-columns:1fr 1fr;column-gap:5mm;row-gap:.2mm;font-size:8px;border:1px solid #aaa;border-radius:2mm;padding:1.5mm;margin-top:1mm;min-height:31mm}.summary-list>div{display:flex;justify-content:space-between;border-bottom:1px dotted #bbb}.summary-more{grid-column:1/-1;font-weight:900;justify-content:center!important;border:0!important}.internal-shipping{display:grid;grid-template-columns:1fr 1fr;gap:.4mm 2mm;border:1px solid #b9c6d8;background:#f7f9fc;border-radius:2mm;padding:1.2mm;font-size:6.5px;margin:1mm 0}.internal-shipping>b{grid-column:1/-1;color:#1d5fbf;font-size:7px}.internal-shipping span{white-space:normal}.internal-shipping strong{font-size:6px}.internal-foot{display:grid;grid-template-columns:1fr 18mm;gap:1mm;align-items:end;margin-top:auto}.internal-qr{text-align:center;font-size:5px}.internal-qr img{width:16mm;height:16mm}.internal-qr small{display:block}.summary-list.dense{font-size:6.5px;line-height:1.05}.summary-list.ultra{font-size:5.3px;line-height:1}.summary-list.mega{font-size:4.3px;line-height:.95;padding:.8mm}.summary-list{grid-template-columns:repeat(var(--summary-columns,2),1fr);min-height:0;max-height:47mm;overflow:visible}.internal-notes{margin-top:0;border:1px solid #ccd5e3;background:#f4f7fb;border-radius:2mm;padding:1.5mm;font-size:8px;min-height:10mm}.box-label{height:137mm;padding:4mm;display:flex;flex-direction:column}.label-head{border:1px solid #aaa;border-radius:3mm;overflow:hidden;text-align:center}.label-day{font-size:25px;font-weight:900;padding:2mm}.label-date{font-size:14px;font-weight:900;padding:1mm}.label-brand{margin:3mm 0 1mm}.label-client{font-size:23px;font-weight:900;border-bottom:1px solid #aaa;padding-bottom:2mm}.label-data{display:grid;grid-template-columns:1fr;gap:1mm;margin-top:2mm;font-size:9px}.label-data div{display:grid;grid-template-columns:25mm 1fr;border-bottom:1px dotted #bbb;padding:.8mm}.label-data b{font-size:7px;text-transform:uppercase}.label-bottom{display:grid;grid-template-columns:20mm 1fr 22mm;gap:2mm;align-items:center;margin-top:auto}.label-pieces{text-align:center;border:1px solid #aaa;border-radius:2mm;padding:1mm}.label-pieces b{display:block;font-size:23px;color:#e72d62}.label-pieces span{font-size:8px;font-weight:900}.fragile{border:1px solid #e72d62;color:#e72d62;border-radius:2mm;padding:2mm;text-align:center}.fragile b{display:block;font-size:14px}.fragile span{font-size:8px;color:#222}.qr{text-align:center}.qr img{width:20mm;height:20mm}.qr small{display:block;font-size:6px}.purchase-detail{height:146mm;padding:3mm 4mm;display:flex;flex-direction:column}.purchase-head{display:grid;grid-template-columns:1fr 1fr 42mm;align-items:center;border-bottom:2px solid #1d5fbf;padding-bottom:2mm}.purchase-head h2{margin:0;color:#1d5fbf;font-size:16px}.purchase-head>div:nth-child(2){text-align:center}.invoice-date{border:1px solid #b9c6d8;background:#f4f7fb;border-radius:2mm;padding:2mm;text-align:center}.invoice-date small{display:block;font-size:7px}.invoice-date b{display:block;font-size:11px}.invoice-date span{font-size:10px;font-weight:900;color:#1d5fbf}.purchase-grid{display:grid;grid-template-columns:52mm 1fr;gap:4mm;margin-top:2mm;min-height:83mm}.customer-card{background:#f4f7fb;border:1px solid #c7d1df;border-radius:2mm;padding:2mm;font-size:8px}.customer-card h3,.payment-card h3{font-size:8px;color:#1d5fbf;text-align:center;margin:0 0 1mm}.customer-card p{margin:1.2mm 0}.invoice-table{width:100%;border-collapse:collapse;font-size:8px}.invoice-table th{background:#1d5fbf;color:#fff}.invoice-table th,.invoice-table td{border:1px solid #aeb8c8;padding:1mm}.invoice-table th:nth-child(2),.invoice-table td:nth-child(2){width:13%;text-align:center}.invoice-table th:nth-child(3),.invoice-table td:nth-child(3),.invoice-table th:nth-child(4),.invoice-table td:nth-child(4){width:22%;text-align:right}.compact-rows .invoice-table{font-size:7px}.compact-rows .invoice-table th,.compact-rows .invoice-table td{padding:.65mm}.continued-note{text-align:center;font-size:7px;font-weight:900;padding:1mm;background:#fff3cd}.purchase-bottom{display:grid;grid-template-columns:50mm 1fr 57mm;gap:4mm;margin-top:auto}.payment-card,.observations,.totals{border:1px solid #c7d1df;border-radius:2mm;padding:2mm;font-size:8px}.payment-card p,.totals p{display:flex;justify-content:space-between;margin:1.5mm 0}.observations p{margin:2mm 0}.grand-total{background:#1d5fbf;color:#fff;padding:2mm;border-radius:1mm;font-size:12px}.invoice-footer{display:flex;justify-content:space-between;align-items:center;background:linear-gradient(90deg,#fff0f5,#eef7ff);padding:2mm 3mm;margin-top:2mm;font-size:8px;border-radius:2mm}.invoice-footer span:first-child{font-weight:900;font-size:10px}.invoice-continuation{padding:6mm;break-before:page;page-break-before:always;min-height:270mm}.invoice-continuation .purchase-head{grid-template-columns:1fr 1fr}.invoice-continuation .invoice-table{margin-top:8mm;font-size:10px}.continuation-total{text-align:right;font-size:13px;margin-top:5mm}.cut-page{break-after:page}.cut-page table{width:100%;border-collapse:collapse}.cut-page th,.cut-page td{border:1px solid #111;padding:4px}@media print{body{display:block}}
`}


export default function Orders({db,onSave,onEdit}){
  const [q,setQ]=useState('')
  const [status,setStatus]=useState('')
  const [sort,setSort]=useState('delivery-asc')
  const [selected,setSelected]=useState([])

  const list=useMemo(()=>{
    const term=q.trim().toLowerCase()
    const filtered=db.orders.filter(o=>{
      const delivery=formatDelivery(o.delivery||'')
      const day=deliveryParts(o.delivery).day
      const haystack=(o.client+' '+o.phone+' '+o.number+' '+(o.delivery||'')+' '+delivery+' '+day+' '+(o.items||[]).map(i=>i.figure).join(' ')).toLowerCase()
      return haystack.includes(term) && (!status || o.status===status)
    })
    return filtered.slice().sort((a,b)=>{
      if(sort==='delivery-desc') return String(b.delivery||'').localeCompare(String(a.delivery||'')) || Number(b.number||0)-Number(a.number||0)
      if(sort==='number-desc') return Number(b.number||0)-Number(a.number||0)
      if(sort==='number-asc') return Number(a.number||0)-Number(b.number||0)
      return String(a.delivery||'9999-12-31').localeCompare(String(b.delivery||'9999-12-31')) || Number(a.number||0)-Number(b.number||0)
    })
  },[db.orders,q,status,sort])

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
    const css=printStyles()
    downloadHtmlAsJpg(`<div class="print-grid">${orderAndRemito(o)}</div>`,css,`pedido-completo-${o.number}.jpg`,1100)
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
      <input placeholder="Buscar cliente, teléfono, número, figura o fecha de salida…" value={q} onChange={e=>setQ(e.target.value)}/>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select>
      <select value={sort} onChange={e=>setSort(e.target.value)}><option value="delivery-asc">Salida: más próxima primero</option><option value="delivery-desc">Salida: más lejana primero</option><option value="number-desc">Pedido: más nuevo primero</option><option value="number-asc">Pedido: más antiguo primero</option></select>
    </div>

    <div className="panel bulk-toolbar">
      <div><b>{selected.length} pedido{selected.length===1?'':'s'} seleccionado{selected.length===1?'':'s'}</b><small>Cada pedido se imprime en una hoja A4: pedido interno, etiqueta para la caja y detalle de compra.</small></div>
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
          <button className="ghost" onClick={()=>onEdit(o)}>Editar</button>
          <button className="danger" onClick={()=>remove(o.id)}>Eliminar</button>
        </td></tr>)}</tbody>
    </table></div>
  </>
}
