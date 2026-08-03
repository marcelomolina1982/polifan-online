import React, { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { emptyState } from './lib/constants'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import OrderForm from './pages/OrderForm'
import Orders from './pages/Orders'
import CutList from './pages/CutList'
import CutBatches from './pages/CutBatches'
import Stock from './pages/Stock'
import Clients from './pages/Clients'
import Monthly from './pages/Monthly'
import Expenses from './pages/Expenses'
import Settings from './pages/Settings'
import CatalogAdmin from './pages/CatalogAdmin'
import CustomerOrder from './pages/CustomerOrder'
import Analytics from './pages/Analytics'

export default function App(){
  const customerMode = window.location.hash === '#pedido' || new URLSearchParams(window.location.search).get('pedido') === '1'
  if(customerMode) return <CustomerOrder />
  const [session,setSession] = useState(null)
  const [db,setDb] = useState(emptyState())
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [page,setPage] = useState('dashboard')
  const [mobileOpen,setMobileOpen] = useState(false)
  const [editingOrder,setEditingOrder] = useState(null)

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{
      setSession(data.session)
      if(data.session) loadData()
      else setLoading(false)
    })
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,s)=>{
      setSession(s)
      if(s) loadData()
    })
    return ()=>subscription.unsubscribe()
  },[])

  async function loadData(){
    setLoading(true)
    const {data,error} = await supabase.from('app_state').select('data').eq('id','main').maybeSingle()
    if(error){
      alert('No se pudo conectar con Supabase: '+error.message)
      setLoading(false)
      return
    }
    setDb(data?.data ? {...emptyState(),...data.data} : emptyState())
    setLoading(false)
  }

  async function saveData(next){
    setDb(next)
    setSaving(true)
    const {error} = await supabase.from('app_state').upsert({
      id:'main', data:next, updated_at:new Date().toISOString(), updated_by:session.user.id
    },{onConflict:'id'})
    setSaving(false)
    if(error) alert('No se pudo guardar: '+error.message)
  }

  async function logout(){
    await supabase.auth.signOut()
    setSession(null)
  }

  if(!session) return <Login />
  if(loading) return <div className="center-screen">Cargando sistema…</div>

  const navGroups = [
    ['NEGOCIO', [['dashboard','⌂','Inicio'], ['new','＋','Nuevo pedido'], ['orders','▤','Pedidos'], ['clients','♙','Clientes']]],
    ['PRODUCCIÓN', [['cut','✂','Para cortar'], ['cutbatches','▦','En corte'], ['stock','◇','Inventario']]],
    ['VENTAS', [['catalog','▦','Catálogo'], ['analytics','📊','Estadísticas']]],
    ['FINANZAS', [['expenses','💰','Caja y gastos'], ['monthly','▥','Resumen mensual']]],
    ['SISTEMA', [['settings','⚙','Configuración']]],
  ]

  return <div className="app">
    <aside className={'sidebar '+(mobileOpen?'open':'')}>
      <div className="brand"><img className="brand-logo" src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta"/><div><small>TU VIDA EN TINTA</small><b>POLIFAN</b><span className="version-badge">VERSIÓN 11.5</span></div></div>
      <nav>{navGroups.map(([group,items])=><div className="nav-group" key={group}><small>{group}</small>{items.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>{setPage(id);setMobileOpen(false)}}><span>{icon}</span>{label}</button>)}</div>)}</nav>
      <div className="side-help"><b>Sistema online</b><small>Pedidos y stock sincronizados en todos tus dispositivos.</small></div>
    </aside>

    <div className="content">
      <header>
        <button className="menu" onClick={()=>setMobileOpen(v=>!v)}>☰</button>
        <div className="header-right">
          <span className={'sync '+(saving?'saving':'')}>{saving?'Guardando…':'Guardado online'}</span>
          <div className="avatar">{session.user.email?.[0]?.toUpperCase()||'A'}</div>
          <div className="user"><b>{session.user.email?.split('@')[0]}</b><small>Administrador</small></div>
          <button className="ghost" onClick={logout}>Salir</button>
        </div>
      </header>
      <main>
        {page==='dashboard' && <Dashboard db={db} go={setPage}/>} 
        {page==='new' && <OrderForm db={db} onSave={saveData} editing={editingOrder} clearEdit={()=>setEditingOrder(null)}/>} 
        {page==='orders' && <Orders db={db} onSave={saveData} onEdit={(o)=>{setEditingOrder(o);setPage('new')}}/>} 
        {page==='cut' && <CutList db={db} onSave={saveData} goBatches={()=>setPage('cutbatches')}/>} 
        {page==='cutbatches' && <CutBatches db={db} onSave={saveData}/>} 
        {page==='stock' && <Stock db={db} onSave={saveData}/>} 
        {page==='clients' && <Clients db={db} onSave={saveData}/>} 
        {page==='catalog' && <CatalogAdmin db={db} onSave={saveData}/>} 
        {page==='analytics' && <Analytics/>} 
        {page==='expenses' && <Expenses db={db} onSave={saveData}/>} 
        {page==='monthly' && <Monthly db={db}/>} 
        {page==='settings' && <Settings db={db} onSave={saveData}/>} 
      </main>
    </div>
  </div>
}
