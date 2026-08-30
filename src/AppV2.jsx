import React,{Suspense,lazy,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from './supabase'
import {emptyState} from './lib/constants'
import {loadV2Sections,patchV2Sections,pageSections,pageNeedsFullCatalog} from './lib/v2Data'
import Login from './pages/Login'
import {APP_VERSION_LABEL,APP_UPDATED_AT} from './version'

const Dashboard=lazy(()=>import('./pages/Dashboard'))
const OrderForm=lazy(()=>import('./pages/OrderForm'))
const Orders=lazy(()=>import('./pages/Orders'))
const OrdersFinance=lazy(()=>import('./pages/OrdersFinance'))
const CutList=lazy(()=>import('./pages/CutList'))
const CutBatches=lazy(()=>import('./pages/CutBatches'))
const Stock=lazy(()=>import('./pages/Stock'))
const Clients=lazy(()=>import('./pages/Clients'))
const Monthly=lazy(()=>import('./pages/Monthly'))
const Expenses=lazy(()=>import('./pages/Expenses'))
const Settings=lazy(()=>import('./pages/Settings'))
const CatalogAdmin=lazy(()=>import('./pages/CatalogAdmin'))
const Analytics=lazy(()=>import('./pages/Analytics'))
const WebRequests=lazy(()=>import('./pages/WebRequestsGrouped'))
const CatalogAssistant=lazy(()=>import('./pages/CatalogAssistant'))
const CustomerTrust=lazy(()=>import('./pages/CustomerTrust'))
const ProductionCalendar=lazy(()=>import('./pages/ProductionCalendar'))
const MotorDefinitivo=lazy(()=>import('./pages/MotorDefinitivo'))
const SvgLibrary=lazy(()=>import('./pages/SvgLibrary'))
const OperationsHub=lazy(()=>import('./pages/OperationsHub'))
const CostSettings=lazy(()=>import('./pages/CostSettings'))
const Quotes=lazy(()=>import('./pages/Quotes'))

const V2_CACHE='polifan-v2-section-cache'
const PUBLIC_CATALOG_URL='https://tu-vida-en-tinta-catalogo-v2.vercel.app/'
const stable=value=>{try{return JSON.stringify(value)}catch{return String(value)}}
const changedKeys=(before,after)=>[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>stable(before?.[k])!==stable(after?.[k]))
const recordSections=new Set(['orders','clients','movements','cutBatches','quotes','incomes','expenses','generatedSheets','customerReviews','customerPhotos','svgLibrary','customerCatalog','catalogCollections'])
const Loading=()=> <div className="v2-boot"><div className="v2-boot-orb"/><b>Preparando tu espacio de trabajo</b><span>Cargando sólo lo necesario…</span></div>
const readCache=()=>{try{return JSON.parse(localStorage.getItem(V2_CACHE)||'{}')}catch{return{}}}
const writeCache=value=>{try{localStorage.setItem(V2_CACHE,JSON.stringify(value))}catch{}}

function mergeArray(base,remote,wanted,key){
  const bm=new Map((base||[]).map(x=>[String(x?.id),x])),rm=new Map((remote||[]).map(x=>[String(x?.id),x])),wm=new Map((wanted||[]).map(x=>[String(x?.id),x]))
  const ids=new Set([...bm.keys(),...wm.keys()]),out=new Map(rm),conflicts=[]
  for(const id of ids){
    const b=bm.get(id),r=rm.get(id),w=wm.get(id)
    if(stable(b)===stable(w))continue
    if(w===undefined){out.delete(id);continue}
    if(b!==undefined&&r!==undefined&&stable(r)!==stable(b)&&stable(r)!==stable(w)){conflicts.push(id);continue}
    out.set(id,w)
  }
  const order=[...(remote||[]).map(x=>String(x?.id)),...(wanted||[]).map(x=>String(x?.id))]
  return conflicts.length?{ok:false,conflicts}:{ok:true,value:[...new Set(order)].map(id=>out.get(id)).filter(Boolean)}
}

function CatalogAccess(){
  return <div className="panel v2-catalog-access"><div><small>CATÁLOGO PÚBLICO</small><h3>Compartí el catálogo y medí de dónde llegan los pedidos.</h3></div><button className="primary" onClick={()=>window.open(PUBLIC_CATALOG_URL,'_blank','noopener,noreferrer')}>Abrir catálogo ↗</button></div>
}

export default function AppV2(){
  const cached=useMemo(readCache,[]),initial={...emptyState(),...(cached.data||{})}
  const [session,setSession]=useState(null),[authReady,setAuthReady]=useState(false),[db,setDb]=useState(initial),[page,setPage]=useState(()=>sessionStorage.getItem('polifan-current-page')||'dashboard')
  const [loading,setLoading]=useState(true),[pageLoading,setPageLoading]=useState(false),[saving,setSaving]=useState(false),[mobileOpen,setMobileOpen]=useState(false),[editingOrder,setEditingOrder]=useState(null)
  const loadedRef=useRef(new Set(cached.keys||[])),baselineRef=useRef(initial),requestRef=useRef(0)

  useEffect(()=>{
    let alive=true
    supabase.auth.getSession().then(({data})=>{if(!alive)return;setSession(data.session);setAuthReady(true)})
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>{if(!alive)return;setSession(s);setAuthReady(true)})
    return()=>{alive=false;subscription.unsubscribe()}
  },[])

  useEffect(()=>{sessionStorage.setItem('polifan-current-page',page)},[page])
  useEffect(()=>{if(session)ensurePage(page,true)},[session])

  async function ensurePage(target,initialLoad=false){
    const keys=pageSections(target),full=pageNeedsFullCatalog(target)
    const missing=full?keys:keys.filter(k=>!loadedRef.current.has(k))
    if(!missing.length){setLoading(false);setPageLoading(false);return}
    const request=++requestRef.current
    if(initialLoad)setLoading(true);else setPageLoading(true)
    try{
      const result=await loadV2Sections(missing,{fullCatalog:full})
      if(request!==requestRef.current)return
      const next={...db,...result.data}
      Object.keys(result.data).forEach(k=>loadedRef.current.add(k))
      baselineRef.current={...baselineRef.current,...result.data}
      setDb(next);writeCache({keys:[...loadedRef.current],data:Object.fromEntries([...loadedRef.current].filter(k=>k!=='customerCatalog'||target!=='catalog').map(k=>[k,next[k]]))})
    }catch(error){console.error(error);alert('No se pudo cargar esta sección: '+error.message)}finally{if(request===requestRef.current){setLoading(false);setPageLoading(false)}}
  }

  async function saveData(next){
    const keys=changedKeys(db,next)
    if(!keys.length)return{ok:true,data:db}
    setSaving(true)
    try{
      const latestResult=await loadV2Sections(keys,{fullCatalog:keys.includes('customerCatalog')&&pageNeedsFullCatalog(page)})
      const latest={...db,...latestResult.data},baseline=baselineRef.current,patch={},conflicts=[]
      for(const key of keys){
        if(recordSections.has(key)){
          const merged=mergeArray(baseline[key],latest[key],next[key],key)
          if(!merged.ok)conflicts.push(`${key} (${merged.conflicts.length})`);else patch[key]=merged.value
        }else if(stable(latest[key])!==stable(baseline[key])&&stable(latest[key])!==stable(next[key]))conflicts.push(key)
        else patch[key]=next[key]
      }
      if(conflicts.length){alert('Otra sesión modificó exactamente el mismo dato: '+conflicts.join(', ')+'. Recargá esa sección y repetí sólo ese cambio.');return{ok:false,conflict:true}}
      await patchV2Sections(patch,session?.user?.id)
      const confirmed={...db,...patch};baselineRef.current={...baselineRef.current,...patch};setDb(confirmed)
      writeCache({keys:[...loadedRef.current],data:Object.fromEntries([...loadedRef.current].map(k=>[k,confirmed[k]]))})
      return{ok:true,data:confirmed}
    }catch(error){console.error(error);alert('No se pudo guardar: '+error.message);return{ok:false,error}}finally{setSaving(false)}
  }

  async function saveOrderData(next){return saveData(next)}
  async function logout(){await supabase.auth.signOut();setSession(null)}
  function go(id){if(id==='new'){try{localStorage.removeItem('polifan-order-draft-v1')}catch{}setEditingOrder(null)}setPage(id);setMobileOpen(false);ensurePage(id,false)}
  function openQuoteAsOrder(q){
    const customer=q.customer||{},fullName=q.client||customer.name||'',regular=(q.items||[]).filter(i=>i.inventoryTracked!==false&&!i.manualItem).map(i=>({figure:i.figure||i.name||'',productId:i.productId||'',qty:Number(i.qty||1),inventoryTracked:true})),manual=(q.items||[]).filter(i=>i.inventoryTracked===false||i.manualItem).map(i=>({figure:i.figure||i.name||'',qty:Number(i.qty||1),unitPrice:Number(i.unitPrice||i.price||0),inventoryTracked:false,manualItem:true}))
    const draft={id:crypto.randomUUID(),firstName:q.firstName||customer.firstName||String(fullName).split(' ')[0]||'',lastName:q.lastName||customer.lastName||String(fullName).split(' ').slice(1).join(' '),client:fullName,phone:q.phone||customer.phone||'',dni:q.dni||customer.dni||'',email:q.email||customer.email||'',address:q.address||customer.address||'',betweenStreets:q.betweenStreets||customer.betweenStreets||'',locality:q.locality||customer.locality||'',district:q.district||customer.district||'',province:q.province||customer.province||'',postalCode:q.postalCode||customer.postalCode||'',deliveryType:q.deliveryType||'Logística GBA/CABA',carrier:q.deliveryType||'Logística GBA/CABA',delivery:q.delivery||'',priority:q.priority||'Normal',status:'Ingresado',shippingCost:q.shippingCost||'',notes:[q.notes,`Convertido desde presupuesto ${q.code}`].filter(Boolean).join(' · '),items:regular.length?regular:[{figure:'',qty:1,inventoryTracked:true}],manualItems:manual,quoteId:q.id}
    try{localStorage.setItem('polifan-order-draft-v1',JSON.stringify(draft))}catch{}setEditingOrder(null);setPage('new');ensurePage('new')
  }

  if(!authReady)return <Loading/>
  if(!session)return <Login/>
  if(loading)return <Loading/>

  const navGroups=[['NEGOCIO',[['dashboard','⌂','Inicio'],['operations','⚡','Centro operativo'],['new','＋','Nuevo pedido'],['orders','▤','Pedidos'],['clients','♙','Clientes']]],['PRODUCCIÓN',[['calendar','◫','Calendario'],['cut','✂','Para cortar'],['cutbatches','▦','En corte'],['sheetplanner','◎','Generar placas'],['svglibrary','⌁','Biblioteca SVG'],['stock','◇','Inventario']]],['VENTAS',[['assistant','✦','Asistente del catálogo'],['quotes','▤','Presupuestos'],['webrequests','↙','Solicitudes web'],['trust','★','Fotos y reseñas'],['catalog','▦','Catálogo'],['analytics','◒','Estadísticas']]],['FINANZAS',[['expenses','◉','Caja y gastos'],['monthly','▥','Resumen mensual'],['costs','◫','Costos']]],['SISTEMA',[['settings','⚙','Configuración']]]]

  return <div className="app v2-shell">
    <aside className={'sidebar '+(mobileOpen?'open':'')}>
      <div className="brand"><img className="brand-logo" src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta"/><div><small>TU VIDA EN TINTA</small><b>POLIFAN <em>V2</em></b><span className="version-badge">{APP_VERSION_LABEL} · {APP_UPDATED_AT}</span></div></div>
      <nav>{navGroups.map(([group,items])=><div className="nav-group" key={group}><small>{group}</small>{items.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>go(id)}><span>{icon}</span>{label}</button>)}</div>)}</nav>
      <div className="side-help"><b>Arquitectura V2</b><small>Carga por módulos · sincronización selectiva</small></div>
    </aside>
    <div className="content"><header><button className="menu" onClick={()=>setMobileOpen(v=>!v)}>☰</button><div className="v2-header-title"><small>ESPACIO DE PRODUCCIÓN</small><b>{navGroups.flatMap(g=>g[1]).find(x=>x[0]===page)?.[2]||'Polifan'}</b></div><div className="header-right"><span className={'sync '+(saving?'saving':'')}>{saving?'Guardando cambio…':pageLoading?'Cargando módulo…':'Sincronizado'}</span><div className="avatar">{session.user.email?.[0]?.toUpperCase()||'A'}</div><div className="user"><b>{session.user.email?.split('@')[0]}</b><small>Administrador</small></div><button className="ghost" onClick={logout}>Salir</button></div></header><main className={pageLoading?'v2-page-loading':''}><Suspense fallback={<Loading/>}>
      {page==='dashboard'&&<Dashboard db={db} go={go}/>} {page==='operations'&&<OperationsHub db={db} onSave={saveData} go={go}/>} {page==='new'&&<OrderForm key={editingOrder?.id||'new'} db={db} onSave={saveOrderData} editing={editingOrder} clearEdit={()=>setEditingOrder(null)}/>} {page==='orders'&&<><Orders db={db} onSave={saveData} onEdit={o=>{setEditingOrder(o);setPage('new');ensurePage('new')}}/><OrdersFinance db={db}/></>}
      {page==='calendar'&&<ProductionCalendar db={db} onSave={saveData} go={go}/>} {page==='cut'&&<CutList db={db} onSave={saveData} goMotor={()=>go('sheetplanner')}/>} {page==='cutbatches'&&<CutBatches db={db} onSave={saveData}/>} {page==='sheetplanner'&&<MotorDefinitivo db={db} onSave={saveData}/>} {page==='svglibrary'&&<SvgLibrary db={db} onSave={saveData}/>} {page==='stock'&&<Stock db={db} onSave={saveData}/>} {page==='clients'&&<Clients db={db} onSave={saveData} go={go}/>} {page==='assistant'&&<CatalogAssistant db={db} onSave={saveData}/>} {page==='quotes'&&<Quotes db={db} onSave={saveData} onOpenOrder={openQuoteAsOrder}/>} {page==='webrequests'&&<WebRequests db={db} onSave={saveData}/>} {page==='trust'&&<CustomerTrust db={db} onSave={saveData}/>} {page==='catalog'&&<><CatalogAccess/><CatalogAdmin db={db} onSave={saveData}/></>} {page==='analytics'&&<Analytics db={db}/>} {page==='expenses'&&<Expenses db={db} onSave={saveData}/>} {page==='monthly'&&<Monthly db={db}/>} {page==='costs'&&<CostSettings db={db} onSave={saveData}/>} {page==='settings'&&<Settings db={db} onSave={saveData}/>} 
    </Suspense></main></div>
  </div>
}