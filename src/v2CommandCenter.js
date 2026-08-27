const CACHE_KEY='polifan-v2-section-cache'
const RECENTS_KEY='polifan-v2-recents'
const SPARROW_JOB='polifan-motor-lab-active-job-v1'
const MAX_RECENTS=5
const routeHints={orders:'Pedidos',clients:'Clientes',quotes:'Presupuestos',figures:'Inventario',customerCatalog:'Catálogo',cutBatches:'En corte'}

const text=v=>String(v??'').trim()
const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'')||fallback}catch{return fallback}}
const writeJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
const clickNav=label=>{const btn=[...document.querySelectorAll('.sidebar nav button')].find(b=>text(b.textContent).includes(label));if(btn){btn.click();return true}return false}

function getNavItems(){return [...document.querySelectorAll('.sidebar nav button')].map(btn=>({label:text(btn.textContent).replace(/^\S+\s*/,''),raw:text(btn.textContent),button:btn}))}
function getCache(){return readJson(CACHE_KEY,{data:{}})?.data||{}}
function addRecent(label){if(!label)return;const current=readJson(RECENTS_KEY,[]).filter(x=>x!==label);writeJson(RECENTS_KEY,[label,...current].slice(0,MAX_RECENTS));renderRecents()}

function searchableRows(){
 const db=getCache(),rows=[]
 ;(db.orders||[]).forEach(o=>rows.push({kind:'Pedido',route:'Pedidos',title:`Pedido #${o.number||''} · ${o.client||[o.firstName,o.lastName].filter(Boolean).join(' ')||'Sin cliente'}`,meta:[o.phone,o.delivery,o.status].filter(Boolean).join(' · '),key:[o.number,o.client,o.firstName,o.lastName,o.phone,o.dni,o.delivery,o.status].join(' ')}))
 ;(db.clients||[]).forEach(c=>rows.push({kind:'Cliente',route:'Clientes',title:c.name||[c.firstName,c.lastName].filter(Boolean).join(' ')||'Cliente',meta:[c.phone,c.dni,c.locality].filter(Boolean).join(' · '),key:[c.name,c.firstName,c.lastName,c.phone,c.dni,c.email,c.locality].join(' ')}))
 ;(db.quotes||[]).forEach(q=>rows.push({kind:'Presupuesto',route:'Presupuestos',title:`${q.code||'Presupuesto'} · ${q.client||q.customer?.name||'Sin cliente'}`,meta:[q.phone||q.customer?.phone,q.status].filter(Boolean).join(' · '),key:[q.code,q.client,q.customer?.name,q.phone,q.customer?.phone,q.status].join(' ')}))
 ;(db.cutBatches||[]).forEach(b=>rows.push({kind:'Placa',route:'En corte',title:`Placa #${b.number||''} · ${b.name||''}`,meta:b.status||'',key:[b.number,b.name,b.status,...(b.items||[]).map(i=>i.figure)].join(' ')}))
 ;(db.customerCatalog||[]).forEach(p=>rows.push({kind:'Producto',route:'Catálogo',title:p.name||'Producto',meta:p.category||'',key:[p.name,p.category,p.measure,p.id].join(' ')}))
 ;(db.figures||[]).forEach(f=>rows.push({kind:'Figura',route:'Inventario',title:text(f),meta:'Inventario / producción',key:f}))
 return rows
}

function ensurePalette(){
 if(document.querySelector('.v2-command-center'))return
 const root=document.createElement('div');root.className='v2-command-center';root.innerHTML=`<div class="v2-command-backdrop"></div><section class="v2-command-dialog" role="dialog" aria-modal="true"><div class="v2-command-search"><span>⌕</span><input aria-label="Buscar en Polifan" placeholder="Buscar pedido, cliente, figura, teléfono…"><kbd>ESC</kbd></div><div class="v2-command-content"></div><footer><span>↑↓ navegar</span><span>Enter abrir</span><span>Ctrl K buscar</span></footer></section>`
 document.body.appendChild(root)
 const input=root.querySelector('input'),content=root.querySelector('.v2-command-content')
 let selected=0,current=[]
 const close=()=>{root.classList.remove('open');input.value='';selected=0}
 const open=()=>{root.classList.add('open');render('');setTimeout(()=>input.focus(),0)}
 function render(query){
  const q=norm(query),nav=getNavItems().map(x=>({kind:'Ir a',route:x.label,title:x.label,meta:'Módulo',key:x.raw}))
  const quick=[{kind:'Acción rápida',route:'Nuevo pedido',title:'＋ Crear nuevo pedido',meta:'Abrir formulario'},{kind:'Acción rápida',route:'Para cortar',title:'✂ Ver qué falta cortar',meta:'Producción'},{kind:'Acción rápida',route:'Generar placas',title:'◎ Generar placa con Sparrow',meta:'Motor de corte'},{kind:'Acción rápida',route:'Caja y gastos',title:'◉ Registrar movimiento de caja',meta:'Finanzas'}]
  current=(q?[...searchableRows(),...nav].filter(x=>norm(`${x.title} ${x.meta} ${x.key}`).includes(q)).slice(0,14):[...quick,...readJson(RECENTS_KEY,[]).map(label=>({kind:'Reciente',route:label,title:label,meta:'Abrir módulo'}))]).filter(x=>x.route)
  selected=Math.min(selected,Math.max(0,current.length-1))
  content.innerHTML=current.length?current.map((x,i)=>`<button class="v2-command-result ${i===selected?'selected':''}" data-i="${i}"><span class="type">${x.kind}</span><b>${x.title}</b><small>${x.meta||''}</small><em>↵</em></button>`).join(''):`<div class="v2-command-empty"><b>Sin resultados</b><span>Probá con número de pedido, nombre, teléfono o figura.</span></div>`
 }
 function activate(i=selected){const item=current[i];if(!item)return;if(clickNav(item.route)){addRecent(item.route);close()}}
 input.addEventListener('input',()=>{selected=0;render(input.value)})
 input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();selected=Math.min(current.length-1,selected+1);render(input.value)}else if(e.key==='ArrowUp'){e.preventDefault();selected=Math.max(0,selected-1);render(input.value)}else if(e.key==='Enter'){e.preventDefault();activate()}else if(e.key==='Escape')close()})
 content.addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(b)activate(Number(b.dataset.i))})
 root.querySelector('.v2-command-backdrop').addEventListener('click',close)
 root.openPalette=open;root.closePalette=close
}

function renderRecents(){
 const sidebar=document.querySelector('.sidebar');if(!sidebar)return
 let box=sidebar.querySelector('.v2-recents');if(!box){box=document.createElement('div');box.className='v2-recents';const nav=sidebar.querySelector('nav');nav?.prepend(box)}
 const recents=readJson(RECENTS_KEY,[]).filter(label=>getNavItems().some(x=>x.label===label))
 box.innerHTML=recents.length?`<small>RECIENTES</small><div>${recents.map(label=>`<button data-route="${label}">${label}</button>`).join('')}</div>`:''
}

function ensureQuickButton(){
 if(document.querySelector('.v2-command-trigger'))return
 const btn=document.createElement('button');btn.className='v2-command-trigger';btn.type='button';btn.innerHTML='<span>⌕</span><b>Buscar</b><kbd>Ctrl K</kbd>';btn.addEventListener('click',()=>document.querySelector('.v2-command-center')?.openPalette?.());document.body.appendChild(btn)
}

function renderTaskChip(){
 const header=document.querySelector('.content>header');if(!header)return
 let chip=header.querySelector('.v2-task-chip');const job=readJson(SPARROW_JOB,null)
 if(!job?.jobId){chip?.remove();return}
 if(!chip){chip=document.createElement('button');chip.className='v2-task-chip';chip.type='button';chip.addEventListener('click',()=>clickNav('Generar placas'));header.querySelector('.header-right')?.prepend(chip)}
 const secs=Math.max(0,Math.round((Date.now()-Number(job.startedAt||Date.now()))/1000));chip.innerHTML=`<span class="pulse"></span><span><b>Sparrow calculando</b><small>${Math.floor(secs/60)}m ${secs%60}s · trabajo ${text(job.jobId).slice(0,8)}</small></span>`
}

function bind(){
 ensurePalette();ensureQuickButton();renderRecents();renderTaskChip()
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.querySelector('.v2-command-center')?.openPalette?.()}else if(e.key==='Escape')document.querySelector('.v2-command-center')?.closePalette?.()})
 document.addEventListener('click',e=>{const recent=e.target.closest('.v2-recents [data-route]');if(recent){clickNav(recent.dataset.route);addRecent(recent.dataset.route);return}const nav=e.target.closest('.sidebar nav button');if(nav){const item=getNavItems().find(x=>x.button===nav);if(item)addRecent(item.label)}})
 setInterval(renderTaskChip,3000)
}

const observer=new MutationObserver(()=>{if(document.querySelector('.v2-shell')){observer.disconnect();bind()}})
observer.observe(document.documentElement,{childList:true,subtree:true})
if(document.querySelector('.v2-shell')){observer.disconnect();bind()}
