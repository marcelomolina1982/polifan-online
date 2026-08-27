const CACHE='polifan-v2-section-cache'
const nativeAlert=window.alert.bind(window)
const nativeConfirm=window.confirm.bind(window)
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const readCache=()=>{try{return JSON.parse(localStorage.getItem(CACHE)||'{}')?.data||{}}catch{return{}}}
const text=v=>String(v??'').trim()

function ensureUi(){
 if(!document.querySelector('.v2-toast-stack')){const n=document.createElement('div');n.className='v2-toast-stack';document.body.appendChild(n)}
 if(!document.querySelector('.v2-modal-root')){const n=document.createElement('div');n.className='v2-modal-root';document.body.appendChild(n)}
}
function toast(message,type='info',ms=3200){ensureUi();const stack=document.querySelector('.v2-toast-stack');const n=document.createElement('div');n.className=`v2-toast ${type}`;n.innerHTML=`<span>${type==='success'?'✓':type==='error'?'!':'•'}</span><div>${text(message)}</div>`;stack.appendChild(n);requestAnimationFrame(()=>n.classList.add('show'));setTimeout(()=>{n.classList.remove('show');setTimeout(()=>n.remove(),220)},ms)}
function confirmModal({title='Confirmar acción',message='',danger=false,confirmText='Confirmar'}){ensureUi();return new Promise(resolve=>{const root=document.querySelector('.v2-modal-root');root.innerHTML=`<div class="v2-modal-backdrop"></div><section class="v2-modal-card" role="dialog" aria-modal="true"><div class="v2-modal-icon ${danger?'danger':''}">${danger?'!':'?'}</div><h3>${title}</h3><p>${message}</p><div><button class="ghost" data-cancel>Cancelar</button><button class="${danger?'danger':'primary'}" data-ok>${confirmText}</button></div></section>`;root.classList.add('open');const done=v=>{root.classList.remove('open');setTimeout(()=>root.innerHTML='',160);resolve(v)};root.querySelector('[data-cancel]').onclick=()=>done(false);root.querySelector('.v2-modal-backdrop').onclick=()=>done(false);root.querySelector('[data-ok]').onclick=()=>done(true)})}

function installToasts(){
 window.__v2NativeAlert=nativeAlert
 window.alert=message=>toast(message,/no se pudo|error|inválid|fall/i.test(text(message))?'error':/guardad|actualiz|cread|correct|listo/i.test(text(message))?'success':'info',4200)
}

const stages=[['Ingresado','Ingresados'],['En diseño','Diseño'],['Listo para cortar','Para cortar'],['Cortado','Cortados'],['Entregado','Entregados']]
function orderPipelineMarkup(){const orders=readCache().orders||[],active=orders.filter(o=>o.status!=='Cancelado');const total=active.length;return `<section class="v2-order-pipeline" data-v2-pipeline><div class="v2-pipeline-head"><div><small>FLUJO DE PRODUCCIÓN</small><b>${total} pedidos en el circuito</b></div><span>Vista operativa</span></div><div class="v2-pipeline-track">${stages.map(([status,label],i)=>{const n=active.filter(o=>(o.status||'Ingresado')===status).length;return `<button data-status="${status}"><span>${i+1}</span><div><b>${n}</b><small>${label}</small></div></button>`}).join('<i>→</i>')}</div></section>`}
function isOrdersPage(){return text(document.querySelector('.v2-header-title b')?.textContent)==='Pedidos'}
function renderPipeline(){
 if(!isOrdersPage()){document.querySelector('[data-v2-pipeline]')?.remove();return}
 const tabs=document.querySelector('main .request-tabs');if(!tabs)return
 let p=document.querySelector('[data-v2-pipeline]');const html=orderPipelineMarkup();
 if(!p){tabs.insertAdjacentHTML('beforebegin',html);p=document.querySelector('[data-v2-pipeline]')}else{const temp=document.createElement('div');temp.innerHTML=html;p.replaceWith(temp.firstElementChild)}
}
function filterStatus(status){const select=[...document.querySelectorAll('main .filters select')].find(s=>[...s.options].some(o=>o.value===status));if(select){select.value=status;select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('main .table-wrap')?.scrollIntoView({behavior:'smooth',block:'start'})}}

const pendingStatus=new Map()
function optimisticStatus(select){
 if(!isOrdersPage())return
 const row=select.closest('tr');if(!row)return
 const number=text(row.children?.[1]?.textContent).replace('#',''),desired=select.value;if(!number||!desired)return
 const key=number;pendingStatus.set(key,{select,desired,started:Date.now()});select.classList.add('v2-status-saving');toast(`Pedido #${number}: ${desired}`,'info',1800)
 const tick=()=>{const p=pendingStatus.get(key);if(!p)return;const found=(readCache().orders||[]).find(o=>String(o.number)===number);if(found?.status===desired){p.select?.classList.remove('v2-status-saving');pendingStatus.delete(key);toast(`Pedido #${number} actualizado`,'success');renderPipeline();return}if(Date.now()-p.started>13000){p.select?.classList.remove('v2-status-saving');if(found?.status)p.select.value=found.status;pendingStatus.delete(key);toast(`No pude confirmar el cambio del pedido #${number}`,'error');return}if(p.select?.isConnected)p.select.value=desired;setTimeout(tick,350)}
 setTimeout(tick,100)
}

async function customDangerClick(e){
 const btn=e.target.closest('button.danger');if(!btn||btn.dataset.v2Bypass==='1'||!isOrdersPage())return
 if(!/^eliminar$/i.test(text(btn.textContent)))return
 e.preventDefault();e.stopPropagation();e.stopImmediatePropagation()
 const row=btn.closest('tr'),number=text(row?.children?.[1]?.textContent)||'este pedido',client=text(row?.children?.[3]?.querySelector('b')?.textContent)
 const ok=await confirmModal({title:`Eliminar ${number}`,message:client?`Se eliminará el pedido de ${client}. Esta acción no debe usarse para pedidos que sólo querés archivar.`:'Se eliminará este pedido.',danger:true,confirmText:'Eliminar pedido'})
 if(!ok)return
 btn.dataset.v2Bypass='1';const old=window.confirm;window.confirm=()=>true;try{btn.click()}finally{window.confirm=old;delete btn.dataset.v2Bypass}
}

function installFetchThrottle(){
 if(window.__v2FetchThrottled)return;window.__v2FetchThrottled=true
 const nativeFetch=window.fetch.bind(window);let lastNestStatus=0
 window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input?.url||'';if(url.includes('/api/nest-status')){const minGap=document.hidden?8000:4000;const wait=Math.max(0,minGap-(Date.now()-lastNestStatus));if(wait)await sleep(wait);lastNestStatus=Date.now()}return nativeFetch(input,init)}
}

function bind(){
 ensureUi();installToasts();installFetchThrottle();renderPipeline()
 document.addEventListener('click',e=>{const stage=e.target.closest('[data-v2-pipeline] [data-status]');if(stage)filterStatus(stage.dataset.status)},true)
 document.addEventListener('click',customDangerClick,true)
 document.addEventListener('change',e=>{const s=e.target.closest('main .table-wrap tbody select');if(s&&isOrdersPage())optimisticStatus(s)},true)
 const mo=new MutationObserver(()=>renderPipeline());mo.observe(document.body,{childList:true,subtree:true})
 window.addEventListener('storage',e=>{if(e.key===CACHE)renderPipeline()})
 setInterval(renderPipeline,2500)
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind()
