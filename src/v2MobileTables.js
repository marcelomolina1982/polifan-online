const PHONE=window.matchMedia('(max-width:760px)')

function enhanceTable(table){
  if(table.dataset.v2MobileReady==='1')return
  const headers=[...table.querySelectorAll('thead th')].map(th=>String(th.textContent||'').trim())
  if(!headers.length)return
  table.dataset.v2MobileReady='1'
  table.classList.add('v2-mobile-table')
  for(const row of table.querySelectorAll('tbody tr')){
    ;[...row.children].forEach((cell,index)=>{
      if(!cell.dataset.label)cell.dataset.label=headers[index]||''
    })
  }
}

function apply(){
  if(!PHONE.matches)return
  document.querySelectorAll('.v2-shell table').forEach(enhanceTable)
}

let raf=0
function schedule(){
  if(raf)return
  raf=requestAnimationFrame(()=>{raf=0;apply()})
}

PHONE.addEventListener?.('change',schedule)
new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true})
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule()
