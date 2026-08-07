import html2canvas from 'html2canvas'

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
const money=v=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(v||0))
const pieces=q=>(q.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
const deliveryType=q=>String(q.deliveryType||q.carrier||q.customer?.method||'A coordinar')

export function quoteHtml(q){
  const rows=(q.items||[]).filter(i=>(i.figure||i.name)&&Number(i.qty)>0).map(i=>`<tr><td>${esc(i.figure||i.name)}</td><td>${esc(i.measure||'')}</td><td>${Number(i.qty)}</td></tr>`).join('')
  const fullName=esc(q.client||q.customer?.name||[q.firstName,q.lastName].filter(Boolean).join(' ')||'-')
  return `<div class="quote-receipt">
    <header><img src="/logo-tu-vida-en-tinta.png"><div><small>TU VIDA EN TINTA · POLIFAN</small><h1>PRESUPUESTO</h1><p>${esc(q.code)} · ${esc(q.date||'')}</p></div></header>
    <section class="quote-banner"><b>DETALLE DEL PRESUPUESTO</b><span>Este documento no ingresa a producción hasta que el cliente lo apruebe.</span></section>
    <section class="quote-grid">
      <div><h3>CLIENTE</h3><p><b>Nombre:</b> ${fullName}</p><p><b>WhatsApp:</b> ${esc(q.phone||q.customer?.phone||'-')}</p><p><b>Email:</b> ${esc(q.email||q.customer?.email||'-')}</p></div>
      <div><h3>ENTREGA</h3><p><b>Modalidad:</b> ${esc(deliveryType(q))}</p>${q.locality||q.customer?.locality?`<p><b>Localidad:</b> ${esc(q.locality||q.customer?.locality)}</p>`:''}${q.province||q.customer?.province?`<p><b>Provincia:</b> ${esc(q.province||q.customer?.province)}</p>`:''}<p><b>Envío:</b> se coordina por separado.</p></div>
    </section>
    <h3 class="quote-detail-title">PRODUCTOS</h3>
    <table><thead><tr><th>FIGURA / PRODUCTO</th><th>MEDIDA</th><th>CANTIDAD</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="quote-pieces">${pieces(q)} PIEZAS EN TOTAL</div>
    <section class="quote-total"><span>TOTAL PRODUCTOS</span><b>${money(q.total)}</b></section>
    ${q.notes?`<div class="quote-notes"><b>OBSERVACIONES</b><p>${esc(q.notes)}</p></div>`:''}
    <footer><b>Para aprobar este presupuesto, respondé por WhatsApp.</b><span>El costo y la modalidad del envío se confirman aparte cuando corresponda.</span></footer>
  </div>`
}

export const quoteCss=`*{box-sizing:border-box}body{margin:0;background:#fff;font-family:Arial,sans-serif;color:#172033}.quote-receipt{width:900px;min-height:1050px;padding:44px;background:#fff}.quote-receipt header{display:flex;gap:20px;align-items:center;border-bottom:5px solid #6941c6;padding-bottom:20px}.quote-receipt header img{width:98px;height:98px;object-fit:contain}.quote-receipt h1{margin:4px 0;font-size:36px;color:#6941c6}.quote-receipt header p,.quote-receipt header small{margin:0;font-weight:700}.quote-banner{margin:20px 0 12px;padding:15px 18px;border-radius:14px;background:#f4efff;border:2px solid #c8b6f0;text-align:center}.quote-banner b,.quote-banner span{display:block}.quote-banner span{margin-top:5px}.quote-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.quote-grid>div{background:#f7f7fb;border:1px solid #d9dbe7;border-radius:15px;padding:16px}.quote-grid h3,.quote-detail-title{color:#6941c6;margin:0 0 10px}.quote-grid p{margin:6px 0}.quote-receipt table{width:100%;border-collapse:collapse;font-size:17px}.quote-receipt th{background:#6941c6;color:#fff;text-align:left}.quote-receipt th,.quote-receipt td{padding:9px 12px;border:1px solid #d0d4df}.quote-receipt th:nth-child(2),.quote-receipt td:nth-child(2){width:180px}.quote-receipt th:last-child,.quote-receipt td:last-child{text-align:center;width:130px}.quote-pieces{text-align:right;font-weight:900;font-size:19px;margin:12px 0}.quote-total{margin-left:auto;width:400px;display:flex;justify-content:space-between;align-items:center;background:#6941c6;color:#fff;padding:17px 18px;border-radius:13px;font-size:22px}.quote-notes{margin-top:16px;background:#f7f7fb;padding:14px;border-radius:12px}.quote-receipt footer{margin-top:25px;padding:18px;text-align:center;background:linear-gradient(90deg,#f7efff,#eef5ff);border-radius:14px}.quote-receipt footer b,.quote-receipt footer span{display:block}.quote-receipt footer span{margin-top:6px}`

export async function downloadQuoteJpg(quote){
  const host=document.createElement('div')
  host.style.cssText='position:fixed;left:-10000px;top:0;background:#fff;z-index:-1'
  host.innerHTML=`<style>${quoteCss}</style>${quoteHtml(quote)}`
  document.body.appendChild(host)
  try{
    await new Promise(r=>setTimeout(r,180))
    const canvas=await html2canvas(host.querySelector('.quote-receipt'),{scale:1.5,useCORS:true,backgroundColor:'#ffffff'})
    const a=document.createElement('a');a.download=`presupuesto-${String(quote.code||'cliente').replace(/[^a-z0-9_-]+/gi,'-')}.jpg`;a.href=canvas.toDataURL('image/jpeg',.94);a.click()
  }finally{host.remove()}
}
