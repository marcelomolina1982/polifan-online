import html2canvas from 'html2canvas'

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
const money=v=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(v||0))
const pieces=o=>(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
const typeOf=o=>{
  const raw=String(o.deliveryType||o.carrier||'Logística')
  const k=raw.toLowerCase()
  if(k.includes('retiro')) return 'Retiro en el local'
  if(k.includes('correo')) return 'Correo Argentino'
  if(k.includes('via cargo')||k.includes('vía cargo')) return 'Vía Cargo'
  if(k.includes('otro')) return 'Otro expreso'
  return 'Logística'
}
const shippingData=o=>{
  const type=typeOf(o)
  if(type==='Retiro en el local') return `<p><b>Modalidad:</b> Retiro en el local</p>`
  return `<p><b>Modalidad:</b> ${esc(type)}${o.agencyDelivery?` · ${esc(o.agencyDelivery)}`:''}</p>
  <p><b>Domicilio:</b> ${esc(o.address||'-')}</p>
  ${o.betweenStreets?`<p><b>Entre calles:</b> ${esc(o.betweenStreets)}</p>`:''}
  <p><b>Localidad:</b> ${esc(o.locality||'-')}</p><p><b>Partido / Departamento:</b> ${esc(o.district||'-')}</p>
  <p><b>Provincia:</b> ${esc(o.province||'-')}</p><p><b>CP:</b> ${esc(o.postalCode||'-')}</p>`
}
export function receiptHtml(o){
  const shipping=Number(o.shippingCost||0)
  const products=Number(o.total||0)
  const grand=products+shipping
  const rows=(o.items||[]).filter(i=>i.figure&&Number(i.qty)>0).map(i=>`<tr><td>${esc(i.figure)}</td><td>${Number(i.qty)}</td></tr>`).join('')
  return `<div class="receipt">
   <header><img src="/logo-tu-vida-en-tinta.png"><div><small>TU VIDA EN TINTA · POLIFAN</small><h1>COMPROBANTE DE PEDIDO</h1><p>Pedido #${esc(o.number)} · ${esc(o.date||'')}</p></div></header>
   <section class="grid"><div><h3>DATOS DEL CLIENTE</h3><p><b>Nombre:</b> ${esc(o.client||[o.firstName,o.lastName].filter(Boolean).join(' '))}</p><p><b>Teléfono:</b> ${esc(o.phone||'-')}</p><p><b>DNI:</b> ${esc(o.dni||'-')}</p><p><b>Email:</b> ${esc(o.email||'-')}</p></div><div><h3>ENTREGA</h3>${shippingData(o)}</div></section>
   <h3 class="detail-title">DETALLE COMPLETO DEL PEDIDO</h3>
   <table><thead><tr><th>FIGURA</th><th>CANTIDAD</th></tr></thead><tbody>${rows}</tbody></table>
   <div class="piece-total">${pieces(o)} PIEZAS EN TOTAL</div>
   <section class="totals"><p><span>Productos</span><b>${money(products)}</b></p><p><span>Costo de envío</span><b>${shipping?money(shipping):'Sin costo / no cargado'}</b></p><p><span>Estado del envío</span><b>${esc(o.shippingPaid||'Pendiente de pago')}</b></p><p class="grand"><span>TOTAL FINAL</span><b>${money(grand)}</b></p></section>
   ${o.notes?`<div class="notes"><b>Observaciones</b><p>${esc(o.notes)}</p></div>`:''}
   <footer><b>Por favor, corroborá que tus datos y todas las piezas del pedido estén correctos.</b><span>Si encontrás algún error, avisanos antes del despacho.</span></footer>
  </div>`
}
export const receiptCss=`*{box-sizing:border-box}body{margin:0;background:#fff;font-family:Arial,sans-serif;color:#172033}.receipt{width:900px;min-height:1150px;padding:48px;background:#fff}.receipt header{display:flex;gap:20px;align-items:center;border-bottom:5px solid #1d5fbf;padding-bottom:22px}.receipt header img{width:105px;height:105px;object-fit:contain}.receipt h1{margin:4px 0;font-size:34px;color:#1d5fbf}.receipt header p,.receipt header small{margin:0;font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:24px 0}.grid>div{background:#f5f8fc;border:1px solid #ccd7e7;border-radius:16px;padding:18px}.grid h3,.detail-title{color:#1d5fbf;margin:0 0 12px}.grid p{margin:7px 0}.receipt table{width:100%;border-collapse:collapse;font-size:18px}.receipt th{background:#1d5fbf;color:white;text-align:left}.receipt th,.receipt td{padding:10px 13px;border:1px solid #c7d1df}.receipt th:last-child,.receipt td:last-child{text-align:center;width:160px}.piece-total{text-align:right;font-weight:900;font-size:20px;margin:14px 0}.totals{margin-left:auto;width:410px;border:1px solid #c7d1df;border-radius:14px;padding:14px}.totals p{display:flex;justify-content:space-between;margin:8px}.totals .grand{background:#1d5fbf;color:white;padding:14px;border-radius:9px;font-size:21px}.notes{margin-top:20px;background:#f5f8fc;padding:15px;border-radius:12px}.receipt footer{margin-top:28px;padding:20px;text-align:center;background:linear-gradient(90deg,#fff0f5,#eef7ff);border-radius:14px}.receipt footer b,.receipt footer span{display:block}.receipt footer span{margin-top:7px}`
export async function downloadOrderReceiptJpg(order){
  const host=document.createElement('div')
  host.style.cssText='position:fixed;left:-10000px;top:0;background:#fff;z-index:-1'
  host.innerHTML=`<style>${receiptCss}</style>${receiptHtml(order)}`
  document.body.appendChild(host)
  try{
    await new Promise(r=>setTimeout(r,180))
    const canvas=await html2canvas(host.querySelector('.receipt'),{scale:1.5,useCORS:true,backgroundColor:'#ffffff'})
    const a=document.createElement('a');a.download=`comprobante-pedido-${order.number}.jpg`;a.href=canvas.toDataURL('image/jpeg',.94);a.click()
  }finally{host.remove()}
}
