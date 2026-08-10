const FAV_KEY='tvet_catalog_favorites_v1'
const VIEW_KEY='tvet_catalog_views_v1'
const getJson=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(k)||'null')||fallback}catch{return fallback}}
const setJson=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
const productName=article=>article?.querySelector('.customer-product-info b')?.textContent?.trim()||''
const slug=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-')

function closeProductModal(){document.querySelector('.catalog-product-modal')?.remove();document.body.classList.remove('catalog-modal-open')}
function openProductModal(article){
 if(!article)return;closeProductModal();const name=productName(article),img=article.querySelector('.customer-product-image')?.src,measure=article.querySelector('.customer-product-info small')?.textContent||'',price=article.querySelector('.customer-product-info span')?.textContent||'Promos por cantidad';
 const views=getJson(VIEW_KEY,{});views[name]=(views[name]||0)+1;setJson(VIEW_KEY,views)
 const overlay=document.createElement('div');overlay.className='catalog-product-modal';overlay.innerHTML=`<div class="catalog-product-dialog"><button class="catalog-product-close" aria-label="Cerrar">×</button><div class="catalog-product-media">${img?`<img src="${img}" alt="${name}">`:''}</div><div class="catalog-product-detail"><small>DISEÑO DE POLIFAN</small><h2>${name}</h2><p>${measure||'Consultá medidas y personalización al confirmar tu pedido.'}</p><div class="catalog-product-price">${price}</div><div class="catalog-product-benefits"><span>✓ Podés combinar modelos</span><span>✓ Descuentos por cantidad</span><span>✓ Producción a pedido</span></div><button class="catalog-product-add">＋ Agregar al pedido</button></div></div>`
 document.body.appendChild(overlay);document.body.classList.add('catalog-modal-open');overlay.querySelector('.catalog-product-close').onclick=closeProductModal;overlay.onclick=e=>{if(e.target===overlay)closeProductModal()};overlay.querySelector('.catalog-product-add').onclick=()=>{article.querySelector('.qty-control button:last-child')?.click();closeProductModal()}
}
function decorateProducts(){
 const favs=new Set(getJson(FAV_KEY,[]));document.querySelectorAll('.customer-page .customer-product').forEach(article=>{
  const name=productName(article);if(!name)return;article.dataset.productKey=slug(name)
  if(!article.querySelector('.catalog-favorite-btn')){const b=document.createElement('button');b.type='button';b.className='catalog-favorite-btn';b.textContent=favs.has(name)?'♥':'♡';b.title='Guardar en favoritos';b.onclick=e=>{e.stopPropagation();const current=new Set(getJson(FAV_KEY,[]));current.has(name)?current.delete(name):current.add(name);setJson(FAV_KEY,[...current]);b.textContent=current.has(name)?'♥':'♡';applyFavoriteFilter()};article.appendChild(b)}
  if(!article.querySelector('.catalog-from-price')&&!article.querySelector('.customer-product-info span')){const tag=document.createElement('small');tag.className='catalog-from-price';tag.textContent='Desde $3.333 c/u en promo x12';article.querySelector('.customer-product-info')?.appendChild(tag)}
  const img=article.querySelector('.customer-product-image'),info=article.querySelector('.customer-product-info');[img,info].forEach(el=>{if(el&&!el.dataset.detailReady){el.dataset.detailReady='1';el.style.cursor='zoom-in';el.addEventListener('click',()=>window.setTimeout(()=>openProductModal(article),0))}})
 })
 ensureToolbar()
}
let favOnly=false
function applyFavoriteFilter(){const favs=new Set(getJson(FAV_KEY,[]));document.querySelectorAll('.customer-page .customer-product').forEach(a=>{a.classList.toggle('catalog-hidden-favorite',favOnly&&!favs.has(productName(a)))});const b=document.querySelector('.catalog-favorites-filter');if(b){b.classList.toggle('active',favOnly);b.textContent=favOnly?'♥ Viendo favoritos':'♡ Favoritos'}}
function ensureToolbar(){
 const anchor=document.querySelector('.customer-page .customer-categories-primary');if(!anchor||document.querySelector('.catalog-pro-toolbar'))return
 const bar=document.createElement('div');bar.className='catalog-pro-toolbar';bar.innerHTML='<button type="button" class="catalog-favorites-filter">♡ Favoritos</button><button type="button" class="catalog-most-viewed">🔥 Más vistos</button><button type="button" class="catalog-newest">✨ Últimos</button>'
 anchor.after(bar);bar.querySelector('.catalog-favorites-filter').onclick=()=>{favOnly=!favOnly;applyFavoriteFilter()};bar.querySelector('.catalog-most-viewed').onclick=()=>{favOnly=false;applyFavoriteFilter();const views=getJson(VIEW_KEY,{}),grid=document.querySelector('.customer-catalog');if(grid)[...grid.querySelectorAll('.customer-product')].sort((a,b)=>(views[productName(b)]||0)-(views[productName(a)]||0)).forEach(x=>grid.appendChild(x))};bar.querySelector('.catalog-newest').onclick=()=>{favOnly=false;applyFavoriteFilter();const grid=document.querySelector('.customer-catalog');if(grid)[...grid.querySelectorAll('.customer-product')].reverse().forEach(x=>grid.appendChild(x))}
}
const observer=new MutationObserver(()=>decorateProducts());observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',decorateProducts);document.addEventListener('keydown',e=>{if(e.key==='Escape')closeProductModal()})
