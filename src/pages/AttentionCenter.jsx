import React,{useMemo,useState} from 'react'
import {Title,Kpi} from '../components/UI'

const DEFAULT_TEMPLATES={
 catalogo:'¡Hola! 😊 Gracias por comunicarte con Tu Vida en Tinta. Podés ver nuestro catálogo actualizado aquí: {catalogo}. Decime qué modelo y cantidad te interesa y te orientamos.',
 precios:'¡Hola! 😊 Trabajamos figuras de polifan por unidad y por cantidad. El precio depende del modelo, tamaño y cantidad. Contame qué figura buscás y cuántas necesitás para pasarte el valor correcto.',
 envio:'¡Hola! 😊 Realizamos envíos a todo el país. Para verificar qué transporte llega y cotizar el costo necesitamos localidad, provincia y código postal. El envío y el pedido quedan sujetos a confirmación.',
 pedido:'¡Hola! 😊 Para preparar tu solicitud necesitamos: modelos, cantidades, nombre, localidad, provincia y código postal. Primero cotizamos el envío y recién después confirmamos el pedido.',
 demora:'¡Hola! 😊 El tiempo de preparación depende de la cantidad, los modelos y la fecha disponible de producción. Indicame qué necesitás y para qué fecha, así revisamos si podemos tomarlo.',
 humano:'¡Hola! Recibimos tu mensaje. Esta consulta necesita revisión de una persona del equipo. Te respondemos apenas podamos dentro de nuestro horario de atención.'
}


const DEFAULT_CHATBOT={
 enabled:true,
 catalogo:'Podés buscar por nombre o recorrer las categorías. Usá el buscador del catálogo para encontrar la figura que necesitás.',
 precios:'Los precios se calculan automáticamente según la cantidad. Armá el carrito y vas a ver el total estimado de los productos.',
 envio:'El envío se coordina por WhatsApp después de revisar localidad, provincia y código postal.',
 comprar:'Elegí las figuras, completá tus datos y enviá la solicitud. Después confirmaremos disponibilidad, fecha, pago y envío.',
 humano:'Esta consulta necesita una persona. Presioná el botón para escribirnos por WhatsApp y continuar la atención.'
}

const CATEGORIES=[
 ['catalogo','Catálogo'],['precios','Precios'],['envio','Envío'],['pedido','Pedido'],['demora','Fecha/demora'],['humano','Atención humana']
]
const CHANNELS=['WhatsApp','Instagram','TikTok','Facebook','Otro']
const STATUSES=['Pendiente','Esperando datos','Respondido','Requiere atención','Cerrado']

function classify(text=''){
 const value=text.toLowerCase()
 if(/env[ií]o|correo|transporte|localidad|c[oó]digo postal|cp\b|andreani|v[ií]a cargo|oca/.test(value))return 'envio'
 if(/precio|cu[aá]nto|valor|sale|promo|mayorista|unidad/.test(value))return 'precios'
 if(/cat[aá]logo|modelos|figuras|ten[eé]s|stitch|minnie|mario|sonic/.test(value))return 'catalogo'
 if(/pedido|comprar|encargar|reservar|quiero\s+\d|cantidad/.test(value))return 'pedido'
 if(/fecha|demora|tarda|entrega|para el d[ií]a|urgente/.test(value))return 'demora'
 return 'humano'
}

function applyVariables(text,db){
 const settings=db.customerSettings||{}
 const catalogUrl=settings.catalogUrl||settings.storeUrl||window.location.origin+'/#pedido'
 return String(text||'')
  .replaceAll('{catalogo}',catalogUrl)
  .replaceAll('{whatsapp}',settings.whatsapp||'')
  .replaceAll('{negocio}',settings.businessName||'Tu Vida en Tinta')
}

export default function AttentionCenter({db,onSave}){
 const [tab,setTab]=useState('pending')
 const [query,setQuery]=useState('')
 const [channel,setChannel]=useState('Todos')
 const [category,setCategory]=useState('Todos')
 const [draft,setDraft]=useState({channel:'WhatsApp',customer:'',contact:'',message:''})
 const [showNew,setShowNew]=useState(false)
 const rows=db.attentionMessages||[]
 const templates={...DEFAULT_TEMPLATES,...(db.attentionTemplates||{})}
 const chatbot={...DEFAULT_CHATBOT,...(db.chatbotSettings||{})}

 const visible=useMemo(()=>rows.filter(row=>{
  const isOpen=!['Cerrado'].includes(row.status)
  if(tab==='pending'&&!isOpen)return false
  if(tab==='history'&&isOpen)return false
  if(channel!=='Todos'&&row.channel!==channel)return false
  if(category!=='Todos'&&row.category!==category)return false
  const text=[row.customer,row.contact,row.message,row.response,row.channel].join(' ').toLowerCase()
  return !query||text.includes(query.toLowerCase())
 }),[rows,tab,channel,category,query])

 const pending=rows.filter(r=>!['Cerrado'].includes(r.status)).length
 const human=rows.filter(r=>r.status==='Requiere atención').length
 const waiting=rows.filter(r=>r.status==='Esperando datos').length
 const answeredToday=rows.filter(r=>r.status==='Respondido'&&String(r.updatedAt||'').slice(0,10)===new Date().toISOString().slice(0,10)).length

 async function persist(nextRows,extra={}){await onSave({...db,attentionMessages:nextRows,...extra})}

 async function addMessage(){
  if(!draft.message.trim())return alert('Pegá o escribí el mensaje recibido.')
  const detected=classify(draft.message)
  const now=new Date().toISOString()
  const item={id:crypto.randomUUID(),...draft,category:detected,status:detected==='humano'?'Requiere atención':'Pendiente',response:applyVariables(templates[detected],db),createdAt:now,updatedAt:now,notes:''}
  await persist([item,...rows])
  setDraft({channel:'WhatsApp',customer:'',contact:'',message:''})
  setShowNew(false)
 }

 async function update(id,patch){
  await persist(rows.map(r=>r.id===id?{...r,...patch,updatedAt:new Date().toISOString()}:r))
 }

 async function remove(id){
  if(!confirm('¿Eliminar esta consulta del Centro de Atención?'))return
  await persist(rows.filter(r=>r.id!==id))
 }

 async function copyResponse(row){
  const text=row.response||applyVariables(templates[row.category],db)
  try{await navigator.clipboard.writeText(text);alert('Respuesta copiada.')}catch{window.prompt('Copiá esta respuesta:',text)}
 }

 async function saveTemplates(nextTemplates){await onSave({...db,attentionTemplates:nextTemplates})}

 return <>
  <Title title="Centro de Atención" sub="Organizá consultas recibidas y prepará respuestas sin confirmar pedidos ni costos de envío." actions={<button className="primary" onClick={()=>setShowNew(v=>!v)}>＋ Cargar consulta</button>}/>

  <div className="kpis attention-kpis">
   <Kpi label="Pendientes" value={pending}/><Kpi label="Esperando datos" value={waiting}/><Kpi label="Atención humana" value={human}/><Kpi label="Respondidos hoy" value={answeredToday}/>
  </div>

  {showNew&&<div className="panel attention-new">
   <div className="panel-heading"><div><h3>Nueva consulta</h3><p>Copiá el mensaje desde la red o WhatsApp. La app propondrá una categoría y respuesta.</p></div></div>
   <div className="attention-form-grid">
    <label>Canal<select value={draft.channel} onChange={e=>setDraft({...draft,channel:e.target.value})}>{CHANNELS.map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Nombre o usuario<input value={draft.customer} onChange={e=>setDraft({...draft,customer:e.target.value})} placeholder="Ej.: María / @usuario"/></label>
    <label>Teléfono o perfil<input value={draft.contact} onChange={e=>setDraft({...draft,contact:e.target.value})} placeholder="Opcional"/></label>
   </div>
   <label className="attention-message-label">Mensaje recibido<textarea rows="5" value={draft.message} onChange={e=>setDraft({...draft,message:e.target.value})} placeholder="Pegá aquí la consulta…"/></label>
   <div className="request-actions"><button className="primary" onClick={addMessage}>Analizar y guardar</button><button className="ghost" onClick={()=>setShowNew(false)}>Cancelar</button></div>
  </div>}

  <div className="attention-toolbar">
   <div className="request-tabs"><button className={tab==='pending'?'active':''} onClick={()=>setTab('pending')}>Pendientes</button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>Cerradas</button><button className={tab==='templates'?'active':''} onClick={()=>setTab('templates')}>Respuestas rápidas</button><button className={tab==='chatbot'?'active':''} onClick={()=>setTab('chatbot')}>Chatbot del catálogo</button></div>
   {!['templates','chatbot'].includes(tab)&&<div className="attention-filters"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar consulta…"/><select value={channel} onChange={e=>setChannel(e.target.value)}><option>Todos</option>{CHANNELS.map(x=><option key={x}>{x}</option>)}</select><select value={category} onChange={e=>setCategory(e.target.value)}><option>Todos</option>{CATEGORIES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></div>}
  </div>

  {tab==='templates'?<TemplateEditor templates={templates} db={db} onSave={saveTemplates}/>:tab==='chatbot'?<ChatbotEditor settings={chatbot} db={db} onSave={async next=>onSave({...db,chatbotSettings:next})}/>:<div className="attention-list">
   {visible.map(row=><article className="panel attention-card" key={row.id}>
    <div className="attention-card-head"><div><div className="attention-tags"><span>{row.channel}</span><span>{CATEGORIES.find(x=>x[0]===row.category)?.[1]||row.category}</span><span className={'attention-status '+String(row.status).toLowerCase().replaceAll(' ','-')}>{row.status}</span></div><h3>{row.customer||'Consulta sin nombre'}</h3><small>{row.contact||''} · {new Date(row.createdAt).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'})}</small></div><button className="danger ghost" onClick={()=>remove(row.id)}>Eliminar</button></div>
    <div className="attention-columns">
     <div><b>Mensaje recibido</b><p className="attention-bubble incoming">{row.message}</p></div>
     <div><div className="attention-response-title"><b>Respuesta preparada</b><button className="ghost" onClick={()=>update(row.id,{response:applyVariables(templates[row.category],db)})}>Restablecer</button></div><textarea rows="6" value={row.response||''} onChange={e=>update(row.id,{response:e.target.value})}/></div>
    </div>
    <div className="attention-card-actions">
     <button className="primary" onClick={()=>copyResponse(row)}>Copiar respuesta</button>
     <select value={row.category} onChange={e=>update(row.id,{category:e.target.value,response:applyVariables(templates[e.target.value],db)})}>{CATEGORIES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
     <select value={row.status} onChange={e=>update(row.id,{status:e.target.value})}>{STATUSES.map(x=><option key={x}>{x}</option>)}</select>
     <button className="ghost" onClick={()=>update(row.id,{status:'Esperando datos'})}>Esperar localidad/CP</button>
     <button className="ghost" onClick={()=>update(row.id,{status:'Respondido'})}>Marcar respondido</button>
     <button className="ghost" onClick={()=>update(row.id,{status:'Cerrado'})}>Cerrar</button>
    </div>
   </article>)}
   {!visible.length&&<div className="panel empty-attention"><b>No hay consultas en esta vista.</b><p>Cargá manualmente los mensajes que todavía necesitan respuesta.</p></div>}
  </div>}
 </>
}

function TemplateEditor({templates,db,onSave}){
 const [values,setValues]=useState(templates)
 const settings=db.customerSettings||{}
 async function save(){await onSave(values);alert('Respuestas rápidas guardadas.')}
 return <div className="panel attention-templates">
  <div className="panel-heading"><div><h3>Respuestas rápidas</h3><p>Podés usar <code>{'{catalogo}'}</code>, <code>{'{whatsapp}'}</code> y <code>{'{negocio}'}</code>. Catálogo actual: {settings.catalogUrl||settings.storeUrl||window.location.origin+'/#pedido'}</p></div><button className="primary" onClick={save}>Guardar plantillas</button></div>
  <div className="attention-template-grid">{CATEGORIES.map(([id,label])=><label key={id}><span>{label}</span><textarea rows="6" value={values[id]||''} onChange={e=>setValues({...values,[id]:e.target.value})}/><small>Vista previa: {applyVariables(values[id],db)}</small></label>)}</div>
 </div>
}


function ChatbotEditor({settings,db,onSave}){
 const [values,setValues]=useState({assistantName:'Mía',assistantSubtitle:'Asistente de Tu Vida en Tinta',assistantImage:'',welcome:'¡Hola! Puedo ayudarte a buscar figuras, conocer precios y armar tu pedido.',...settings})
 async function save(){await onSave(values);alert('Configuración del chatbot guardada. El catálogo usará estas respuestas.')}
 function chooseImage(file){if(!file)return;const reader=new FileReader();reader.onload=()=>setValues(current=>({...current,assistantImage:String(reader.result||'')}));reader.readAsDataURL(file)}
 return <div className="panel attention-templates">
  <div className="panel-heading"><div><h3>Chatbot del catálogo</h3><p>Personalizá la identidad y las respuestas del asistente público. Cuando no puede resolver una consulta, deriva a WhatsApp.</p></div><button className="primary" onClick={save}>Guardar chatbot</button></div>
  <label className="form-check"><input className="form-check-input" type="checkbox" checked={values.enabled!==false} onChange={e=>setValues({...values,enabled:e.target.checked})}/><span className="form-check-label">Mostrar chatbot en el catálogo</span></label>
  <div className="chatbot-identity-editor"><div className="chatbot-avatar-preview">{values.assistantImage?<img src={values.assistantImage} alt={values.assistantName||'Asistente'}/>:<span>💬</span>}</div><div className="chatbot-identity-fields"><label>Nombre del asistente<input value={values.assistantName||''} onChange={e=>setValues({...values,assistantName:e.target.value})} placeholder="Ej.: Mía"/></label><label>Descripción<input value={values.assistantSubtitle||''} onChange={e=>setValues({...values,assistantSubtitle:e.target.value})} placeholder="Asistente de Tu Vida en Tinta"/></label><label>Imagen del asistente<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>chooseImage(e.target.files?.[0])}/></label>{values.assistantImage&&<button type="button" className="ghost smallbtn" onClick={()=>setValues({...values,assistantImage:''})}>Quitar imagen</button>}</div></div>
  <label className="chatbot-welcome-field"><span>Mensaje de bienvenida</span><textarea rows="3" value={values.welcome||''} onChange={e=>setValues({...values,welcome:e.target.value})}/></label>
  <div className="attention-template-grid">{[['catalogo','Buscar figuras'],['precios','Precios'],['envio','Envíos'],['comprar','Cómo comprar'],['humano','Derivación a una persona']].map(([id,label])=><label key={id}><span>{label}</span><textarea rows="5" value={values[id]||''} onChange={e=>setValues({...values,[id]:e.target.value})}/></label>)}</div>
  <div className="notice"><b>Utilidad del Centro de Atención</b><span>Desde acá podés cambiar el nombre, la imagen y las respuestas del chatbot sin modificar código. La opción “Hablar con nosotros” deriva a WhatsApp; luego podés copiar esa conversación al Centro de Atención para darle seguimiento.</span></div>
 </div>
}
