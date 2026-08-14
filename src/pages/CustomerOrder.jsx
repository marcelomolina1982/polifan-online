import React,{useEffect,useMemo,useState} from 'react'
import CustomerOrderBase from './CustomerOrderBase'
import {supabase} from '../supabase'

export default function CustomerOrder(){
  const [catalogState,setCatalogState]=useState({customerCatalog:[],catalogCollections:[]})
  const [special,setSpecial]=useState('')
  useEffect(()=>{
    let mounted=true
    supabase.from('app_state').select('data').eq('id','main').maybeSingle().then(({data})=>{if(mounted&&data?.data)setCatalogState(data.data)})
    return()=>{mounted=false}
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
  function showNewest(){showSet(newestIds,'Novedades')}
  function showCollection(c){showSet(new Set(c.productIds||[]),c.name)}
  useEffect(()=>{
    const clear=event=>{if(event.target.closest('.customer-categories-primary button')){setSpecial('');window.setTimeout(()=>document.querySelectorAll('.customer-product').forEach(card=>card.style.display=''),0)}}
    document.addEventListener('click',clear)
    return()=>document.removeEventListener('click',clear)
  },[])

  return <div className="catalog-enhanced">
    <style>{`
      .catalog-news-marquee{overflow:hidden;background:#5b35b5;color:#fff;padding:11px 0;font-weight:800;cursor:pointer;border:0;width:100%;letter-spacing:.3px}
      .catalog-news-marquee span{display:inline-block;white-space:nowrap;padding-left:100%;animation:catalogTicker 13s linear infinite}
      @keyframes catalogTicker{from{transform:translateX(0)}to{transform:translateX(-100%)}}
      .catalog-extra-nav{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:12px;background:#fff;border-bottom:1px solid #eee}
      .catalog-extra-nav button{border:1px solid #ddd;background:#fff;border-radius:999px;padding:9px 14px;font-weight:700;cursor:pointer}
      .catalog-extra-nav button.active{background:#5b35b5;color:white;border-color:#5b35b5}
      @media(prefers-reduced-motion:reduce){.catalog-news-marquee span{animation:none;padding-left:0}}
    `}</style>
    <button className="catalog-news-marquee" type="button" onClick={showNewest}><span>✨ NUEVAS FIGURAS DISPONIBLES · MIRÁ LAS NOVEDADES DE LOS ÚLTIMOS 15 DÍAS · ✨ NUEVAS FIGURAS DISPONIBLES</span></button>
    {(newestIds.size>0||collections.length>0)&&<div className="catalog-extra-nav"><button type="button" className={special==='Novedades'?'active':''} onClick={showNewest}>✨ Novedades</button>{collections.map(c=><button type="button" key={c.id} className={special===c.name?'active':''} onClick={()=>showCollection(c)}>{c.name}</button>)}</div>}
    <CustomerOrderBase/>
  </div>
}
