import { supabase } from './supabase'

let lastFetch=0
let cachedReviews=[]
let applying=false

async function loadReviews(force=false){
  const now=Date.now()
  if(!force&&cachedReviews.length&&now-lastFetch<15000) return cachedReviews
  lastFetch=now
  const {data}=await supabase.from('app_state').select('data').eq('id','main').maybeSingle()
  cachedReviews=(data?.data?.customerReviews||[]).filter(x=>x.active!==false)
  return cachedReviews
}

function closeTrustLightbox(){
  document.querySelector('.trust-lightbox')?.remove()
  document.body.classList.remove('trust-lightbox-open')
}

function openTrustLightbox(article){
  if(!article) return
  closeTrustLightbox()
  const overlay=document.createElement('div')
  overlay.className='trust-lightbox'
  overlay.setAttribute('role','dialog')
  overlay.setAttribute('aria-modal','true')
  const content=document.createElement('div')
  content.className='trust-lightbox-content'
  const close=document.createElement('button')
  close.type='button'
  close.className='trust-lightbox-close'
  close.setAttribute('aria-label','Cerrar')
  close.textContent='×'
  const clone=article.cloneNode(true)
  clone.classList.add('trust-lightbox-card')
  clone.removeAttribute('tabindex')
  clone.removeAttribute('role')
  clone.querySelectorAll('[data-trust-expand]').forEach(x=>x.removeAttribute('data-trust-expand'))
  content.append(close,clone)
  overlay.appendChild(content)
  document.body.appendChild(overlay)
  document.body.classList.add('trust-lightbox-open')
  close.addEventListener('click',closeTrustLightbox)
  overlay.addEventListener('click',event=>{if(event.target===overlay)closeTrustLightbox()})
}

function enableTrustExpansion(){
  document.querySelectorAll('.customer-page .trust-photo-grid article,.customer-page .trust-review-grid article').forEach(article=>{
    if(article.dataset.trustExpand==='1') return
    article.dataset.trustExpand='1'
    article.tabIndex=0
    article.setAttribute('role','button')
    article.setAttribute('aria-label','Ampliar foto u opinión de cliente')
    article.addEventListener('click',()=>openTrustLightbox(article))
    article.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openTrustLightbox(article)}})
  })
}

async function applyReviewImages(){
  if(applying) return
  const grid=document.querySelector('.customer-page .trust-review-grid')
  if(!grid){enableTrustExpansion();return}
  applying=true
  try{
    const reviews=await loadReviews()
    const articles=[...grid.querySelectorAll('article')]
    articles.forEach((article,index)=>{
      const review=reviews[index]
      if(!review?.image||article.querySelector('.trust-review-image')) return
      const img=document.createElement('img')
      img.className='trust-review-image'
      img.src=review.image
      img.alt=review.name?`Reseña de ${review.name}`:'Imagen de reseña de cliente'
      article.insertBefore(img,article.firstChild)
    })
    enableTrustExpansion()
  }finally{
    applying=false
  }
}

const observer=new MutationObserver(()=>{applyReviewImages();enableTrustExpansion()})
observer.observe(document.documentElement,{childList:true,subtree:true})
window.addEventListener('load',()=>{applyReviewImages();enableTrustExpansion()})
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeTrustLightbox()})
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){loadReviews(true).then(()=>applyReviewImages())}})
