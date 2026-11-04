import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../supabase'

export default function CandyStock({products=[]}){
 const candies=useMemo(()=>products.filter(p=>String(p.category||'').trim().toLocaleLowerCase('es')==='golosinas'),[products])
 const [stock,setStock]=useState({}),[search,setSearch]=useState(''),[quantities,setQuantities]=useState({}),[busy,setBusy]=useState(''),[error,setError]=useState(''),[movements,setMovements]=useState([]),[minimums,setMinimums]=useState({})
 async function refresh(){
  const {data,error:e}=await supabase.from('candy_stock').select('product_id,quantity,min_quantity')
  if(e){setError('No se pudo consultar el stock: '+e.message);return}
  setStock(Object.fromEntries((data||[]).map(x=>[x.product_id,x])));setError('')
 }
 async function loadMovements(){const {data,error:e}=await supabase.from('candy_stock_movements').select('id,product_id,kind,delta,created_at').order('created_at',{ascending:false}).limit(30);if(e){setError(e.message);return}setMovements(data||[])}
 useEffect(()=>{refresh();loadMovements()},[])
 async function initialize(product){
  const qty=Number(quantities[product.id]??'')
  const min=Number(minimums[product.id]??5)
  if(!Number.isSafeInteger(qty)||qty<0||!Number.isSafeInteger(min)||min<0)return alert('Ingresá cantidades enteras válidas (pueden ser cero).')
  if(!confirm('¿Confirmás '+qty+' unidades como stock inicial de '+product.name+'? Solo se puede inicializar una vez.'))return
  setBusy(product.id);setError('')
  try{const {error:e}=await supabase.rpc('initialize_candy_stock',{p_product_id:product.id,p_quantity:qty,p_min_quantity:min});if(e)throw e;await refresh()}catch(e){setError('No se pudo cargar el stock inicial: '+e.message)}finally{setBusy('')}
 }
 async function move(product,kind){
  const qty=Number(quantities[product.id]??1)
  if(!stock[product.id])return alert('Primero cargá el stock inicial de este producto.')
  if(!Number.isSafeInteger(qty)||qty<=0)return alert('Ingresá una cantidad entera mayor que cero.')
  const current=stock[product.id]?.quantity??0
  if(kind==='direct_sale'&&qty>current)return alert('No hay unidades suficientes.')
  if(kind==='direct_sale'&&!confirm('¿Registrar venta directa de '+qty+' unidad(es) de '+product.name+'?'))return
  setBusy(product.id);setError('')
  try{
   const {error:e}=await supabase.rpc('adjust_candy_stock',{p_product_id:product.id,p_delta:kind==='restock'?qty:-qty,p_kind:kind,p_operation_id:crypto.randomUUID()})
   if(e)throw e
   await refresh();await loadMovements();setQuantities(v=>({...v,[product.id]:1}))
  }catch(e){setError('No se registró el movimiento: '+e.message)}finally{setBusy('')}
 }
 const visible=candies.filter(p=>p.name.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))
 return <section className="panel" style={{marginBottom:16}}>
  <div className="panel-heading"><div><h3>🍬 Stock de golosinas</h3><small>Ingresos y ventas directas por unidad. El inventario de polifan no se modifica.</small></div></div>
  <div className="actions" style={{marginTop:12}}><input type="search" placeholder="Buscar golosina..." value={search} onChange={e=>setSearch(e.target.value)}/><button type="button" className="ghost" onClick={refresh}>Actualizar stock</button></div>
  {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
  <div style={{display:'grid',gap:10,marginTop:12}}>
   {visible.map(p=>{const row=stock[p.id],quantity=row?.quantity??0,min=row?.min_quantity??5;return <div key={p.id} style={{border:'1px solid #ddd',borderRadius:10,padding:12,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
    <div><strong>{p.name}</strong><div style={{fontSize:13}}>{row?<>Existencias: <b>{quantity}</b> · {quantity===0?'Sin stock':quantity<=min?'Stock bajo':'Disponible'}</>:<b>Stock inicial pendiente</b>}</div></div>
    <div className="actions">{!row&&<input aria-label={'Stock mínimo de '+p.name} title="Stock mínimo" type="number" min="0" step="1" style={{width:75}} value={minimums[p.id]??5} onChange={e=>setMinimums(v=>({...v,[p.id]:e.target.value}))}/>}<input aria-label={'Cantidad de '+p.name} type="number" min="1" step="1" style={{width:85}} value={quantities[p.id]??1} onChange={e=>setQuantities(v=>({...v,[p.id]:e.target.value}))}/>{!row?<button type="button" disabled={Boolean(busy)} onClick={()=>initialize(p)}>Cargar stock inicial</button>:<button type="button" disabled={Boolean(busy)} onClick={()=>move(p,'restock')}>+ Ingresar</button>}<button type="button" className="ghost" disabled={Boolean(busy)||!row||quantity===0} onClick={()=>move(p,'direct_sale')}>− Venta directa</button></div>
   </div>})}
  </div>
  {!candies.length&&<p className="muted">Todavía no hay productos en la categoría Golosinas.</p>}
  <details style={{marginTop:16}}><summary><b>Últimos movimientos ({movements.length})</b></summary><div style={{display:'grid',gap:6,marginTop:10}}>{movements.map(m=><div key={m.id} style={{borderBottom:'1px solid #ddd',padding:6}}><b>{candies.find(p=>p.id===m.product_id)?.name||m.product_id}</b> · {m.kind==='restock'?'Ingreso':'Venta directa'} · {m.delta>0?'+':''}{m.delta} u. · {new Date(m.created_at).toLocaleString('es-AR')}</div>)}</div></details>
 </section>
}
