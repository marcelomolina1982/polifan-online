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

async function applyReviewImages(){
  if(applying) return
  const grid=document.querySelector('.customer-page .trust-review-grid')
  if(!grid) return
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
  }finally{
    applying=false
  }
}

const observer=new MutationObserver(()=>{applyReviewImages()})
observer.observe(document.documentElement,{childList:true,subtree:true})
window.addEventListener('load',()=>applyReviewImages())
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){loadReviews(true).then(()=>applyReviewImages())}})
