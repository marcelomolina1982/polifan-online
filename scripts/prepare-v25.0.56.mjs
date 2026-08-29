import './prepare-v25.0.55.mjs'
import fs from 'node:fs'

const file='src/pages/CustomerOrderBase.jsx'
let s=fs.readFileSync(file,'utf8')
function replaceOnce(before,after,label){
  if(!s.includes(before))throw new Error('v25.0.56: no encontré '+label)
  const count=s.split(before).length-1
  if(count!==1)throw new Error('v25.0.56: '+label+' aparece '+count+' veces')
  s=s.replace(before,after)
}

replaceOnce("  const [sending, setSending] = useState(false)","  const [sending, setSending] = useState(false)\n  const [viaCargoQuote,setViaCargoQuote]=useState(null)\n  const [viaCargoQuoteError,setViaCargoQuoteError]=useState('')\n  const [viaCargoQuoting,setViaCargoQuoting]=useState(false)",'estado sending')

replaceOnce("agencyDelivery: 'Envío a domicilio'","agencyDelivery: 'Retiro en agencia'",'modalidad inicial Via Cargo')

const updateAnchor="  function update(field, value) {setData(previous => ({ ...previous, [field]: value }))}\n\n  async function send() {"
const quoteBlock=`  function update(field, value) {setData(previous => ({ ...previous, [field]: value }))}\n\n  async function quoteViaCargo({silent=false}={}) {\n    const cp=String(data.postalCode||'').trim()\n    if(!/^\\d{4}$/.test(cp)){if(!silent)alert('Ingresá un código postal de 4 dígitos para cotizar Vía Cargo.');return null}\n    if(total<1){if(!silent)alert('Elegí al menos un producto antes de cotizar el envío.');return null}\n    setViaCargoQuoting(true);setViaCargoQuoteError('')\n    try{\n      const response=await fetch('/api/viacargo-quote',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({destinationCp:cp,quantity:total})})\n      const payload=await response.json().catch(()=>({}))\n      if(!response.ok||!payload?.ok)throw new Error(payload?.error||'Vía Cargo no tiene una tarifa Agencia → Agencia disponible para ese código postal.')\n      setViaCargoQuote(payload);return payload\n    }catch(error){\n      const message=error?.message||'No se pudo cotizar Vía Cargo en este momento.'\n      setViaCargoQuote(null);setViaCargoQuoteError(message);if(!silent)alert(message);return null\n    }finally{setViaCargoQuoting(false)}\n  }\n\n  async function send() {`
replaceOnce(updateAnchor,quoteBlock,'función update/send')

replaceOnce("    setSending(true)\n    const latestState=await refreshPlanning(false,{retries:1})","    setSending(true)\n    let finalViaCargoQuote=viaCargoQuote\n    if(data.method==='Vía Cargo'){\n      const currentCp=String(data.postalCode||'').trim()\n      if(!finalViaCargoQuote||finalViaCargoQuote.destinationCp!==currentCp||Number(finalViaCargoQuote.quantity)!==Number(total)){finalViaCargoQuote=await quoteViaCargo({silent:true})}\n      if(!finalViaCargoQuote){setSending(false);return alert(viaCargoQuoteError||'No pudimos confirmar una tarifa Agencia → Agencia de Vía Cargo para ese código postal. Contactanos para revisarlo.')}\n    }\n    const latestState=await refreshPlanning(false,{retries:1})",'cotización antes de guardar')

replaceOnce("data.method==='Vía Cargo'?`🚚 *Modalidad:* ${data.agencyDelivery}`:'',productionText","data.method==='Vía Cargo'?`🚚 *Modalidad:* Agencia → Agencia · pago en destino`:'',data.method==='Vía Cargo'&&finalViaCargoQuote?`💳 *Envío Vía Cargo estimado:* ${money(finalViaCargoQuote.price)} · se abona al retirar en agencia`:'',productionText",'mensaje WhatsApp Via Cargo')

replaceOnce("customer:{...data,source:customerSource,name:[data.firstName,data.lastName].filter(Boolean).join(' '),delivery:'',estimatedDeliveryStart:productionDate,estimatedDeliveryEnd:productionDate,productionDateStatus:productionDate?'estimada':'pendiente de confirmar'}","customer:{...data,agencyDelivery:data.method==='Vía Cargo'?'Retiro en agencia':data.agencyDelivery,viaCargoQuote:data.method==='Vía Cargo'?finalViaCargoQuote:null,source:customerSource,name:[data.firstName,data.lastName].filter(Boolean).join(' '),delivery:'',estimatedDeliveryStart:productionDate,estimatedDeliveryEnd:productionDate,productionDateStatus:productionDate?'estimada':'pendiente de confirmar'}",'guardado web_requests Via Cargo')

replaceOnce("{data.method==='Vía Cargo'&&<label>¿Cómo lo recibís?<select value={data.agencyDelivery} onChange={event=>update('agencyDelivery',event.target.value)}><option>Envío a domicilio</option><option>Retiro en agencia</option></select></label>}","{data.method==='Vía Cargo'&&<div className=\"delivery-estimate-box\"><small>🚚 VÍA CARGO · AGENCIA → AGENCIA</small><b>Se abona al retirar en la agencia de destino</b><span>Origen: Boulogne (CP 1609). El embalaje no se cobra aparte al cliente.</span><button type=\"button\" className=\"planning-retry\" disabled={viaCargoQuoting||total<1||!/^\\d{4}$/.test(String(data.postalCode||'').trim())} onClick={()=>quoteViaCargo()}>{viaCargoQuoting?'Cotizando…':'Cotizar envío Vía Cargo'}</button>{viaCargoQuote&&<strong>{money(viaCargoQuote.price)} <small>estimado · {viaCargoQuote.destination||data.postalCode}</small></strong>}{viaCargoQuoteError&&<span>{viaCargoQuoteError} Contactanos para revisarlo.</span>}</div>}",'selector Via Cargo')

fs.writeFileSync(file,s)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.59'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.59'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Vía Cargo agencia a agencia integrado'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.59'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.59'"))
console.log('v25.0.59: Vía Cargo agencia → agencia · CP 1609 · pago en destino · cotización guardada')
