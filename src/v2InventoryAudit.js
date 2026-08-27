const rootSelector='.stock-no-projection'
function text(el,value){if(el&&el.textContent!==value)el.textContent=value}
function enhanceAudit(){
 const root=document.querySelector(rootSelector);if(!root)return
 const closed=root.querySelector('.bulk-recount:not(:has(.bulk-table))')
 if(closed){
  const h=closed.querySelector('h3'),p=closed.querySelector('p'),b=closed.querySelector('button')
  text(h,'◉ Modo auditoría de inventario');text(p,'Contá lo que tenés físicamente. La app calcula los ajustes y guarda todo en una sola operación.');text(b,'Abrir modo auditoría')
 }
 const panel=root.querySelector('.bulk-recount:has(.bulk-table)');if(!panel)return
 panel.classList.add('v2-audit-active')
 text(panel.querySelector('h3'),'◉ Auditoría física de inventario')
 const note=panel.querySelector('.bulk-head p');text(note,'Cargá completas, tapas y bases tal como las ves. Nada se modifica hasta guardar al final.')
 const rows=[...panel.querySelectorAll('.bulk-table tbody tr')],inputs=[...panel.querySelectorAll('.bulk-table tbody input')]
 let edited=0,completed=0
 rows.forEach(row=>{
  const cells=[...row.querySelectorAll('input')]
  const dirty=cells.some(i=>i.dataset.auditInitial!==undefined&&Number(i.value)!==Number(i.dataset.auditInitial))
  row.classList.toggle('v2-dirty',dirty);if(dirty)edited++
  if(cells.every(i=>String(i.value).trim()!==''))completed++
 })
 inputs.forEach(i=>{if(i.dataset.auditInitial===undefined)i.dataset.auditInitial=i.value})
 let strip=panel.querySelector('.v2-audit-strip');if(!strip){strip=document.createElement('div');strip.className='v2-audit-strip';panel.querySelector('.bulk-head')?.after(strip)}
 strip.innerHTML=`<span class="v2-audit-chip">${completed}/${rows.length} filas listas</span><span class="v2-audit-chip ${edited?'changed':''}">${edited} con cambios</span>`
 let progress=panel.querySelector('.v2-audit-progress');if(!progress){progress=document.createElement('div');progress.className='v2-audit-progress';progress.innerHTML='<span></span>';strip.after(progress)}
 progress.firstElementChild.style.width=`${rows.length?Math.round(completed/rows.length*100):0}%`
 let hint=panel.querySelector('.v2-audit-note');if(!hint){hint=document.createElement('div');hint.className='v2-audit-note';hint.textContent='Tip: podés buscar una figura, contarla y seguir. Las filas modificadas quedan resaltadas.';progress.after(hint)}
}
let queued=false
const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhanceAudit()})}
const obs=new MutationObserver(schedule);obs.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['value']})
document.addEventListener('input',e=>{if(e.target.closest?.(rootSelector))schedule()})
document.addEventListener('click',e=>{if(e.target.closest?.(rootSelector))setTimeout(schedule,0)})
schedule()
