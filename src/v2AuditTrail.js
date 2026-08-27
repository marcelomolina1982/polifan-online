const CACHE_KEY='polifan-v2-section-cache'
const DRAWER_CLASS='v2-audit-drawer'
const readCache=()=>{try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')?.data||{}}catch{return{}}}
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))
const fmt=iso=>{try{return new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short'}).format(new Date(iso))}catch{return iso||'-'}}
function ensureDrawer(){
 if(document.querySelector('.'+DRAWER_CLASS))return
 const el=document.createElement('aside');el.className=DRAWER_CLASS;el.innerHTML='<div class="v2-audit-drawer-head"><div><small>TRAZABILIDAD</small><h3>Historial del pedido</h3></div><button type="button" class="v2-audit-close">×</button></div><div class="v2-audit-drawer-body"></div>'
 document.body.appendChild(el);el.querySelector('.v2-audit-close').addEventListener('click',()=>el.classList.remove('open'))
}
function renderOrderHistory(number){
 ensureDrawer();const drawer=document.querySelector('.'+DRAWER_CLASS),body=drawer.querySelector('.v2-audit-drawer-body'),db=readCache()
 const order=(db.orders||[]).find(o=>String(o.number)===String(number));const id=order?.id
 const rows=(db.auditLog||[]).filter(x=>String(x.orderId||'')===String(id||'')||String(x.orderNumber||'')===String(number)).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')))
 body.innerHTML=`<div class="v2-audit-order"><b>Pedido #${esc(number)}</b><span>${esc(order?.client||'')}</span></div>${rows.length?rows.map(x=>`<article class="v2-audit-event"><span class="dot"></span><div><b>${esc(x.action||'Cambio')}</b><p>${esc(x.detail||'')}</p><small>${esc(x.actor||'Usuario')} · ${esc(fmt(x.at))}</small></div></article>`).join(''):'<div class="v2-audit-empty"><b>Sin historial todavía</b><span>Los próximos cambios de este pedido quedarán registrados acá.</span></div>'}`
 drawer.classList.add('open')
}
function decorateRows(){
 const tables=[...document.querySelectorAll('main table')]
 tables.forEach(table=>{const headers=[...table.querySelectorAll('thead th')].map(x=>x.textContent.trim().toLowerCase());if(!headers.includes('pedido')||!headers.includes('acciones'))return
  table.querySelectorAll('tbody tr').forEach(row=>{if(row.querySelector('.v2-history-btn'))return;const cells=row.querySelectorAll('td');if(!cells.length)return;const number=[...cells].map(x=>x.textContent.trim()).find(t=>/^#?\d+$/.test(t));const actions=row.querySelector('.row-actions')||cells[cells.length-1];if(!number||!actions)return;const btn=document.createElement('button');btn.type='button';btn.className='ghost v2-history-btn';btn.textContent='Historial';btn.addEventListener('click',e=>{e.stopPropagation();renderOrderHistory(number.replace('#',''))});actions.appendChild(btn)})
 })
}
let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorateRows()})}
const obs=new MutationObserver(schedule);obs.observe(document.documentElement,{subtree:true,childList:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{ensureDrawer();schedule()});else{ensureDrawer();schedule()}
