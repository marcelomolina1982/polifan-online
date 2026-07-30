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
  clients: []
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
        {page==='cut' && <CutList db={db} />}
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
  const blank=()=>({
    id:crypto.randomUUID(), number:String((Math.max(0,...db.orders.map(o=>Number(o.number)||0))+1)).padStart(3,'0'),
    date:today(), client:'',phone:'',zone:'',carrier:'Logística',delivery:'',priority:'Normal',
    status:'Ingresado',paid:'No',notes:'',items:[{figure:'',qty:1}]
  })
  const [form,setForm]=useState(blank())
  const sortedFigures=useMemo(()=>[...db.figures].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])

  useEffect(()=>{ if(editing) setForm(JSON.parse(JSON.stringify(editing))) },[editing])

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
    setForm(blank()); clearEdit()
    alert(editing?'Pedido actualizado.':'Pedido guardado.')
  }

  return <>
    <Title title={editing?'Editar pedido':'Nuevo pedido'} sub="Cargá todos los datos del pedido y las figuras solicitadas."/>
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
      <div className="actions"><button className="primary">{editing?'Guardar cambios':'Guardar pedido'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{clearEdit();setForm(blank())}}>Cancelar</button>}</div>
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

function CutList({db}){
  const grouped={}
  db.orders.filter(o=>['Ingresado','En diseño','Listo para cortar'].includes(o.status)).forEach(o=>{
    ;(o.items||[]).forEach(i=>{
      if(!i.figure)return
      if(!grouped[i.figure]) grouped[i.figure]={qty:0,orders:[],urgent:0}
      grouped[i.figure].qty+=Number(i.qty||0)
      grouped[i.figure].orders.push(o.number)
      if(o.priority==='Urgente') grouped[i.figure].urgent++
    })
  })
  const rows=Object.entries(grouped).sort((a,b)=>b[1].qty-a[1].qty)
  return <>
    <Title title="Lista para cortar" sub="Se actualiza automáticamente con los pedidos pendientes." actions={<button className="primary" onClick={()=>window.print()}>Imprimir lista</button>}/>
    <div className="panel table-wrap"><table><thead><tr><th>Figura</th><th>Cantidad</th><th>Pedidos</th><th>Urgentes</th></tr></thead><tbody>
      {rows.map(([f,v])=><tr key={f}><td><b>{f}</b></td><td className="big">{v.qty}</td><td>{v.orders.join(', ')}</td><td>{v.urgent||'-'}</td></tr>)}
      {!rows.length&&<tr><td colSpan="4">No hay figuras pendientes para cortar.</td></tr>}
    </tbody></table></div>
  </>
}

function stockRows(db){
  return db.figures.map(f=>{
    let entrada=0,salida=0
    db.movements.filter(m=>m.figure===f).forEach(m=>{
      const q=Number(m.qty||0)
      if(['Entrada extra','Ajuste positivo'].includes(m.type)) entrada+=q
      else salida+=q
    })
    let cut=0
    db.orders.filter(o=>o.status==='Cortado').forEach(o=>(o.items||[]).filter(i=>i.figure===f).forEach(i=>cut+=Number(i.qty||0)))
    const total=entrada-salida+cut
    return {figure:f,entrada,salida,cut,total,min:Number(db.stockMin[f]||0)}
  })
}

function Stock({db,onSave}){
  const [form,setForm]=useState({date:today(),figure:db.figures[0]||'',type:'Entrada extra',qty:1,detail:''})
  const rows=stockRows(db)

  async function add(e){
    e.preventDefault()
    const movement={...form,id:crypto.randomUUID(),qty:Number(form.qty),createdAt:new Date().toISOString()}
    await onSave({...db,movements:[...db.movements,movement]})
    setForm({...form,qty:1,detail:''})
  }

  async function minChange(f,v){ await onSave({...db,stockMin:{...db.stockMin,[f]:Number(v)}}) }

  return <>
    <Title title="Stock permanente" sub="El stock se actualiza cuando un pedido pasa a Cortado o Entregado."/>
    <div className="notice"><b>Actualización automática</b><span>Los pedidos Cortados suman piezas disponibles. Al pasar a Entregado dejan de formar parte del stock.</span></div>
    <div className="panel table-wrap"><table><thead><tr><th>Figura</th><th>Entradas extra</th><th>Salidas</th><th>Cortadas de pedidos</th><th>Stock disponible</th><th>Stock mínimo</th><th>Estado</th></tr></thead><tbody>
      {rows.map(s=><tr key={s.figure}><td><b>{s.figure}</b></td><td className="green-text">{s.entrada}</td><td className="red-text">{s.salida}</td><td className="purple-text">{s.cut}</td><td className={s.total<=s.min?'red-text':'green-text'}><b>{s.total}</b></td>
      <td><input className="mini" type="number" value={s.min} onChange={e=>minChange(s.figure,e.target.value)}/></td><td><span className={'status-text '+(s.total<=s.min?'low':'ok')}>{s.total<=s.min?'REPOSICIÓN':'OK'}</span></td></tr>)}
    </tbody></table></div>
    <form className="panel" onSubmit={add}><h3>Entrada o ajuste manual</h3><div className="form-grid">
      <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
      <Field label="Figura"><select value={form.figure} onChange={e=>setForm({...form,figure:e.target.value})}>{db.figures.map(f=><option key={f}>{f}</option>)}</select></Field>
      <Field label="Movimiento"><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{['Entrada extra','Salida manual','Ajuste positivo','Ajuste negativo'].map(x=><option key={x}>{x}</option>)}</select></Field>
      <Field label="Cantidad"><input type="number" min="1" value={form.qty} onChange={e=>setForm({...form,qty:e.target.value})}/></Field>
    </div><Field label="Detalle"><input value={form.detail} onChange={e=>setForm({...form,detail:e.target.value})}/></Field><button className="primary">Guardar movimiento</button></form>
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
  const [newFigure,setNewFigure]=useState('')
  const [search,setSearch]=useState('')
  const sortedFigures=useMemo(()=>[...db.figures].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])
  function exportData(){
    const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'})
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='respaldo-polifan-'+today()+'.json';a.click()
  }
  async function importData(e){
    const file=e.target.files?.[0]; if(!file)return
    try{const data=JSON.parse(await file.text());await onSave({...emptyState(),...data});alert('Copia importada.')}catch{alert('Archivo inválido.')}
  }
  async function addFigure(){
    const f=newFigure.trim(); if(!f||db.figures.includes(f))return
    await onSave({...db,figures:[...db.figures,f].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'))});setNewFigure('')
  }
  return <>
    <Title title="Datos y copias" sub="Administrá el catálogo de figuras y descargá respaldos."/>
    <div className="grid2">
      <div className="panel"><h3>Copias de seguridad</h3><p>Los datos están online, pero conviene guardar una copia periódicamente.</p><div className="actions"><button className="primary" onClick={exportData}>Descargar copia</button><label className="ghost filebtn">Importar copia<input type="file" accept=".json" onChange={importData}/></label></div></div>
      <div className="panel"><h3>Agregar figura</h3><div className="inline"><input value={newFigure} onChange={e=>setNewFigure(e.target.value)} placeholder="Nombre de la nueva figura"/><button className="primary" onClick={addFigure}>Agregar</button></div></div>
    </div>
    <div className="panel"><h3>Catálogo de figuras ({db.figures.length})</h3><input type="search" placeholder="🔍 Buscar producto..." value={search} onChange={e=>setSearch(e.target.value)}/><div className="chips">{sortedFigures.filter(f=>f.toLowerCase().includes(search.toLowerCase())).map(f=><span key={f}>{f}</span>)}</div></div>
  </>
}

export default App
