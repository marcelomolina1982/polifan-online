import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const figuresDefault = [
  'Corazón con división','Corazón simple','Boca','Infinito','Caramelo','Mariposa',
  'Amigos abrazados','Arcoíris','Rompecabezas corazón','Osito','TE AMO','Unicornio',
  'Dinosaurio','Auto','Rosa','Mate','Labios','Cabeza Roblox','Número 15 con alas',
  'Nombre personalizado','Nube','Estrella','Luna','Corona','Pelota','Escudo','Flor',
  'Manzana','Banana','Brócoli','Acelga','Ananá','Abejita','Perro salchicha','Gatito',
  'Mariposa simple','Número','Letra','Cartel personalizado'
]

const emptyState = () => ({
  orders: [],
  movements: [],
  stockMin: {},
  figures: figuresDefault,
  clients: [],
  cuttingBatches: []
})

const statusColors = {
  'Ingresado':'gray','En diseño':'yellow','Listo para cortar':'blue',
  'Cortado':'green','Entregado':'purple','Cancelado':'red'
}

function pricePerUnit(qty){
  if(qty <= 5) return 6000
  if(qty <= 11) return 25000/6
  return 40000/12
}

function money(n){
  return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n||0)
}

function today(){
  return new Date().toISOString().slice(0,10)
}

function App(){
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
      id:'main',
      data:next,
      updated_at:new Date().toISOString(),
      updated_by:session.user.id
    },{onConflict:'id'})
    setSaving(false)
    if(error) alert('No se pudo guardar: '+error.message)
  }

  async function logout(){
    await supabase.auth.signOut()
    setSession(null)
  }

  if(!session) return <Login onLogin={()=>loadData()} />
  if(loading) return <div className="center-screen">Cargando sistema…</div>

  const nav = [
    ['dashboard','⌂','Inicio'],
    ['new','＋','Nuevo pedido'],
    ['orders','▤','Pedidos'],
    ['cut','✂','Para cortar'],
    ['cutting','▦','En corte'],
    ['stock','◇','Stock'],
    ['clients','♙','Clientes'],
    ['monthly','▥','Resumen mensual'],
    ['settings','⚙','Datos y copias'],
  ]

  return <div className="app">
    <aside className={'sidebar '+(mobileOpen?'open':'')}>
      <div className="brand">
        <div className="logo">✂</div>
        <div><small>TU VIDA EN TINTA</small><b>POLIFAN</b></div>
      </div>
      <nav>
        {nav.map(([id,icon,label])=><button key={id} className={page===id?'active':''}
          onClick={()=>{setPage(id);setMobileOpen(false)}}><span>{icon}</span>{label}</button>)}
      </nav>
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
        {page==='new' && <OrderForm db={db} onSave={saveData} editing={editingOrder} clearEdit={()=>setEditingOrder(null)} />}
        {page==='orders' && <Orders db={db} onSave={saveData} onEdit={(o)=>{setEditingOrder(o);setPage('new')}} />}
        {page==='cut' && <CutList db={db} onSave={saveData} goCutting={()=>setPage('cutting')} />}
        {page==='cutting' && <CuttingBatches db={db} onSave={saveData} />}
        {page==='stock' && <Stock db={db} onSave={saveData} />}
        {page==='clients' && <Clients db={db} onSave={saveData} goOrders={()=>setPage('orders')} />}
        {page==='monthly' && <Monthly db={db} />}
        {page==='settings' && <Settings db={db} onSave={saveData} />}
      </main>
    </div>
  </div>
}

function Login(){
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)

  async function submit(e){
    e.preventDefault()
    setBusy(true); setMsg('')
    const {error}=await supabase.auth.signInWithPassword({email,password})
    if(error) setMsg('No se pudo ingresar: '+error.message)
    setBusy(false)
  }

  return <div className="login-bg">
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo">✂</div>
      <h1>Tu Vida En Tinta</h1>
      <h2>Gestión de Polifan</h2>
      <p>Ingresá con el usuario creado en Supabase.</p>
      <label>Correo electrónico</label>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
      <label>Contraseña</label>
      <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/>
      {msg && <div className="error">{msg}</div>}
      <button className="primary full" disabled={busy}>{busy?'Ingresando…':'Ingresar'}</button>
    </form>
  </div>
}

function Title({title,sub,actions}){
  return <div className="page-title"><div><h1>{title}</h1><p>{sub}</p></div><div className="title-actions">{actions}</div></div>
}

function Dashboard({db,go}){
  const active = db.orders.filter(o=>!['Entregado','Cancelado'].includes(o.status)).length
  const toCut = db.orders.filter(o=>['Ingresado','En diseño','Listo para cortar'].includes(o.status))
    .flatMap(o=>o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)
  const month = new Date().getMonth()+1
  const year = new Date().getFullYear()
  const monthly = db.orders.filter(o=>{
    const d=new Date(o.date||o.createdAt)
    return d.getMonth()+1===month && d.getFullYear()===year && o.status!=='Cancelado'
  })
  const revenue=monthly.reduce((a,o)=>a+Number(o.total||0),0)
  const low=stockRows(db).filter(s=>s.total<=s.min).length

  return <>
    <Title title="Panel principal" sub="Resumen general de pedidos, cortes y stock." actions={<button className="primary" onClick={()=>go('new')}>＋ Nuevo pedido</button>}/>
    <div className="cards">
      <Kpi label="Pedidos activos" value={active}/>
      <Kpi label="Piezas para cortar" value={toCut}/>
      <Kpi label="Facturación del mes" value={money(revenue)}/>
      <Kpi label="Stock para reponer" value={low}/>
    </div>
    <div className="grid2">
      <div className="panel">
        <h3>Últimos pedidos</h3>
        <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Total</th></tr></thead>
        <tbody>{db.orders.slice().reverse().slice(0,8).map(o=><tr key={o.id}><td>#{o.number}</td><td>{o.client}</td><td><Badge status={o.status}/></td><td>{money(o.total)}</td></tr>)}</tbody></table></div>
      </div>
      <div className="panel">
        <h3>Accesos rápidos</h3>
        <div className="quick">
          <button onClick={()=>go('orders')}>Ver pedidos</button>
          <button onClick={()=>go('cut')}>Lista para cortar</button>
          <button onClick={()=>go('stock')}>Stock permanente</button>
          <button onClick={()=>go('monthly')}>Resumen mensual</button>
        </div>
      </div>
    </div>
  </>
}

function Kpi({label,value}){return <div className="kpi"><small>{label}</small><b>{value}</b></div>}
function Badge({status}){return <span className={'badge '+(statusColors[status]||'gray')}>{status}</span>}

function OrderForm({db,onSave,editing,clearEdit}){
  const DRAFT_KEY='polifan-order-draft-v1'
  const blank=()=>({
    id:crypto.randomUUID(), number:String((Math.max(0,...db.orders.map(o=>Number(o.number)||0))+1)).padStart(3,'0'),
    date:today(), client:'',phone:'',zone:'',carrier:'Logística',delivery:'',priority:'Normal',
    status:'Ingresado',paid:'No',notes:'',items:[{figure:'',qty:1}]
  })
  const [form,setForm]=useState(()=>{
    try{
      const saved=localStorage.getItem(DRAFT_KEY)
      return saved ? {...blank(),...JSON.parse(saved)} : blank()
    }catch{return blank()}
  })
  const [draftSaved,setDraftSaved]=useState(false)
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])

  useEffect(()=>{
    if(editing){
      setForm(JSON.parse(JSON.stringify(editing)))
      setDraftSaved(false)
    }
  },[editing])

  useEffect(()=>{
    const timer=setTimeout(()=>{
      try{
        localStorage.setItem(DRAFT_KEY,JSON.stringify(form))
        setDraftSaved(true)
      }catch{}
    },400)
    return ()=>clearTimeout(timer)
  },[form])

  const qty=form.items.reduce((a,i)=>a+Number(i.qty||0),0)
  const total=qty*pricePerUnit(qty)

  function updateItem(ix,key,val){
    setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:val}:it)}))
  }

  async function submit(e){
    e.preventDefault()
    if(!form.client.trim()) return alert('Ingresá el nombre del cliente.')
    if(!form.items.some(i=>i.figure && Number(i.qty)>0)) return alert('Agregá al menos una figura.')
    const final={...form,total,unitPrice:pricePerUnit(qty),updatedAt:new Date().toISOString()}
    const orders=editing ? db.orders.map(o=>o.id===final.id?final:o) : [...db.orders,{...final,createdAt:new Date().toISOString()}]
    await onSave({...db,orders})
    localStorage.removeItem(DRAFT_KEY)
    setForm(blank()); setDraftSaved(false); clearEdit()
    alert(editing?'Pedido actualizado.':'Pedido guardado.')
  }

  return <>
    <Title title={editing?'Editar pedido':'Nuevo pedido'} sub="Cargá todos los datos del pedido y las figuras solicitadas." actions={<span className="draft-status">{draftSaved?'Borrador guardado automáticamente':'Guardando borrador…'}</span>}/>
    <form className="panel" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
        <Field label="Nº de pedido"><input value={form.number} onChange={e=>setForm({...form,number:e.target.value})}/></Field>
        <Field label="Cliente"><input value={form.client} onChange={e=>setForm({...form,client:e.target.value})}/></Field>
        <Field label="Teléfono"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
        <Field label="Zona de envío"><input value={form.zone} onChange={e=>setForm({...form,zone:e.target.value})}/></Field>
        <Field label="Despachado por"><select value={form.carrier} onChange={e=>setForm({...form,carrier:e.target.value})}>
          {['Via Cargo','Andreani','Correo Argentino','Logística','Retiro en local'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Fecha de entrega"><input type="date" value={form.delivery} onChange={e=>setForm({...form,delivery:e.target.value})}/></Field>
        <Field label="Prioridad"><select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option>Normal</option><option>Urgente</option></select></Field>
        <Field label="Estado"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Pagado"><select value={form.paid} onChange={e=>setForm({...form,paid:e.target.value})}><option>No</option><option>Sí</option></select></Field>
      </div>

      <h3>Figuras</h3>
      {form.items.map((it,ix)=><div className="item-row" key={ix}>
        <input list={`fig-${ix}`} placeholder="🔍 Buscar figura" value={it.figure} onChange={e=>updateItem(ix,'figure',e.target.value)}/>
        <datalist id={`fig-${ix}`}>{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist>
        <input type="number" min="1" value={it.qty} onChange={e=>updateItem(ix,'qty',e.target.value)}/>
        <button type="button" className="danger smallbtn" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,i)=>i!==ix)}))}>×</button>
      </div>)}
      <button type="button" className="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{figure:'',qty:1}]}))}>＋ Agregar figura</button>

      <Field label="Observaciones"><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>

      <div className="order-total">
        <div><small>Total de piezas</small><b>{qty}</b></div>
        <div><small>Precio unitario</small><b>{money(pricePerUnit(qty))}</b></div>
        <div><small>Valor del pedido</small><b>{money(total)}</b></div>
      </div>
      <div className="actions"><button className="primary">{editing?'Guardar cambios':'Guardar pedido'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{localStorage.removeItem(DRAFT_KEY);clearEdit();setForm(blank());setDraftSaved(false)}}>Cancelar</button>}</div>
    </form>
  </>
}
function Field({label,children}){return <label className="field"><span>{label}</span>{children}</label>}

function Orders({db,onSave,onEdit}){
  const [q,setQ]=useState('')
  const [status,setStatus]=useState('')
  const list=db.orders.filter(o=>{
    const s=(o.client+' '+o.phone+' '+o.number+' '+(o.items||[]).map(i=>i.figure).join(' ')).toLowerCase()
    return s.includes(q.toLowerCase()) && (!status || o.status===status)
  }).slice().reverse()

  async function remove(id){
    if(confirm('¿Eliminar este pedido?')) await onSave({...db,orders:db.orders.filter(o=>o.id!==id)})
  }

  async function setStatusOrder(o,newStatus){
    await onSave({...db,orders:db.orders.map(x=>x.id===o.id?{...x,status:newStatus,updatedAt:new Date().toISOString()}:x)})
  }

  function openWhatsApp(o){
    const number=String(o.phone||'').replace(/\D/g,'')
    const text=`Hola ${o.client}, te escribimos de Tu Vida En Tinta por tu pedido N° ${o.number}. Estado actual: ${o.status}.`
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`,'_blank')
  }

  function printOrder(o){
    const items=(o.items||[]).map(i=>`<tr><td>${i.figure}</td><td>${i.qty}</td></tr>`).join('')
    const win=window.open('','_blank')
    win.document.write(`
      <html><head><title>Pedido ${o.number}</title>
      <style>body{font-family:Arial;padding:25px}h1{text-align:center}.box{border:2px solid #111;padding:18px}
      .grid{display:grid;grid-template-columns:160px 1fr}.grid div{padding:7px;border-bottom:1px solid #bbb}
      table{width:100%;border-collapse:collapse;margin-top:15px}th,td{border:1px solid #111;padding:9px;text-align:left}</style></head>
      <body><div class="box"><h1>TU VIDA EN TINTA · POLIFAN</h1>
      <div class="grid">
      <div><b>Pedido</b></div><div>#${o.number}</div>
      <div><b>Cliente</b></div><div>${o.client}</div>
      <div><b>Teléfono</b></div><div>${o.phone||'-'}</div>
      <div><b>Zona</b></div><div>${o.zone||'-'}</div>
      <div><b>Transporte</b></div><div>${o.carrier||'-'}</div>
      <div><b>Estado</b></div><div>${o.status}</div>
      </div>
      <table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>${items}</tbody></table>
      <p><b>Total:</b> ${money(o.total)}</p><p><b>Observaciones:</b> ${o.notes||'-'}</p></div>
      <script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  return <>
    <Title title="Pedidos" sub="Buscá, editá y actualizá el estado de cada pedido."/>
    <div className="panel filters">
      <input placeholder="Buscar cliente, teléfono, número o figura…" value={q} onChange={e=>setQ(e.target.value)}/>
      <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select>
    </div>
    <div className="panel table-wrap"><table><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Piezas</th><th>Estado</th><th>Total</th><th>Acciones</th></tr></thead>
      <tbody>{list.map(o=><tr key={o.id}><td>#{o.number}</td><td>{o.date}</td><td><b>{o.client}</b><small className="block">{o.phone}</small></td>
        <td>{(o.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)}</td>
        <td><select value={o.status} onChange={e=>setStatusOrder(o,e.target.value)}>{Object.keys(statusColors).map(x=><option key={x}>{x}</option>)}</select></td>
        <td>{money(o.total)}</td><td className="row-actions">
          <button className="ghost" onClick={()=>printOrder(o)}>Imprimir</button>
          {o.phone&&<button className="whatsapp" onClick={()=>openWhatsApp(o)}>WhatsApp</button>}
          <button className="ghost" onClick={()=>onEdit(o)}>Editar</button>
          <button className="danger" onClick={()=>remove(o.id)}>Eliminar</button>
        </td></tr>)}</tbody>
    </table></div>
  </>
}

function activeOrderDemand(db){
  const demand={}
  ;(db.orders||[]).filter(o=>!['Cancelado','Entregado'].includes(o.status)).forEach(o=>{
    ;(o.items||[]).forEach(i=>{
      if(!i.figure)return
      demand[i.figure]=(demand[i.figure]||0)+Number(i.qty||0)
    })
  })
  return demand
}

function openCutQuantities(db){
  const inCut={}
  ;(db.cuttingBatches||[]).filter(b=>b.status==='En corte').forEach(b=>{
    ;(b.items||[]).forEach(i=>{
      if(!i.figure)return
      inCut[i.figure]=(inCut[i.figure]||0)+Number(i.qty||0)
    })
  })
  return inCut
}

function manualStockByFigure(db){
  const values={}
  ;(db.movements||[]).forEach(m=>{
    const q=Number(m.qty||0)
    const sign=['Entrada extra','Ajuste positivo','Producción terminada'].includes(m.type)?1:-1
    values[m.figure]=(values[m.figure]||0)+(sign*q)
  })
  return values
}

function stockRows(db){
  const demand=activeOrderDemand(db)
  const manual=manualStockByFigure(db)
  const figures=[...new Set([...(db.figures||[]),...Object.keys(demand),...Object.keys(manual)])]
    .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))
  return figures.map(f=>{
    const available=Number(manual[f]||0)
    const committed=Number(demand[f]||0)
    const total=available-committed
    return {figure:f,available,committed,total,min:Number((db.stockMin||{})[f]||0)}
  })
}

function CutList({db,onSave,goCutting}){
  const demand=activeOrderDemand(db)
  const manual=manualStockByFigure(db)
  const inCut=openCutQuantities(db)
  const orderRefs={}
  ;(db.orders||[]).filter(o=>!['Cancelado','Entregado'].includes(o.status)).forEach(o=>{
    ;(o.items||[]).forEach(i=>{
      if(!i.figure)return
      if(!orderRefs[i.figure])orderRefs[i.figure]=[]
      orderRefs[i.figure].push(o.number)
    })
  })
  const rows=Object.keys(demand).map(f=>{
    const deficit=Math.max(0,Number(demand[f]||0)-Number(manual[f]||0))
    const pending=Math.max(0,deficit-Number(inCut[f]||0))
    return {figure:f,demand:demand[f],stock:manual[f]||0,inCut:inCut[f]||0,pending,orders:[...new Set(orderRefs[f]||[])]}
  }).filter(r=>r.pending>0).sort((a,b)=>b.pending-a.pending)

  async function createSuggestedBatch(){
    if(!rows.length)return alert('No hay piezas pendientes para enviar a cortar.')
    const batch={
      id:crypto.randomUUID(),
      number:String((Math.max(0,...(db.cuttingBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0'),
      date:today(),status:'En corte',notes:'Sugerencia automática creada desde Pedidos para cortar',
      items:rows.map(r=>({figure:r.figure,qty:r.pending})),createdAt:new Date().toISOString()
    }
    await onSave({...db,cuttingBatches:[...(db.cuttingBatches||[]),batch]})
    alert('Se creó una placa sugerida. Podés editar las cantidades en la sección En corte.')
    goCutting()
  }

  return <>
    <Title title="Pedidos para cortar" sub="Muestra solamente lo que falta fabricar, descontando el stock disponible y lo que ya está en corte." actions={<div className="actions"><button className="ghost" onClick={()=>window.print()}>Imprimir</button><button className="primary" onClick={createSuggestedBatch}>▦ Crear placa sugerida</button></div>}/>
    <div className="notice"><b>Cálculo automático</b><span>Pedido − stock disponible − piezas ya enviadas a corte = cantidad pendiente.</span></div>
    <div className="panel table-wrap"><table><thead><tr><th>Figura</th><th>Pedidos</th><th>Stock físico</th><th>Ya en corte</th><th>Falta enviar</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.figure}><td><b>{r.figure}</b><small className="block">Pedidos: {r.orders.join(', ')}</small></td><td>{r.demand}</td><td>{r.stock}</td><td>{r.inCut}</td><td className="big red-text">{r.pending}</td></tr>)}
      {!rows.length&&<tr><td colSpan="5">No hay figuras pendientes para cortar.</td></tr>}
    </tbody></table></div>
  </>
}

function CuttingBatches({db,onSave}){
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])
  const pendingRows=useMemo(()=>{
    const demand=activeOrderDemand(db),manual=manualStockByFigure(db),inCut=openCutQuantities(db)
    return Object.keys(demand).map(f=>({figure:f,qty:Math.max(0,demand[f]-(manual[f]||0)-(inCut[f]||0))})).filter(x=>x.qty>0).sort((a,b)=>b.qty-a.qty)
  },[db])
  const blank=()=>({id:crypto.randomUUID(),number:String((Math.max(0,...(db.cuttingBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0'),date:today(),status:'En corte',notes:'',items:[{figure:pendingRows[0]?.figure||sortedFigures[0]||'',qty:1}]})
  const [form,setForm]=useState(blank)
  const [editing,setEditing]=useState(null)

  useEffect(()=>{if(!editing)setForm(f=>({...f,number:String((Math.max(0,...(db.cuttingBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0')}))},[db.cuttingBatches])
  function updateItem(ix,key,val){setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:val}:it)}))}
  function useSuggestion(){
    if(!pendingRows.length)return alert('No hay piezas pendientes.')
    setForm(f=>({...f,items:pendingRows.map(x=>({...x}))}))
  }
  async function save(e){
    e.preventDefault()
    const items=form.items.filter(i=>i.figure&&Number(i.qty)>0).map(i=>({...i,qty:Number(i.qty)}))
    if(!items.length)return alert('Agregá al menos una figura.')
    const batch={...form,items,updatedAt:new Date().toISOString(),createdAt:form.createdAt||new Date().toISOString()}
    const list=editing?(db.cuttingBatches||[]).map(b=>b.id===batch.id?batch:b):[...(db.cuttingBatches||[]),batch]
    await onSave({...db,cuttingBatches:list})
    setEditing(null);setForm(blank())
  }
  async function finish(batch){
    if(!confirm('¿Marcar esta placa como terminada? Las piezas se sumarán al stock físico.'))return
    const movements=(batch.items||[]).map(i=>({id:crypto.randomUUID(),date:today(),figure:i.figure,type:'Producción terminada',qty:Number(i.qty),detail:`Placa #${batch.number}`,createdAt:new Date().toISOString()}))
    const batches=(db.cuttingBatches||[]).map(b=>b.id===batch.id?{...b,status:'Terminada',finishedAt:new Date().toISOString()}:b)
    await onSave({...db,cuttingBatches:batches,movements:[...(db.movements||[]),...movements]})
  }
  async function remove(batch){
    if(!confirm(`¿Eliminar la placa #${batch.number}?`))return
    await onSave({...db,cuttingBatches:(db.cuttingBatches||[]).filter(b=>b.id!==batch.id)})
  }
  function edit(batch){setEditing(batch.id);setForm(JSON.parse(JSON.stringify(batch)));window.scrollTo({top:0,behavior:'smooth'})}

  return <>
    <Title title="En corte" sub="Registrá cada placa o tanda que mandás a cortar. Al terminarla, sus piezas se suman al stock."/>
    <form className="panel" onSubmit={save}>
      <div className="panel-heading"><h3>{editing?'Editar placa':'Nueva placa de corte'}</h3><button type="button" className="ghost" onClick={useSuggestion}>Usar sugerencia completa</button></div>
      <div className="form-grid"><Field label="Número"><input value={form.number} onChange={e=>setForm({...form,number:e.target.value})}/></Field><Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field><Field label="Estado"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option>En corte</option><option>Terminada</option></select></Field></div>
      <h3>Piezas de la placa</h3>
      {form.items.map((it,ix)=><div className="item-row" key={ix}><input list={`cutfig-${ix}`} value={it.figure} onChange={e=>updateItem(ix,'figure',e.target.value)} placeholder="Buscar figura…"/><datalist id={`cutfig-${ix}`}>{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist><input type="number" min="1" value={it.qty} onChange={e=>updateItem(ix,'qty',e.target.value)}/><button type="button" className="danger" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,i)=>i!==ix)}))}>Quitar</button></div>)}
      <button type="button" className="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{figure:'',qty:1}]}))}>＋ Agregar figura</button>
      <Field label="Notas"><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value)}/></Field>
      <div className="actions"><button className="primary">{editing?'Guardar cambios':'Guardar placa'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{setEditing(null);setForm(blank())}}>Cancelar</button>}</div>
    </form>
    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Fecha</th><th>Contenido</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {(db.cuttingBatches||[]).slice().reverse().map(b=><tr key={b.id}><td><b>#{b.number}</b></td><td>{b.date}</td><td>{(b.items||[]).map(i=>`${i.figure} × ${i.qty}`).join(' · ')}</td><td>{(b.items||[]).reduce((a,i)=>a+Number(i.qty||0),0)}</td><td><Badge status={b.status}/></td><td className="row-actions">{b.status==='En corte'?<><button className="primary" onClick={()=>finish(b)}>Terminar</button><button className="ghost" onClick={()=>edit(b)}>Editar</button><button className="danger" onClick={()=>remove(b)}>Eliminar</button></>:<span className="status-text ok">FINALIZADA</span>}</td></tr>)}
      {!(db.cuttingBatches||[]).length&&<tr><td colSpan="6">Todavía no hay placas registradas.</td></tr>}
    </tbody></table></div>
  </>
}

function Stock({db,onSave}){
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])
  const [form,setForm]=useState({date:today(),figure:sortedFigures[0]||'',type:'Entrada extra',qty:1,detail:''})
  const rows=stockRows(db)

  async function add(e){
    e.preventDefault()
    if(!form.figure||Number(form.qty)<=0)return alert('Completá figura y cantidad.')
    const movement={...form,id:crypto.randomUUID(),qty:Number(form.qty),createdAt:new Date().toISOString()}
    await onSave({...db,movements:[...(db.movements||[]),movement]})
    setForm({...form,qty:1,detail:''})
  }
  async function quick(f,delta){
    const movement={id:crypto.randomUUID(),date:today(),figure:f,type:delta>0?'Entrada extra':'Salida manual',qty:Math.abs(delta),detail:'Ajuste rápido desde stock',createdAt:new Date().toISOString()}
    await onSave({...db,movements:[...(db.movements||[]),movement]})
  }

  return <>
    <Title title="Inventario / Stock" sub="El saldo descuenta automáticamente todos los pedidos activos. Puede quedar negativo para mostrar lo que falta fabricar."/>
    <div className="notice"><b>Ejemplo</b><span>Si cargás un pedido de 3 pelotas y no tenés ninguna, el saldo muestra −3. Si agregás 1, pasa a −2.</span></div>
    <div className="panel table-wrap"><table><thead><tr><th>Figura</th><th>Stock físico</th><th>Reservado en pedidos</th><th>Saldo disponible</th><th>Ajuste rápido</th></tr></thead><tbody>
      {rows.map(s=><tr key={s.figure}><td><b>{s.figure}</b></td><td>{s.available}</td><td>{s.committed}</td><td className={s.total<0?'red-text':s.total>0?'green-text':'purple-text'}><b className="big">{s.total}</b></td><td className="row-actions"><button className="ghost" onClick={()=>quick(s.figure,-1)}>−1</button><button className="primary" onClick={()=>quick(s.figure,1)}>＋1</button></td></tr>)}
    </tbody></table></div>
    <form className="panel" onSubmit={add}><h3>Agregar o quitar piezas manualmente</h3><div className="form-grid">
      <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
      <Field label="Figura"><input list="stock-figures" value={form.figure} onChange={e=>setForm({...form,figure:e.target.value)} placeholder="Buscar figura…"/><datalist id="stock-figures">{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist></Field>
      <Field label="Movimiento"><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{['Entrada extra','Salida manual','Ajuste positivo','Ajuste negativo'].map(x=><option key={x}>{x}</option>)}</select></Field>
      <Field label="Cantidad"><input type="number" min="1" value={form.qty} onChange={e=>setForm({...form,qty:e.target.value})}/></Field>
    </div><Field label="Detalle"><input value={form.detail} onChange={e=>setForm({...form,detail:e.target.value})}/></Field><button className="primary">Guardar movimiento</button></form>
    <div className="panel table-wrap"><h3>Últimos movimientos</h3><table><thead><tr><th>Fecha</th><th>Figura</th><th>Tipo</th><th>Cantidad</th><th>Detalle</th></tr></thead><tbody>{(db.movements||[]).slice().reverse().slice(0,30).map(m=><tr key={m.id}><td>{m.date}</td><td>{m.figure}</td><td>{m.type}</td><td>{m.qty}</td><td>{m.detail||'-'}</td></tr>)}</tbody></table></div>
  </>
}


function Clients({db,onSave}){
  const [q,setQ]=useState('')
  const [form,setForm]=useState({name:'',phone:'',zone:'',notes:''})
  const clients=db.clients||[]

  async function add(e){
    e.preventDefault()
    if(!form.name.trim())return
    const existing=clients.find(c=>c.phone&&form.phone&&c.phone===form.phone)
    if(existing)return alert('Ya existe un cliente con ese teléfono.')
    await onSave({...db,clients:[...clients,{...form,id:crypto.randomUUID(),createdAt:new Date().toISOString()}]})
    setForm({name:'',phone:'',zone:'',notes:''})
  }

  async function remove(id){
    if(confirm('¿Eliminar este cliente?')) await onSave({...db,clients:clients.filter(c=>c.id!==id)})
  }

  const list=clients.filter(c=>(c.name+' '+c.phone+' '+c.zone).toLowerCase().includes(q.toLowerCase()))
  function ordersCount(c){return db.orders.filter(o=>(c.phone&&o.phone===c.phone)||o.client.toLowerCase()===c.name.toLowerCase()).length}
  function openWA(c){
    const n=String(c.phone||'').replace(/\D/g,'')
    window.open(`https://wa.me/${n}?text=${encodeURIComponent('Hola '+c.name+', te escribimos de Tu Vida En Tinta.')}`,'_blank')
  }

  return <>
    <Title title="Clientes" sub="Guardá sus datos y consultá cuántos pedidos realizó cada uno."/>
    <form className="panel" onSubmit={add}>
      <div className="form-grid">
        <Field label="Nombre"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
        <Field label="Teléfono"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
        <Field label="Zona"><input value={form.zone} onChange={e=>setForm({...form,zone:e.target.value})}/></Field>
        <Field label="Observaciones"><input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
      </div>
      <button className="primary">Guardar cliente</button>
    </form>
    <div className="panel filters"><input placeholder="Buscar cliente…" value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="panel table-wrap"><table><thead><tr><th>Cliente</th><th>Teléfono</th><th>Zona</th><th>Pedidos</th><th>Acciones</th></tr></thead>
    <tbody>{list.map(c=><tr key={c.id}><td><b>{c.name}</b><small className="block">{c.notes}</small></td><td>{c.phone||'-'}</td><td>{c.zone||'-'}</td><td>{ordersCount(c)}</td>
    <td className="row-actions">{c.phone&&<button className="whatsapp" onClick={()=>openWA(c)}>WhatsApp</button>}<button className="danger" onClick={()=>remove(c.id)}>Eliminar</button></td></tr>)}
    {!list.length&&<tr><td colSpan="5">No hay clientes cargados.</td></tr>}</tbody></table></div>
  </>
}

function Monthly({db}){
  const now=new Date()
  const [month,setMonth]=useState(now.getMonth()+1)
  const [year,setYear]=useState(now.getFullYear())
  const list=db.orders.filter(o=>{
    const d=new Date(o.date||o.createdAt)
    return d.getMonth()+1===Number(month)&&d.getFullYear()===Number(year)
  })
  const valid=list.filter(o=>o.status!=='Cancelado')
  const pieces=valid.reduce((a,o)=>a+(o.items||[]).reduce((b,i)=>b+Number(i.qty||0),0),0)
  const revenue=valid.reduce((a,o)=>a+Number(o.total||0),0)
  const byFig={}
  valid.forEach(o=>(o.items||[]).forEach(i=>byFig[i.figure]=(byFig[i.figure]||0)+Number(i.qty||0)))
  return <>
    <Title title="Resumen mensual" sub="Consultá pedidos, piezas y facturación por mes."/>
    <div className="panel filters"><select value={month} onChange={e=>setMonth(e.target.value)}>{Array.from({length:12},(_,i)=><option value={i+1} key={i}>{new Date(2024,i,1).toLocaleString('es-AR',{month:'long'})}</option>)}</select><input type="number" value={year} onChange={e=>setYear(e.target.value)}/></div>
    <div className="cards"><Kpi label="Pedidos" value={valid.length}/><Kpi label="Piezas" value={pieces}/><Kpi label="Facturación" value={money(revenue)}/><Kpi label="Entregados" value={valid.filter(o=>o.status==='Entregado').length}/></div>
    <div className="panel table-wrap"><table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>{Object.entries(byFig).sort((a,b)=>b[1]-a[1]).map(([f,q])=><tr key={f}><td>{f}</td><td><b>{q}</b></td></tr>)}</tbody></table></div>
  </>
}

function Settings({db,onSave}){
  const [newFigures,setNewFigures]=useState(()=>localStorage.getItem('polifan-new-figures-draft')||'')
  const [search,setSearch]=useState('')
  useEffect(()=>{localStorage.setItem('polifan-new-figures-draft',newFigures)},[newFigures])
  const sortedFigures=useMemo(
    ()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),
    [db.figures]
  )
  const visibleFigures=sortedFigures.filter(f=>
    f.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))
  )

  function exportData(){
    const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'})
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='respaldo-polifan-'+today()+'.json';a.click()
  }
  async function importData(e){
    const file=e.target.files?.[0]; if(!file)return
    try{const data=JSON.parse(await file.text());await onSave({...emptyState(),...data});alert('Copia importada.')}catch{alert('Archivo inválido.')}
  }
  async function addFigures(){
    const candidates=newFigures
      .split(/[\n,;]+/)
      .map(f=>f.trim())
      .filter(Boolean)
    if(!candidates.length)return alert('Escribí al menos un nombre.')

    const existing=new Set((db.figures||[]).map(f=>f.toLocaleLowerCase('es')))
    const added=[]
    for(const name of candidates){
      const key=name.toLocaleLowerCase('es')
      if(!existing.has(key)){
        existing.add(key)
        added.push(name)
      }
    }
    if(!added.length)return alert('Todos esos productos ya existen.')

    const figures=[...(db.figures||[]),...added]
      .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))
    await onSave({...db,figures})
    setNewFigures('')
    localStorage.removeItem('polifan-new-figures-draft')
    alert(`${added.length} producto${added.length===1?' agregado':'s agregados'}.`)
  }
  async function editFigure(oldName){
    const newName=window.prompt('Nuevo nombre del producto:',oldName)?.trim()
    if(!newName||newName===oldName)return
    const duplicate=(db.figures||[]).some(f=>
      f!==oldName && f.localeCompare(newName,'es',{sensitivity:'base'})===0
    )
    if(duplicate)return alert('Ya existe un producto con ese nombre.')

    const figures=(db.figures||[])
      .map(f=>f===oldName?newName:f)
      .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))
    const orders=(db.orders||[]).map(order=>({
      ...order,
      items:(order.items||[]).map(item=>item.figure===oldName?{...item,figure:newName}:item)
    }))
    const movements=(db.movements||[]).map(m=>m.figure===oldName?{...m,figure:newName}:m)
    const stockMin={...(db.stockMin||{})}
    if(Object.prototype.hasOwnProperty.call(stockMin,oldName)){
      stockMin[newName]=stockMin[oldName]
      delete stockMin[oldName]
    }
    await onSave({...db,figures,orders,movements,stockMin})
  }
  async function deleteFigure(name){
    const ok=window.confirm(`¿Eliminar “${name}” del catálogo?\n\nLos pedidos anteriores conservarán ese nombre.`)
    if(!ok)return
    const figures=(db.figures||[]).filter(f=>f!==name)
    const stockMin={...(db.stockMin||{})}
    delete stockMin[name]
    await onSave({...db,figures,stockMin})
  }

  return <>
    <Title title="Datos y copias" sub="Administrá el catálogo de figuras y descargá respaldos."/>
    <div className="grid2">
      <div className="panel"><h3>Copias de seguridad</h3><p>Los datos están online, pero conviene guardar una copia periódicamente.</p><div className="actions"><button className="primary" onClick={exportData}>Descargar copia</button><label className="ghost filebtn">Importar copia<input type="file" accept=".json" onChange={importData}/></label></div></div>
      <div className="panel">
        <h3>Agregar uno o varios productos</h3>
        <p>Escribí un nombre por línea. También podés separarlos con coma.</p>
        <textarea value={newFigures} onChange={e=>setNewFigures(e.target.value)} placeholder={'Ejemplo:\nCorazón grande\nMariposa\nNúmero 15'}/>
        <button className="primary full" onClick={addFigures}>Agregar productos</button>
      </div>
    </div>
    <div className="panel">
      <h3>Catálogo de figuras ({db.figures.length})</h3>
      <input type="search" placeholder="🔍 Buscar producto..." value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="catalog-list">
        {visibleFigures.map(f=><div className="catalog-row" key={f}>
          <span>{f}</span>
          <div className="row-actions">
            <button className="ghost smallbtn" onClick={()=>editFigure(f)}>Editar</button>
            <button className="danger smallbtn" onClick={()=>deleteFigure(f)}>Eliminar</button>
          </div>
        </div>)}
      </div>
      {!visibleFigures.length&&<p>No se encontraron productos.</p>}
    </div>
  </>
}

export default App
