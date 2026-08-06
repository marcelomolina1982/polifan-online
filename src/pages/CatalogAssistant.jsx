import React,{useMemo,useState} from 'react'
import {Title} from '../components/UI'

const DEFAULTS={
 enabled:true,
 assistantName:'Mía',
 assistantSubtitle:'Asistente de Tu Vida en Tinta',
 assistantImage:'',
 themeColor:'#6f3dc4',
 welcome:'¡Hola! Puedo ayudarte a buscar figuras, conocer precios y armar tu pedido.',
 tone:'Cercana',
 catalogo:'Podés buscar por nombre o recorrer las categorías. Usá el buscador del catálogo para encontrar la figura que necesitás.',
 precios:'Los precios se calculan automáticamente según la cantidad. Armá el carrito y vas a ver el total estimado de los productos.',
 envio:'El envío se coordina por WhatsApp después de revisar localidad, provincia y código postal.',
 comprar:'Elegí las figuras, completá tus datos y enviá la solicitud. Después confirmaremos disponibilidad, fecha, pago y envío.',
 humano:'Esta consulta necesita una persona. Presioná el botón para escribirnos por WhatsApp.',
 enableCatalog:true,
 enablePrices:true,
 enableShipping:true,
 enablePurchase:true,
 enableHuman:true,
 showPromotions:true,
 recommendProducts:true,
}

const TABS=[['general','General'],['personality','Personalidad'],['responses','Respuestas'],['functions','Funciones']]

export default function CatalogAssistant({db,onSave}){
 const [tab,setTab]=useState('general')
 const [values,setValues]=useState({...DEFAULTS,...(db.chatbotSettings||{})})
 const [saving,setSaving]=useState(false)
 const previewColor=values.themeColor||DEFAULTS.themeColor
 const actions=useMemo(()=>[
  values.enableCatalog!==false&&'Buscar figuras',
  values.enablePrices!==false&&'Consultar precios',
  values.enableShipping!==false&&'Consultar envío',
  values.enablePurchase!==false&&'Cómo comprar',
  values.enableHuman!==false&&'Hablar con nosotros',
 ].filter(Boolean),[values])

 function patch(key,value){setValues(current=>({...current,[key]:value}))}
 function chooseImage(file){
  if(!file)return
  if(file.size>900000){alert('La imagen es demasiado pesada. Usá una imagen menor a 900 KB.');return}
  const reader=new FileReader()
  reader.onload=()=>patch('assistantImage',String(reader.result||''))
  reader.readAsDataURL(file)
 }
 async function save(){
  setSaving(true)
  const result=await onSave({...db,chatbotSettings:values})
  setSaving(false)
  if(result?.ok!==false)alert('Asistente del catálogo guardado. Los cambios ya se aplican en el catálogo público.')
 }

 return <>
  <Title title="Asistente del Catálogo" sub="Configurá el nombre, avatar, personalidad y funciones del chatbot que ven tus clientes." actions={<><button className="ghost" onClick={()=>window.open(`${window.location.origin}/#pedido`,'_blank','noopener,noreferrer')}>Ver catálogo</button><button className="primary" onClick={save} disabled={saving}>{saving?'Guardando…':'Guardar asistente'}</button></>}/>

  <div className="assistant-layout">
   <section className="panel assistant-settings">
    <div className="request-tabs assistant-tabs">{TABS.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>

    {tab==='general'&&<div className="assistant-form-section">
     <label className="form-check"><input className="form-check-input" type="checkbox" checked={values.enabled!==false} onChange={e=>patch('enabled',e.target.checked)}/><span className="form-check-label">Mostrar el asistente en el catálogo público</span></label>
     <div className="chatbot-identity-editor">
      <div className="chatbot-avatar-preview">{values.assistantImage?<img src={values.assistantImage} alt={values.assistantName||'Asistente'}/>:<span>💬</span>}</div>
      <div className="chatbot-identity-fields">
       <label>Nombre del asistente<input value={values.assistantName||''} onChange={e=>patch('assistantName',e.target.value)} placeholder="Ej.: Mía"/></label>
       <label>Descripción<input value={values.assistantSubtitle||''} onChange={e=>patch('assistantSubtitle',e.target.value)} placeholder="Asistente de Tu Vida en Tinta"/></label>
       <label>Avatar del asistente<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>chooseImage(e.target.files?.[0])}/><small>PNG, JPG o WebP. Recomendado: imagen cuadrada y menor a 900 KB.</small></label>
       <label>Color principal<div className="assistant-color-row"><input type="color" value={previewColor} onChange={e=>patch('themeColor',e.target.value)}/><input value={previewColor} onChange={e=>patch('themeColor',e.target.value)} /></div></label>
       {values.assistantImage&&<button type="button" className="ghost smallbtn" onClick={()=>patch('assistantImage','')}>Quitar avatar</button>}
      </div>
     </div>
     <label className="chatbot-welcome-field"><span>Mensaje de bienvenida</span><textarea rows="4" value={values.welcome||''} onChange={e=>patch('welcome',e.target.value)}/></label>
    </div>}

    {tab==='personality'&&<div className="assistant-form-section">
     <label>Estilo de respuesta<select value={values.tone||'Cercana'} onChange={e=>patch('tone',e.target.value)}><option>Cercana</option><option>Profesional</option><option>Amable y breve</option><option>Entusiasta</option></select></label>
     <div className="notice"><b>Cómo se usa esta opción</b><span>Define el tono general que querés mantener al editar las respuestas. El asistente actual usa respuestas guiadas y seguras: no confirma fechas, pagos ni costos de envío automáticamente.</span></div>
     <label className="form-check"><input className="form-check-input" type="checkbox" checked={values.recommendProducts!==false} onChange={e=>patch('recommendProducts',e.target.checked)}/><span className="form-check-label">Permitir recomendaciones de productos del catálogo</span></label>
     <label className="form-check"><input className="form-check-input" type="checkbox" checked={values.showPromotions!==false} onChange={e=>patch('showPromotions',e.target.checked)}/><span className="form-check-label">Mencionar promociones y precios por cantidad</span></label>
    </div>}

    {tab==='responses'&&<div className="attention-template-grid assistant-response-grid">
     {[['catalogo','Buscar figuras'],['precios','Precios'],['envio','Envíos'],['comprar','Cómo comprar'],['humano','Derivación a una persona']].map(([id,label])=><label key={id}><span>{label}</span><textarea rows="6" value={values[id]||''} onChange={e=>patch(id,e.target.value)}/></label>)}
    </div>}

    {tab==='functions'&&<div className="assistant-form-section assistant-function-list">
     <FunctionToggle label="Buscar figuras" detail="Lleva al cliente al buscador del catálogo." checked={values.enableCatalog!==false} onChange={v=>patch('enableCatalog',v)}/>
     <FunctionToggle label="Consultar precios" detail="Explica cómo se calcula el precio según la cantidad." checked={values.enablePrices!==false} onChange={v=>patch('enablePrices',v)}/>
     <FunctionToggle label="Consultar envío" detail="Solicita localidad, provincia y código postal sin prometer un costo." checked={values.enableShipping!==false} onChange={v=>patch('enableShipping',v)}/>
     <FunctionToggle label="Cómo comprar" detail="Guía al cliente para armar y enviar su solicitud." checked={values.enablePurchase!==false} onChange={v=>patch('enablePurchase',v)}/>
     <FunctionToggle label="Hablar con una persona" detail="Deriva la conversación al WhatsApp configurado." checked={values.enableHuman!==false} onChange={v=>patch('enableHuman',v)}/>
     <div className="notice"><b>Seguridad comercial</b><span>El asistente no acepta pedidos, no confirma pagos y no promete fechas ni costos de envío. Las consultas especiales se derivan a una persona.</span></div>
    </div>}
   </section>

   <aside className="panel assistant-preview-panel">
    <small className="section-kicker">VISTA PREVIA</small>
    <div className="assistant-phone-preview">
     <header style={{background:previewColor}}><div className="catalog-chat-avatar">{values.assistantImage?<img src={values.assistantImage} alt={values.assistantName||'Asistente'}/>:<span>💬</span>}</div><div><b>{values.assistantName||'Asistente'}</b><small>{values.assistantSubtitle||'Tu Vida en Tinta'}</small></div></header>
     <div className="assistant-preview-body"><div className="chat-message bot">{values.welcome||DEFAULTS.welcome}</div><div className="assistant-preview-actions">{actions.map(action=><button key={action}>{action}</button>)}</div></div>
    </div>
    <p className="assistant-preview-note">El avatar y el nombre se muestran en el botón flotante y en el encabezado del chat del catálogo.</p>
   </aside>
  </div>
 </>
}

function FunctionToggle({label,detail,checked,onChange}){
 return <label className="assistant-function-row"><span><b>{label}</b><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/></label>
}
