import React,{useEffect,useMemo,useState} from 'react'
import CatalogAdminBase from './CatalogAdminBase'
import {supabase} from '../supabase'

const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)
const publicCatalogPayload=db=>({
  customerCatalog:db.customerCatalog||[],
  catalogCollections:db.catalogCollections||[],
  customerSettings:db.customerSettings||{},
  customerReviews:db.customerReviews||[],
  customerPhotos:db.customerPhotos||[],
  chatbotSettings:db.chatbotSettings||{}
})

export default function CatalogAdmin({db,onSave}){
  const [name,setName]=useState('')
  const [searchByCollection,setSearchByCollection]=useState({})
  const [draftByCollection,setDraftByCollection]=useState({})
  const collections=db.catalogCollections||[]
  const products=db.customerCatalog||[]
  const productIds=useMemo(()=>new Set(products.map(p=>p.id)),[products])

  async function publishPublicCatalog(next){
    const data=publicCatalogPayload(next)
    if(!data.customerCatalog.length)return {ok:false,error:new Error('Catálogo vacío')}
    const {error}=await supabase.from('public_catalog').upsert({id:'main',data,updated_at:new Date().toISOString()},{onConflict:'id'})
    if(error){console.error('No se pudo publicar el catálogo público',error);return {ok:false,error}}
    return {ok:true}
  }
  async function persist(next){
    const result=await onSave(next)
    if(result?.ok===false)return result
    const confirmed=result?.data||next
    const published=await publishPublicCatalog(confirmed)
    if(!published.ok)alert('El cambio se guardó en la app, pero el catálogo público no pudo actualizarse. Revisá la configuración de catálogo público en Supabase.')
    return result||{ok:true,data:confirmed}
  }
  useEffect(()=>{
    let active=true
    ;(async()=>{
      try{
        const {data,error}=await supabase.from('app_state').select('customerCatalog:data->customerCatalog,catalogCollections:data->catalogCollections,customerSettings:data->customerSettings,customerReviews:data->customerReviews,customerPhotos:data->customerPhotos,chatbotSettings:data->chatbotSettings').eq('id','main').maybeSingle()
        if(!active||error||!Array.isArray(data?.customerCatalog)||!data.customerCatalog.length)return
        await publishPublicCatalog(data)
      }catch(error){console.warn('No se pudo recuperar el catálogo público desde el servidor',error)}
    })()
    return()=>{active=false}
  },[])

  async function saveWithDates(next){
    const oldIds=new Set((db.customerCatalog||[]).map(p=>p.id))
    const now=new Date().toISOString()
    const catalog=(next.customerCatalog||[]).map(p=>oldIds.has(p.id)?p:{...p,createdAt:p.createdAt||now})
    const cleanedCollections=(next.catalogCollections||collections).map(c=>({...c,productIds:(c.productIds||[]).filter(id=>catalog.some(p=>p.id===id))}))
    const result=await persist({...next,customerCatalog:catalog,catalogCollections:cleanedCollections})
    // CatalogAdminBase historically showed a success alert even when onSave returned a conflict.
    // Throwing here stops that false success path while App already showed the protected conflict message.
    if(result?.ok===false){
      const error=new Error(result.conflict?'CATALOG_SAVE_CONFLICT':'CATALOG_SAVE_FAILED')
      error.catalogSaveHandled=true
      throw error
    }
    return result
  }
  async function addCollection(){
    const clean=name.trim();if(!clean)return
    if(collections.some(c=>c.name.toLocaleLowerCase('es')===clean.toLocaleLowerCase('es')))return alert('Ya existe una categoría con ese nombre.')
    const result=await persist({...db,catalogCollections:[...collections,{id:uid(),name:clean,productIds:[]}]});if(result?.ok===false)return;setName('')
  }
  async function removeCollection(id){if(!confirm('¿Eliminar esta categoría adicional? Las figuras seguirán en el catálogo general.'))return;await persist({...db,catalogCollections:collections.filter(c=>c.id!==id)})}
  function draftIds(c){return draftByCollection[c.id]||c.productIds||[]}
  function toggleDraft(c,productId){
    const ids=new Set(draftIds(c));ids.has(productId)?ids.delete(productId):ids.add(productId)
    setDraftByCollection(v=>({...v,[c.id]:[...ids]}))
  }
  function setAllVisible(c,visibleProducts,checked){
    const ids=new Set(draftIds(c));visibleProducts.forEach(p=>checked?ids.add(p.id):ids.delete(p.id))
    setDraftByCollection(v=>({...v,[c.id]:[...ids]}))
  }
  async function saveCollection(c){
    const ids=draftIds(c).filter(id=>productIds.has(id))
    const next=collections.map(x=>x.id===c.id?{...x,productIds:ids}:x)
    const result=await persist({...db,catalogCollections:next})
    if(result?.ok===false)return
    setDraftByCollection(v=>{const n={...v};delete n[c.id];return n})
    alert(`Categoría “${c.name}” actualizada.`)
  }
  return <>
    <section className="panel" style={{marginBottom:16}}>
      <div className="panel-heading"><div><h3>Categorías adicionales del catálogo</h3><small>Creá la categoría, buscá con la lupa y tildá todas las figuras que quieras. Se guarda una sola vez al final.</small></div></div>
      <div className="actions" style={{marginTop:12}}><input value={name} onChange={e=>setName(e.target.value)} placeholder="Ej.: Cumpleaños, Disney, Fútbol..."/><button className="primary" type="button" onClick={addCollection}>Crear categoría</button></div>
      {collections.map(c=>{
        const term=(searchByCollection[c.id]||'').trim().toLocaleLowerCase('es')
        const visible=products.filter(p=>!term||`${p.name} ${p.category||''}`.toLocaleLowerCase('es').includes(term))
        const selected=new Set(draftIds(c))
        const dirty=Boolean(draftByCollection[c.id])
        return <details key={c.id} style={{marginTop:12}}><summary><b>{c.name}</b> · {selected.size} figuras{dirty?' · cambios sin guardar':''}</summary>
          <div className="actions" style={{marginTop:12,alignItems:'center'}}><input type="search" value={searchByCollection[c.id]||''} onChange={e=>setSearchByCollection(v=>({...v,[c.id]:e.target.value}))} placeholder="🔍 Buscar figura para agregar..."/><button type="button" className="ghost smallbtn" onClick={()=>setAllVisible(c,visible,true)}>Tildar visibles</button><button type="button" className="ghost smallbtn" onClick={()=>setAllVisible(c,visible,false)}>Destildar visibles</button></div>
          <div className="admin-catalog-grid" style={{marginTop:10}}>{visible.map(p=><label key={p.id} className="form-check" style={{alignItems:'center'}}><input type="checkbox" checked={selected.has(p.id)} onChange={()=>toggleDraft(c,p.id)}/><span>{p.name}</span></label>)}</div>
          <div className="actions" style={{marginTop:12}}><button type="button" className="primary" disabled={!dirty} onClick={()=>saveCollection(c)}>Guardar selección ({selected.size})</button><button type="button" className="danger smallbtn" onClick={()=>removeCollection(c.id)}>Eliminar categoría</button></div>
        </details>
      })}
      {!collections.length&&<p className="muted">Todavía no creaste categorías adicionales.</p>}
    </section>
    <CatalogAdminBase db={db} onSave={saveWithDates}/>
  </>
}