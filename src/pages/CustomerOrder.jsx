import React,{useEffect,useMemo,useState} from 'react'
import CustomerOrderBase from './CustomerOrderBase'
import {supabase} from '../supabase'

const CACHE_KEY='tvet_catalog_planning_cache_v1'
export default function CustomerOrder(){
  const [catalogState,setCatalogState]=useState({customerCatalog:[],catalogCollections:[]})
  const [special,setSpecial]=useState('')
  useEffect(()=>{
    let mounted=true
    const applyPublic=(state,updatedAt='')=>{
      if(!mounted||!state)return
      const safe={...state,orders:[],productionClosedDates:[]}
      setCatalogState({...state,__updatedAt:updatedAt||''})
      try{localStorage.setItem(CACHE_KEY,JSON.stringify({state:safe,updatedAt:updatedAt||'',cachedAt:new Date().toISOString()}))}catch{}
    }
    const refresh=async()=>{
      const appResult=await supabase.from('app_state').select('data,updated_at').eq('id','main').maybeSingle()
      if(!appResult.error&&appResult.data?.data){applyPublic(appResult.data.data,appResult.data.updated_at||'');return}
      const publicResult=await supabase.from('public_catalog').select('data,updated_at').eq('id','main').maybeSingle()
      if(!publicResult.error&&publicResult.data?.data)applyPublic(publicResult.data.data,publicResult.data.updated_at||'')
    }
    refresh()
    const onVisible=()=>{if(document.visibilityState==='visible')refresh()}
    const onOnline=()=>refresh()
    window.addEventListener('focus',refresh);window.addEventListener('online',onOnline);document.addEventListener('visibilitychange',onVisible)
    const timer=window.setInterval(refresh,20000)
    const appChannel=supabase.channel('catalog-app-state-sync-v2').on('postgres_changes',{event:'*',schema:'public',table:'app_state',filter:'id=eq.main'},refresh).subscribe()
    const publicChannel=supabase.channel('catalog-public-sync-v2').on('postgres_changes',{event:'*',schema:'public',table:'public_catalog',filter:'id=eq.main'},refresh).subscribe()
    return()=>{mounted=false;window.removeEventListener('focus',refresh);window.removeEventListener('online',onOnline);document.removeEventListener('visibilitychange',onVisible);window.clearInterval(timer);supabase.removeChannel(appChannel);supabase.removeChannel(publicChannel)}
  },[])
  const products=catalogState.customerCatalog||[]
  const collections=catalogState.catalogCollections||[]
  const newestIds=useMemo(()=>{const limit=Date.now()-15*24*60*60*1000;return new Set(products.filter(p=>p.createdAt&&new Date(p.createdAt).getTime()>=limit).map(p=>p.id))},[products])
  function showSet(ids,label){
    setSpecial(label)
    const all=[...document.querySelectorAll('.customer-categories-primary button')].find(b=>b.textContent.trim()==='Todos')
    if(all&&!all.classList.contains('active'))all.click()
    window.setTimeout(()=>{
      document.querySelectorAll('.customer-product').forEach(card=>{
        const name=card.querySelector('.customer-product-info b')?.textContent?.trim()||''
        const product=products.find(p=>p.name===name)
        card.style.display=product&&ids.has(product.id)?'':'none'
      })
      document.querySelector('.customer-catalog')?.scrollIntoView({behavior:'smooth',block:'start'})
    },80)
  }
  const showNewest=()=>showSet(newestIds,'Novedades')
  const showCollection=c=>showSet(new Set(c.productIds||[]),c.name)
  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      const nav=document.querySelector('.customer-categories-primary');if(!nav)return
      nav.querySelectorAll('[data-extra-collection]').forEach(x=>x.remove())
      collections.forEach(c=>{const b=document.createElement('button');b.type='button';b.dataset.extraCollection=c.id;b.textContent=c.name;b.className=special===c.name?'active':'';b.onclick=()=>showCollection(c);nav.appendChild(b)})
    },120)
    return()=>window.clearTimeout(timer)
  },[collections,special,products])
  useEffect(()=>{
    const clear=event=>{const btn=event.target.closest('.customer-categories-primary button');if(btn&&!btn.dataset.extraCollection){setSpecial('');window.setTimeout(()=>document.querySelectorAll('.customer-product').forEach(card=>card.style.display=''),0)}}
    document.addEventListener('click',clear);return()=>document.removeEventListener('click',clear)
  },[])
  return <div className="catalog-enhanced">
    <style>{`.catalog-news-marquee{overflow:hidden;background:#5b35b5;color:#fff;padding:11px 0;font-weight:800;cursor:pointer;border:0;width:100%;letter-spacing:.3px}.catalog-news-marquee span{display:inline-block;white-space:nowrap;padding-left:100%;animation:catalogTicker 13s linear infinite}@keyframes catalogTicker{from{transform:translateX(0)}to{transform:translateX(-100%)}}@media(prefers-reduced-motion:reduce){.catalog-news-marquee span{animation:none;padding-left:0}}`}</style>
    <button className="catalog-news-marquee" type="button" onClick={showNewest}><span>✨ NUEVAS FIGURAS DISPONIBLES · MIRÁ LAS NOVEDADES DE LOS ÚLTIMOS 15 DÍAS · ✨ NUEVAS FIGURAS DISPONIBLES</span></button>
    <CustomerOrderBase key={catalogState.__updatedAt||'catalog-live'}/>
  </div>
}
