const CACHE_KEY='polifan-v2-section-cache'
const readDb=()=>{try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')?.data||{}}catch{return{}}}
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))
const fmt=iso=>{try{return new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short'}).format(new Date(iso))}catch{return iso||'-'}}
function ensureDrawer(){
 if(document.querySelector('.v2-audit-drawer'))return
 const el=document.createElement('aside');el.className='v2-audit-drawer';el.innerHTML='<div class="v2-audit-drawer-head"><div><small>TRAZABILIDAD</small><h3>Historial del pedido</h3></div><button type="button" class="v2-audit-close">×</button></div><div class="v2-audit-drawer-body"></div>'
 document.body.appendChild(el);el.querySelector('.v2-audit-close').addEventListener('click',()=>el.classList.remove('open'))
}
function openHistory(number){
 ensureDrawer();const drawer=document.querySelector('.v2-audit-drawer'),body=drawer.querySelector('.v2-audit-drawer-body'),db=readDb()
 const order=(db.orders||[]).find(o=>String(o.number)===String(number)),rows=[...(order?.history||[])].sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')))
 body.innerHTML=`<div class="v2-audit-order"><b>Pedido #${esc(number)}</b><span>${esc(order?.client||'')}</span></div>${rows.length?rows.map(x=>`<article class="v2-audit-event"><span class="dot"></span><div><b>${esc(x.action||'Cambio')}</b><p>${esc(x.detail||'')}</p><small>${esc(x.actor||'Usuario')} · ${esc(fmt(x.at))}</small></div></article>`).join(''):'<div class="v2-audit-empty"><b>Sin movimientos registrados todavía</b><span>Los próximos cambios quedarán guardados con fecha y usuario.</span></div>'}`
 drawer.classList.add('open')
}
function decorate(){
 document.querySelectorAll('main table').forEach(table=>{
  const headers=[...table.querySelectorAll('thead th')].map(x=>x.textContent.trim().toLowerCase());if(!headers.includes('pedido')||!headers.includes('acciones'))return
  table.querySelectorAll('tbody tr').forEach(row=>{if(row.querySelector('.v2-history-btn'))return;const cells=[...row.querySelectorAll('td')],number=cells.map(x=>x.textContent.trim()).find(t=>/^#?\d+$/.test(t)),actions=row.querySelector('.row-actions')||cells.at(-1);if(!number||!actions)return
   const btn=document.createElement('button');btn.type='button';btn.className='ghost v2-history-btn';btn.textContent='Historial';btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openHistory(number.replace('#',''))});actions.appendChild(btn)
  })
 })
}
let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorate()})}
const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true})
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('.v2-audit-drawer')?.classList.remove('open')})
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{ensureDrawer();schedule()});else{ensureDrawer();schedule()}
