import React,{Suspense,lazy,useEffect,useRef,useState} from 'react'
import {supabase} from './supabase'
import {emptyState} from './lib/constants'
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
const CustomerOrder=lazy(()=>import('./pages/CustomerOrder'))
const OrderControl=lazy(()=>import('./pages/OrderControl'))
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
const Loading=()=> <div className="center-screen">Sincronizando datos seguros…</div>
const stableJson=value=>{try{return JSON.stringify(value)}catch{return String(value)}}
const changedTopLevelKeys=(before,after)=>{
  const keys=new Set([...Object.keys(before||{}),...Object.keys(after||{})])
  return [...keys].filter(key=>stableJson(before?.[key])!==stableJson(after?.[key]))
}
const mergeArrayById=(baseline,latest,next)=>{
  const baseMap=new Map((baseline||[]).map(item=>[String(item?.id),item]))
  const latestMap=new Map((latest||[]).map(item=>[String(item?.id),item]))
  const nextMap=new Map((next||[]).map(item=>[String(item?.id),item]))
  const ids=new Set([...baseMap.keys(),...nextMap.keys()])
  const touched=[...ids].filter(id=>stableJson(baseMap.get(id))!==stableJson(nextMap.get(id)))
  const conflicts=touched.filter(id=>{
    const base=baseMap.get(id),remote=latestMap.get(id),wanted=nextMap.get(id)
    return stableJson(remote)!==stableJson(base)&&stableJson(remote)!==stableJson(wanted)
  })
  if(conflicts.length)return{ok:false,conflicts}
  const merged=new Map(latestMap)
  touched.forEach(id=>{const wanted=nextMap.get(id);wanted===undefined?merged.delete(id):merged.set(id,wanted)})
  const order=[...(latest||[]).map(x=>String(x?.id)),...(next||[]).map(x=>String(x?.id))]
  return{ok:true,value:[...new Set(order)].map(id=>merged.get(id)).filter(Boolean)}
}
const MERGE_BY_RECORD=new Set(['customerCatalog','catalogCollections','orders','clients'])

function CatalogAccess(){
  const base=`${window.location.origin}/?pedido=1`
  const links=[['Instagram',`${base}&src=instagram`],['TikTok',`${base}&src=tiktok`],['WhatsApp',`${base}&src=whatsapp`]]
  async function copy(url,label){try{await navigator.clipboard.writeText(url);alert(`Enlace de ${label} copiado.`)}catch{window.prompt(`Copiá el enlace de ${label}:`,url)}}
  return <div className="panel" style={{marginBottom:16}}><div className="panel-heading"><div><h3>Acceso al catálogo público</h3><small>Usá un enlace distinto en cada red para medir visitas y pedidos por origen.</small></div><button className="primary" onClick={()=>window.open(base,'_blank','noopener,noreferrer')}>Abrir catálogo</button></div><div className="actions" style={{flexWrap:'wrap',marginTop:12}}>{links.map(([label,url])=><button key={label} className="ghost" onClick={()=>copy(url,label)}>Copiar enlace {label}</button>)}</div></div>
}

export default function App(){
  const params=new URLSearchParams(window.location.search),controlMode=params.get('control'),customerMode=window.location.hash==='#pedido'||params.get('pedido')==='1'
  if(controlMode)return <Suspense fallback={<Loading/>}><OrderControl/></Suspense>
  if(customerMode)return <Suspense fallback={<Loading/>}><CustomerOrder/></Suspense>
  const [session,setSession]=useState(null)
  const cachedState=(()=>{try{return JSON.parse(localStorage.getItem('polifan-app-cache')||'null')}catch{return null}})()
  const initialState=cachedState?{...emptyState(),...cachedState}:emptyState()
  const [db,setDb]=useState(initialState),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false)
  const savingRef=useRef(false),mutationEpochRef=useRef(0),loadSequenceRef=useRef(0),authBootRef=useRef(false),serverRevisionRef=useRef(''),serverDataRef=useRef(initialState)
  const [page,setPage]=useState(()=>sessionStorage.getItem('polifan-current-page')||'dashboard'),[mobileOpen,setMobileOpen]=useState(false),[editingOrder,setEditingOrder]=useState(null)
  useEffect(()=>{
    let active=true
    supabase.auth.getSession().then(({data})=>{if(!active)return;const s=data.session;setSession(s);if(s&&!authBootRef.current){authBootRef.current=true;loadData(true)}else if(!s)setLoading(false)})
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>{if(!active)return;setSession(s);if(!s){authBootRef.current=false;setLoading(false);return}if(!authBootRef.current){authBootRef.current=true;loadData(true)}})
    return()=>{active=false;subscription.unsubscribe()}
  },[])
  useEffect(()=>{sessionStorage.setItem('polifan-current-page',page)},[page])
  async function loadData(initial=false,silent=false){
    if(savingRef.current){if(initial)setLoading(false);return}
    const startedEpoch=mutationEpochRef.current,sequence=++loadSequenceRef.current
    if(initial)setLoading(true)
    const {data,error}=await supabase.from('app_state').select('data,updated_at').eq('id','main').maybeSingle()
    if(error){if(cachedState){const fallback={...emptyState(),...cachedState};setDb(fallback);serverDataRef.current=fallback}if(!silent)alert('No se pudo conectar con Supabase: '+error.message+'\nSe mantiene la última copia disponible en esta computadora.');if(sequence===loadSequenceRef.current)setLoading(false);return}
    if(savingRef.current||startedEpoch!==mutationEpochRef.current||sequence!==loadSequenceRef.current)return
    const next=data?.data?{...emptyState(),...data.data}:(cachedState?{...emptyState(),...cachedState}:emptyState())
    serverRevisionRef.current=data?.updated_at||'';serverDataRef.current=next;setDb(next);try{localStorage.setItem('polifan-app-cache',JSON.stringify(next))}catch{}setLoading(false)
  }
  async function saveData(next){
    mutationEpochRef.current+=1;loadSequenceRef.current+=1;savingRef.current=true;setSaving(true)
    const previous=db,baseline=serverDataRef.current||previous,changedKeys=changedTopLevelKeys(previous,next)
    if(!changedKeys.length){savingRef.current=false;setSaving(false);return{ok:true,updatedAt:serverRevisionRef.current,data:baseline}}
    try{localStorage.setItem('polifan-app-backup-last',JSON.stringify({savedAt:new Date().toISOString(),data:baseline}))}catch{}
    let lastError=null
    for(let attempt=1;attempt<=3;attempt++){
      const {data:latestRow,error:readError}=await supabase.from('app_state').select('data,updated_at').eq('id','main').maybeSingle()
      if(readError){lastError=readError;break}
      const latest={...emptyState(),...(latestRow?.data||{})},merged={...latest},conflicts=[]
      for(const key of changedKeys){
        if(MERGE_BY_RECORD.has(key)){
          const section=mergeArrayById(baseline[key],latest[key],next[key])
          if(!section.ok)conflicts.push(`${key} (${section.conflicts.length} elemento${section.conflicts.length===1?'':'s'})`)
          else merged[key]=section.value
        }else if(stableJson(latest[key])!==stableJson(baseline[key]))conflicts.push(key)
        else merged[key]=next[key]
      }
      if(conflicts.length){savingRef.current=false;setSaving(false);alert('No se guardó este cambio porque otra sesión modificó exactamente el mismo dato al mismo tiempo: '+conflicts.join(', ')+'.\n\nLos cambios distintos se combinan automáticamente. Recargá y repetí solamente este cambio.');return{ok:false,conflict:true,keys:conflicts}}
      const updatedAt=new Date().toISOString(),payload={data:merged,updated_at:updatedAt,updated_by:session.user.id}
      let query=supabase.from('app_state').update(payload).eq('id','main');if(latestRow?.updated_at)query=query.eq('updated_at',latestRow.updated_at)
      const result=await query.select('updated_at')
      if(result.error){
        lastError=result.error
        if(/statement timeout/i.test(result.error.message||'')){
          const {data:verify}=await supabase.from('app_state').select('data,updated_at').eq('id','main').maybeSingle()
          const verified=verify?.data&&changedKeys.every(key=>stableJson(verify.data[key])===stableJson(merged[key]))
          if(verified){const confirmed={...emptyState(),...verify.data};serverRevisionRef.current=verify.updated_at||updatedAt;serverDataRef.current=confirmed;setDb(confirmed);try{localStorage.setItem('polifan-app-cache',JSON.stringify(confirmed))}catch{}savingRef.current=false;setSaving(false);return{ok:true,updatedAt:serverRevisionRef.current,data:confirmed,verifiedAfterTimeout:true}}
        }
        if(attempt<3){await new Promise(resolve=>setTimeout(resolve,250*attempt));continue}break
      }
      if(!result.data?.length){lastError=new Error('El estado cambió mientras se estaba guardando.');if(attempt<3){await new Promise(resolve=>setTimeout(resolve,150*attempt));continue}break}
      const confirmed={...emptyState(),...merged};serverRevisionRef.current=result.data[0]?.updated_at||updatedAt;serverDataRef.current=confirmed;setDb(confirmed);try{localStorage.setItem('polifan-app-cache',JSON.stringify(confirmed))}catch{}savingRef.current=false;setSaving(false);return{ok:true,updatedAt:serverRevisionRef.current,data:confirmed}
    }
    savingRef.current=false;setSaving(false);alert('No se pudo guardar en Supabase. Ningún dato más nuevo fue sobrescrito: '+(lastError?.message||'error de sincronización'));return{ok:false,error:lastError||new Error('Error de sincronización')}
  }
  async function saveOrderData(next){
    const previousIds=new Set((db.orders||[]).map(o=>o.id)),converted=(next.orders||[]).filter(o=>!previousIds.has(o.id)&&o.quoteId)
    let adjusted=next
    if(converted.length){const approvedAt=new Date().toISOString(),byQuote=new Map(converted.map(o=>[String(o.quoteId),o]));adjusted={...next,quotes:(next.quotes||db.quotes||[]).map(q=>{const order=byQuote.get(String(q.id));return order?{...q,status:'Aprobado',approvedAt,orderNumber:order.number,updatedAt:approvedAt}:q})}}
    const saved=await saveData(adjusted);if(saved?.ok===false)return saved
    for(const order of converted){const quote=(db.quotes||[]).find(q=>String(q.id)===String(order.quoteId));if(quote?.source==='Web'&&quote.sourceId){const {error}=await supabase.from('web_requests').update({status:'Presupuesto aprobado'}).eq('id',quote.sourceId);if(error)console.error('No se pudo actualizar la solicitud web',error)}}
    return saved
  }
  async function logout(){await supabase.auth.signOut();setSession(null)}
  if(!session)return <Login/>;if(loading)return <Loading/>
  function go(id){if(id==='new')return openNewOrder();setPage(id);setMobileOpen(false)}
  function openNewOrder(){try{localStorage.removeItem('polifan-order-draft-v1')}catch{}setEditingOrder(null);setPage('new');setMobileOpen(false)}
  function openQuoteAsOrder(q){
    const rawItems=q.items||[],regular=rawItems.filter(i=>i.inventoryTracked!==false&&!i.manualItem).map(i=>({figure:i.figure||i.name||'',productId:i.productId||'',qty:Number(i.qty||1),inventoryTracked:true})),manual=rawItems.filter(i=>i.inventoryTracked===false||i.manualItem).map(i=>({figure:i.figure||i.name||'',qty:Number(i.qty||1),unitPrice:Number(i.unitPrice||i.price||0),inventoryTracked:false,manualItem:true})),customer=q.customer||{},legacy=String(q.deliveryType||q.carrier||customer.method||'').toLocaleLowerCase('es'),deliveryType=legacy.includes('retiro')?'Retiro en el local':legacy.includes('via cargo')||legacy.includes('vía cargo')?'Vía Cargo':legacy.includes('otro')?'Otro expreso':'Logística GBA/CABA',fullName=q.client||customer.name||[q.firstName||customer.firstName,q.lastName||customer.lastName].filter(Boolean).join(' ')
    const draft={id:crypto.randomUUID(),date:q.date||'',firstName:q.firstName||customer.firstName||String(fullName||'').trim().split(/\s+/)[0]||'',lastName:q.lastName||customer.lastName||String(fullName||'').trim().split(/\s+/).slice(1).join(' '),client:fullName||'',phone:q.phone||customer.phone||'',dni:q.dni||customer.dni||'',email:q.email||customer.email||'',address:q.address||customer.address||'',betweenStreets:q.betweenStreets||customer.betweenStreets||'',locality:q.locality||customer.locality||'',district:q.district||customer.district||'',province:q.province||customer.province||'',postalCode:q.postalCode||customer.postalCode||'',zone:q.zone||'',deliveryType,carrier:deliveryType,agencyDelivery:q.agencyDelivery||customer.agencyDelivery||'Envío a domicilio',delivery:q.delivery||'',priority:q.priority||'Normal',status:'Ingresado',paid:'No',shippingCost:q.shippingCost||'',shippingPaid:'Pendiente de pago',shippingPackaging:q.shippingPackaging||'No',notes:[q.notes,`Convertido desde presupuesto ${q.code}`].filter(Boolean).join(' · '),items:regular.length?regular:[{figure:'',qty:1,inventoryTracked:true}],manualItems:manual,quoteId:q.id}
    try{localStorage.setItem('polifan-order-draft-v1',JSON.stringify(draft))}catch{}setEditingOrder(null);setPage('new');setMobileOpen(false)
  }
  const navGroups=[['NEGOCIO',[['dashboard','⌂','Inicio'],['operations','⚡','Centro operativo'],['new','＋','Nuevo pedido'],['orders','▤','Pedidos'],['clients','♙','Clientes']]],['PRODUCCIÓN',[['calendar','🗓','Calendario'],['cut','✂','Para cortar'],['cutbatches','▦','En corte'],['sheetplanner','⚙','Generar placas'],['svglibrary','⌁','Biblioteca SVG'],['stock','◇','Inventario']]],['VENTAS',[['assistant','🤖','Asistente del catálogo'],['quotes','🧾','Presupuestos'],['webrequests','🛒','Solicitudes web'],['trust','⭐','Fotos y reseñas'],['catalog','▦','Catálogo'],['analytics','📊','Estadísticas']]],['FINANZAS',[['expenses','💰','Caja y gastos'],['monthly','▥','Resumen mensual'],['costs','🧮','Costos']]],['SISTEMA',[['settings','⚙','Configuración']]]]
  return <div className="app"><aside className={'sidebar '+(mobileOpen?'open':'')}><div className="brand"><img className="brand-logo" src="/logo-tu-vida-en-tinta.png" alt="Tu Vida En Tinta"/><div><small>TU VIDA EN TINTA</small><b>POLIFAN</b><span className="version-badge">VERSIÓN {APP_VERSION_LABEL} · {APP_UPDATED_AT}</span></div></div><nav>{navGroups.map(([group,items])=><div className="nav-group" key={group}><small>{group}</small>{items.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>go(id)}><span>{icon}</span>{label}</button>)}</div>)}</nav><div className="side-help"><b>Sistema online</b><small>Pedidos, producción y costos sincronizados.</small></div></aside><div className="content"><header><button className="menu" onClick={()=>setMobileOpen(v=>!v)}>☰</button><div className="header-right"><span className={'sync '+(saving?'saving':'')}>{saving?'Guardando…':'Guardado online'}</span><div className="avatar">{session.user.email?.[0]?.toUpperCase()||'A'}</div><div className="user"><b>{session.user.email?.split('@')[0]}</b><small>Administrador</small></div><button className="ghost" onClick={logout}>Salir</button></div></header><main><Suspense fallback={<Loading/>}>
  {page==='dashboard'&&<Dashboard db={db} go={go}/>} {page==='operations'&&<OperationsHub db={db} onSave={saveData} go={go}/>} {page==='new'&&<OrderForm key={editingOrder?.id||'new'} db={db} onSave={saveOrderData} editing={editingOrder} clearEdit={()=>setEditingOrder(null)}/>} {page==='orders'&&<><Orders db={db} onSave={saveData} onEdit={o=>{setEditingOrder(o);setPage('new')}}/><OrdersFinance db={db}/></>}
  {page==='calendar'&&<ProductionCalendar db={db} onSave={saveData} go={go}/>} {page==='cut'&&<CutList db={db} onSave={saveData} goMotor={()=>setPage('sheetplanner')}/>} {page==='cutbatches'&&<CutBatches db={db} onSave={saveData}/>} {page==='sheetplanner'&&<MotorDefinitivo db={db} onSave={saveData}/>} {page==='svglibrary'&&<SvgLibrary db={db} onSave={saveData}/>} {page==='stock'&&<Stock db={db} onSave={saveData}/>} {page==='clients'&&<Clients db={db} onSave={saveData} go={go}/>} {page==='assistant'&&<CatalogAssistant db={db} onSave={saveData}/>} {page==='quotes'&&<Quotes db={db} onSave={saveData} onOpenOrder={openQuoteAsOrder}/>} {page==='webrequests'&&<WebRequests db={db} onSave={saveData}/>} {page==='trust'&&<CustomerTrust db={db} onSave={saveData}/>} {page==='catalog'&&<><CatalogAccess/><CatalogAdmin db={db} onSave={saveData}/></>} {page==='analytics'&&<Analytics db={db}/>} {page==='expenses'&&<Expenses db={db} onSave={saveData}/>} {page==='monthly'&&<Monthly db={db}/>} {page==='costs'&&<CostSettings db={db} onSave={saveData}/>} {page==='settings'&&<Settings db={db} onSave={saveData}/>} 
 </Suspense></main></div></div>
}