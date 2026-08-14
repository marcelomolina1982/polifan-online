import React,{useMemo,useState} from 'react'
import CatalogAdminBase from './CatalogAdminBase'

const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)

export default function CatalogAdmin({db,onSave}){
  const [name,setName]=useState('')
  const collections=db.catalogCollections||[]
  const products=db.customerCatalog||[]
  const productIds=useMemo(()=>new Set(products.map(p=>p.id)),[products])

  async function saveWithDates(next){
    const oldIds=new Set((db.customerCatalog||[]).map(p=>p.id))
    const now=new Date().toISOString()
    const catalog=(next.customerCatalog||[]).map(p=>oldIds.has(p.id)?p:{...p,createdAt:p.createdAt||now})
    const cleanedCollections=(next.catalogCollections||collections).map(c=>({...c,productIds:(c.productIds||[]).filter(id=>catalog.some(p=>p.id===id))}))
    return onSave({...next,customerCatalog:catalog,catalogCollections:cleanedCollections})
  }
  async function addCollection(){
    const clean=name.trim();if(!clean)return
    if(collections.some(c=>c.name.toLocaleLowerCase('es')===clean.toLocaleLowerCase('es')))return alert('Ya existe una categoría con ese nombre.')
    await onSave({...db,catalogCollections:[...collections,{id:uid(),name:clean,productIds:[]}]});setName('')
  }
  async function removeCollection(id){if(!confirm('¿Eliminar esta categoría adicional? Las figuras seguirán en el catálogo general.'))return;await onSave({...db,catalogCollections:collections.filter(c=>c.id!==id)})}
  async function toggleProduct(collectionId,productId){
    const next=collections.map(c=>{if(c.id!==collectionId)return c;const ids=new Set(c.productIds||[]);ids.has(productId)?ids.delete(productId):ids.add(productId);return {...c,productIds:[...ids]}})
    await onSave({...db,catalogCollections:next})
  }
  return <>
    <section className="panel" style={{marginBottom:16}}>
      <div className="panel-heading"><div><h3>Categorías adicionales del catálogo</h3><small>Una figura puede estar en varias categorías sin salir de su categoría original ni del catálogo general.</small></div></div>
      <div className="actions" style={{marginTop:12}}><input value={name} onChange={e=>setName(e.target.value)} placeholder="Ej.: Cumpleaños, Disney, Fútbol..."/><button className="primary" type="button" onClick={addCollection}>Crear categoría</button></div>
      {collections.map(c=><details key={c.id} style={{marginTop:12}}><summary><b>{c.name}</b> · {(c.productIds||[]).filter(id=>productIds.has(id)).length} figuras</summary><div className="admin-catalog-grid" style={{marginTop:10}}>{products.map(p=><label key={p.id} className="form-check" style={{alignItems:'center'}}><input type="checkbox" checked={(c.productIds||[]).includes(p.id)} onChange={()=>toggleProduct(c.id,p.id)}/><span>{p.name}</span></label>)}</div><button type="button" className="danger smallbtn" onClick={()=>removeCollection(c.id)}>Eliminar categoría</button></details>)}
      {!collections.length&&<p className="muted">Todavía no creaste categorías adicionales.</p>}
    </section>
    <CatalogAdminBase db={db} onSave={saveWithDates}/>
  </>
}
