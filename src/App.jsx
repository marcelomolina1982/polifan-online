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
import OrderControl from './pages/OrderControl'
import Analytics from './pages/Analytics'
import WebRequests from './pages/WebRequests'
import AttentionCenter from './pages/AttentionCenter'
import CatalogAssistant from './pages/CatalogAssistant'
import ProductionCalendar from './pages/ProductionCalendar'
import SheetPlanner from './pages/SheetPlanner'
import SvgLibrary from './pages/SvgLibrary'
import SvgAnalyzer from './pages/SvgAnalyzer'
import { APP_VERSION_LABEL, APP_UPDATED_AT } from './version'

export default function App(){
  const params = new URLSearchParams(window.location.search)
  const controlMode = params.get('control')
  const customerMode = window.location.hash === '#pedido' || params.get('pedido') === '1'
  if(controlMode) return <OrderControl />
  if(customerMode) return <CustomerOrder />
  const [session,setSession] = useState(null)
  const cachedState = (()=>{ try{return JSON.parse(localStorage.getItem('polifan-app-cache')||'null')}catch{return null} })()
  const [db,setDb] = useState(cachedState ? {...emptyState(),...cachedState} : emptyState())
  const [loading,setLoading] = useState(!cachedState)
  const [saving,setSaving] = useState(false)
  const [page,setPage] = useState(()=>sessionStorage.getItem('polifan-current-page')||'dashboard')
  const [mobileOpen,setMobileOpen] = useState(false)
  const [editingOrder,setEditingOrder] = useState(null)

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{
      setSession(data.session)
      if(data.session) loadData(!cachedState)
      else setLoading(false)
    })
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,s)=>{
      setSession(s)
      if(s) loadData(false)
    })
    const refresh=()=>{ if(document.visibilityState==='visible') loadData(false,true) }
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible'&&!saving)loadData(false,true)},25000)
    document.addEventListener('visibilitychange',refresh)
    return ()=>{subscription.unsubscribe();window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
  },[])

  useEffect(()=>{sessionStorage.setItem('polifan-current-page',page)},[page])

  async function loadData(initial=false,silent=false){
    if(initial) setLoading(true)
    const {data,error} = await supabase.from('app_state').select('data').eq('id','main').maybeSingle()
    if(error){
      if(!silent) alert('No se pudo conectar con Supabase: '+error.message)
      setLoading(false)
      return
    }
    const next=data?.data ? {...emptyState(),...data.data} : emptyState()
    setDb(next)
    try{localStorage.setItem('polifan-app-cache',JSON.stringify(next))}catch{}
    setLoading(false)
  }

  async function saveData(next){
    setSaving(true)
    const previous=db
    const updatedAt=new Date().toISOString()
    const {data:saved,error} = await supabase.from('app_state').upsert({
      id:'main', data:next, updated_at:updatedAt, updated_by:session.user.id
    },{onConflict:'id'}).select('data,updated_at').single()
    setSaving(false)
    if(error){
      setDb(previous)
      alert('No se pudo guardar en Supabase. El cambio no fue aplicado: '+error.message)
      return {ok:false,error}
    }
    const confirmed=saved?.data ? {...emptyState(),...saved.data} : next
    setDb(confirmed)
    try{localStorage.setItem('polifan-app-cache',JSON.stringify(confirmed))}catch{}
    return {ok:true,updatedAt:saved?.updated_at||updatedAt}
  }

  async function logout(){
    await supabase.auth.signOut()
    setSession(null)
  }

  if(!session) return <Login />
  if(loading) return <div className="center-screen">Cargando sistema…</div>

  function openNewOrder(){
    try{ localStorage.removeItem('polifan-order-draft-v1') }catch{}
    setEditingOrder(null)
    setPage('new')
    setMobileOpen(false)
  }

  const navGroups = [
    ['NEGOCIO', [['dashboard','⌂','Inicio'], ['new','＋','Nuevo pedido'], ['orders','▤','Pedidos'], ['clients','♙','Clientes']]],
    ['PRODUCCIÓN', [['calendar','🗓','Calendario'], ['cut','✂','Para cortar'], ['cutbatches','▦','En corte'], ['sheetplanner','▧','Diseñar placas'], ['svganalyzer','⌗','Analizar placas SVG'], ['svglibrary','⌁','Biblioteca SVG'], ['stock','◇','Inventario']]],
    ['VENTAS', [['assistant','🤖','Asistente del catálogo'], ['attention','💬','Centro de Atención'], ['webrequests','🛒','Solicitudes web'], ['catalog','▦','Catálogo'], ['analytics','📊','Estadísticas']]],
    ['FINANZAS', [['expenses','💰','Caja y gastos'], ['monthly','▥','Resumen mensual']]],
    ['SISTEMA', [['settings','⚙','Configuración']]],
  ]

  return <div className="app">
    <aside className={'sidebar '+(mobileOpen?'open':'')}>
      <div className="brand"><img className="brand-logo" src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta"/><div><small>TU VIDA EN TINTA</small><b>POLIFAN</b><span className="version-badge">VERSIÓN {APP_VERSION_LABEL} · {APP_UPDATED_AT}</span></div></div>
      <nav>{navGroups.map(([group,items])=><div className="nav-group" key={group}><small>{group}</small>{items.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>{if(id==='new') openNewOrder(); else {setPage(id);setMobileOpen(false)}}}><span>{icon}</span>{label}</button>)}</div>)}</nav>
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
        {page==='dashboard' && <Dashboard db={db} go={(id)=>id==='new'?openNewOrder():setPage(id)}/>} 
        {page==='new' && <OrderForm key={editingOrder?.id||'new'} db={db} onSave={saveData} editing={editingOrder} clearEdit={()=>setEditingOrder(null)}/>} 
        {page==='orders' && <Orders db={db} onSave={saveData} onEdit={(o)=>{setEditingOrder(o);setPage('new')}}/>} 
        {page==='calendar' && <ProductionCalendar db={db} onSave={saveData} go={(id)=>id==='new'?openNewOrder():setPage(id)}/>} 
        {page==='cut' && <CutList db={db} onSave={saveData} goBatches={()=>setPage('cutbatches')}/>} 
        {page==='cutbatches' && <CutBatches db={db} onSave={saveData}/>} 
        {page==='sheetplanner' && <SheetPlanner db={db} onSave={saveData}/>} 
        {page==='svganalyzer' && <SvgAnalyzer db={db} onSave={saveData}/>} 
        {page==='svglibrary' && <SvgLibrary db={db} onSave={saveData}/>} 
        {page==='stock' && <Stock db={db} onSave={saveData}/>} 
        {page==='clients' && <Clients db={db} onSave={saveData}/>} 
        {page==='assistant' && <CatalogAssistant db={db} onSave={saveData}/>} 
        {page==='attention' && <AttentionCenter db={db} onSave={saveData}/>} 
        {page==='webrequests' && <WebRequests db={db} onSave={saveData}/>} 
        {page==='catalog' && <CatalogAdmin db={db} onSave={saveData}/>} 
        {page==='analytics' && <Analytics db={db}/>} 
        {page==='expenses' && <Expenses db={db} onSave={saveData}/>} 
        {page==='monthly' && <Monthly db={db}/>} 
        {page==='settings' && <Settings db={db} onSave={saveData}/>} 
      </main>
    </div>
  </div>
}
