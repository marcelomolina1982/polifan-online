import './prepare-v25.0.64.mjs'
import fs from 'node:fs'

function replaceOnce(text,before,after,label){
  if(!text.includes(before))throw new Error('v25.0.65: no encontré '+label)
  const count=text.split(before).length-1
  if(count!==1)throw new Error('v25.0.65: '+label+' aparece '+count+' veces')
  return text.replace(before,after)
}

// 1) Motor: si el proxy serverless de Vercel devuelve 404/503, consultar el job
// directamente en Render. El backend 1230 habilita CORS sólo para la app.
const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
motor=replaceOnce(
  motor,
  "  async function waitJob(jobId,originalStartedAt=Date.now()){",
  `  async function fetchJobStatus(jobId){
    const raw=String(jobId||'')
    const sep=raw.indexOf(':')
    const bare=sep>0?raw.slice(sep+1):raw
    const encoded=encodeURIComponent(bare)
    let primary=null
    try{
      primary=await fetch('/api/nest-status?id='+encodeURIComponent(raw),{cache:'no-store'})
      if(primary.ok||![404,502,503,504].includes(primary.status))return primary
    }catch{}
    try{
      return await fetch('https://polifan-motor-1230-bench-v5.onrender.com/solve-status?id='+encoded,{cache:'no-store',mode:'cors'})
    }catch(error){
      if(primary)return primary
      throw error
    }
  }
  async function waitJob(jobId,originalStartedAt=Date.now()){`,
  'fallback directo de estado del Motor'
)
motor=replaceOnce(
  motor,
  "response=await fetch('/api/nest-status?id='+encodeURIComponent(jobId),{cache:'no-store'})",
  "response=await fetchJobStatus(jobId)",
  'consulta de estado del Motor'
)
motor=motor.replace(
  "}catch(error){\n      clearActiveJob()\n      setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:error.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])",
  "}catch(error){\n      const activeNow=loadActiveJob();if(activeNow)saveActiveJob({...activeNow,lastError:error.message,lastErrorAt:Date.now()})\n      setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:error.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])"
)
fs.writeFileSync(motorFile,motor)

// 2) Catálogo: cotización real antes de enviar el pedido, con espera visible,
// cuenta regresiva y derivación humana cuando no hay cotización automática.
const customerFile='src/pages/CustomerOrderBase.jsx'
let customer=fs.readFileSync(customerFile,'utf8')
customer=replaceOnce(
  customer,
  "import { argentinaNow, estimateProductionAvailability, formatArgentinaLongDate } from '../lib/production'",
  "import { argentinaNow, estimateProductionAvailability, formatArgentinaLongDate } from '../lib/production'\nimport { resolveLogisticsZone } from '../lib/logisticsZones'",
  'import del resolver logístico en catálogo'
)
customer=replaceOnce(
  customer,
  "  const [sending, setSending] = useState(false)",
  `  const [sending, setSending] = useState(false)
  const [shippingQuote,setShippingQuote]=useState(null)
  const [shippingStatus,setShippingStatus]=useState({state:'idle',remaining:0,message:''})`,
  'estado de cotización del catálogo'
)
customer=replaceOnce(
  customer,
  "  useEffect(() => {trackCatalogEvent('catalog_visit', { metadata: { device: window.innerWidth <= 760 ? 'mobile' : 'desktop', source: customerSource } })}, [customerSource])",
  `  useEffect(()=>{
    if(shippingStatus.state!=='loading')return
    const timer=window.setInterval(()=>setShippingStatus(current=>current.state==='loading'?{...current,remaining:Math.max(0,Number(current.remaining||0)-1)}:current),1000)
    return()=>window.clearInterval(timer)
  },[shippingStatus.state])

  useEffect(() => {trackCatalogEvent('catalog_visit', { metadata: { device: window.innerWidth <= 760 ? 'mobile' : 'desktop', source: customerSource } })}, [customerSource])`,
  'contador de espera del envío'
)
customer=replaceOnce(
  customer,
  "  function update(field, value) {setData(previous => ({ ...previous, [field]: value }))}",
  `  function update(field, value) {
    setData(previous => ({ ...previous, [field]: value }))
    if(['locality','district','province','postalCode','address'].includes(field)){
      setShippingQuote(null)
      setShippingStatus({state:'idle',remaining:0,message:''})
    }
  }

  async function quoteCustomerShipping(){
    if(data.method==='Retiro en el local'){
      const result={kind:'pickup',label:'Retiro en el local',price:0}
      setShippingQuote(result);setShippingStatus({state:'ready',remaining:0,message:'Retiro en el local'})
      return result
    }
    if(!String(data.postalCode||'').trim()&&!String(data.locality||'').trim()){
      alert('Ingresá el código postal o la localidad para calcular el envío.')
      return null
    }
    setShippingQuote(null)
    setShippingStatus({state:'loading',remaining:40,message:'Estamos cotizando tu envío…'})
    try{
      const direct=resolveLogisticsZone({locality:data.locality,district:data.district,province:data.province,postalCode:data.postalCode})
      if(direct){
        const result={kind:'logistics',label:'Logística GBA/CABA',zone:direct.id,price:Number(direct.price||0),destination:[data.locality,data.postalCode].filter(Boolean).join(' · ')}
        setShippingQuote(result);setShippingStatus({state:'ready',remaining:0,message:'Envío calculado'})
        setData(previous=>({...previous,method:'Logística GBA/CABA'}))
        return result
      }
      const query=[String(data.postalCode||'').trim(),String(data.locality||'').trim()].filter(Boolean).join(' ')
      const destinationResponse=await fetch('https://viacargo-quote-probe2.onrender.com/api/destino',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({query})})
      const destination=await destinationResponse.json().catch(()=>({}))
      if(!destinationResponse.ok||!destination?.ok)throw new Error(destination?.error||'No encontramos ese destino automáticamente.')
      const officialLocal=resolveLogisticsZone({locality:destination.locality,district:data.district,province:destination.province,postalCode:destination.cp})
      if(officialLocal){
        const result={kind:'logistics',label:'Logística GBA/CABA',zone:officialLocal.id,price:Number(officialLocal.price||0),destination:destination.destination||[destination.locality,destination.cp,destination.province].filter(Boolean).join(' · ')}
        setShippingQuote(result);setShippingStatus({state:'ready',remaining:0,message:'Envío calculado'})
        setData(previous=>({...previous,method:'Logística GBA/CABA',locality:previous.locality||destination.locality,province:previous.province||destination.province,postalCode:previous.postalCode||destination.cp}))
        return result
      }
      const quoteResponse=await fetch('https://viacargo-quote-probe2.onrender.com/api/cotizar',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({destinationCp:String(destination.cp||data.postalCode||'').trim(),locality:destination.locality||data.locality,province:destination.province||data.province,quantity:Math.max(1,Number(total||1))})})
      const quote=await quoteResponse.json().catch(()=>({}))
      if(!quoteResponse.ok||!quote?.ok)throw new Error(quote?.error||'Vía Cargo no pudo cotizar ese destino.')
      const result={kind:'viacargo',label:'Vía Cargo',price:Number(quote.price||0),priceText:quote.priceText||'',destination:quote.destination||destination.destination||'',service:quote.service||'Agencia → Agencia'}
      setShippingQuote(result);setShippingStatus({state:'ready',remaining:0,message:'Envío calculado'})
      setData(previous=>({...previous,method:'Vía Cargo',locality:previous.locality||destination.locality,province:previous.province||destination.province,postalCode:previous.postalCode||destination.cp}))
      return result
    }catch(error){
      const result={kind:'manual',label:'Cotización manual',price:null,error:error?.message||String(error)}
      setShippingQuote(result)
      setShippingStatus({state:'manual',remaining:0,message:'Te ayudamos personalmente con el envío'})
      setData(previous=>({...previous,method:'Otro expreso'}))
      return result
    }
  }`,
  'función de cotización del catálogo'
)

customer=replaceOnce(
  customer,
  "    if (!items.length&&!specialQty) return alert('Elegí al menos un producto o describí una figura especial.')",
  `    if (!items.length&&!specialQty) return alert('Elegí al menos un producto o describí una figura especial.')
    if(data.method!=='Retiro en el local'&&!shippingQuote)return alert('Primero tocá “Calcular envío” para conocer el costo o verificar si necesitamos cotizarlo personalmente.')`,
  'control de cotización antes del envío'
)
customer=replaceOnce(
  customer,
  "    const productionText=productionDate?`🛠️ *Producción disponible:* Desde ${fmtProductionDate(productionDate).toLowerCase()} en adelante`:'🛠️ *Producción disponible:* Fecha a confirmar por nuestro equipo'",
  `    const productionText=productionDate?\`🛠️ *Producción disponible:* Desde \${fmtProductionDate(productionDate).toLowerCase()} en adelante\`:'🛠️ *Producción disponible:* Fecha a confirmar por nuestro equipo'
    const shippingText=shippingQuote?.kind==='logistics'?\`🚚 *Envío:* Logística GBA/CABA · \${shippingQuote.zone} · \${money(shippingQuote.price)}\`:shippingQuote?.kind==='viacargo'?\`🚚 *Envío:* Vía Cargo · \${shippingQuote.service||'Agencia → Agencia'} · \${money(shippingQuote.price)}\`:shippingQuote?.kind==='manual'?'⚠️ *ENVÍO A COTIZAR MANUALMENTE*':data.method==='Retiro en el local'?'📍 *Entrega:* Retiro en el local':''`,
  'texto calculado de envío'
)
customer=replaceOnce(
  customer,
  "productionText,'','*PRODUCTOS*'",
  "productionText,shippingText,'','*PRODUCTOS*'",
  'envío en mensaje de WhatsApp'
)
customer=replaceOnce(
  customer,
  "customer:{...data,source:customerSource,name:[data.firstName,data.lastName].filter(Boolean).join(' '),delivery:'',estimatedDeliveryStart:productionDate,estimatedDeliveryEnd:productionDate,productionDateStatus:productionDate?'estimada':'pendiente de confirmar'}",
  "customer:{...data,source:customerSource,name:[data.firstName,data.lastName].filter(Boolean).join(' '),delivery:'',shippingQuote:shippingQuote||null,estimatedDeliveryStart:productionDate,estimatedDeliveryEnd:productionDate,productionDateStatus:productionDate?'estimada':'pendiente de confirmar'}",
  'persistencia de cotización en solicitud web'
)

const deliveryUi=`{data.method!=='Retiro en el local'&&<div className="customer-shipping-quote">
          <div><small>🚚 ENVÍO</small><b>{shippingQuote?.kind==='manual'?'Necesitamos cotizarlo con vos':shippingQuote?'Envío calculado':'Calculá tu envío antes de enviar el pedido'}</b></div>
          <button type="button" onClick={quoteCustomerShipping} disabled={shippingStatus.state==='loading'}>{shippingStatus.state==='loading'?'Cotizando…':'Calcular envío'}</button>
          {shippingQuote?.kind==='logistics'&&<p><strong>{money(shippingQuote.price)}</strong> · Logística GBA/CABA · {shippingQuote.zone}<br/><span>{shippingQuote.destination}</span></p>}
          {shippingQuote?.kind==='viacargo'&&<p><strong>{money(shippingQuote.price)}</strong> · Vía Cargo · {shippingQuote.service||'Agencia → Agencia'}<br/><span>{shippingQuote.destination}</span></p>}
          {shippingQuote?.kind==='manual'&&<p className="manual"><strong>No pudimos calcular automáticamente el envío a tu localidad.</strong><br/>Podés continuar con tu pedido. Te vamos a derivar por WhatsApp para cotizarlo personalmente y no agregaremos ningún costo hasta que lo confirmemos con vos.</p>}
        </div>}
        `
customer=replaceOnce(
  customer,
  "        {data.method==='Vía Cargo'&&<label>¿Cómo lo recibís?",
  "        "+deliveryUi+"{data.method==='Vía Cargo'&&<label>¿Cómo lo recibís?",
  'bloque de cotización en formulario'
)
customer=replaceOnce(
  customer,
  "  return <div className=\"customer-page\">",
  `  return <div className="customer-page">
    <style>{\`
      .shipping-quote-overlay{position:fixed;inset:0;z-index:9999;background:rgba(247,249,252,.94);display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(6px)}
      .shipping-quote-card{max-width:430px;width:100%;background:#fff;border:1px solid #e7eaf0;border-radius:24px;padding:28px;text-align:center;box-shadow:0 24px 70px rgba(35,53,72,.16)}
      .shipping-quote-spinner{width:54px;height:54px;margin:0 auto 16px;border-radius:50%;border:5px solid #f7cfe0;border-top-color:#e82d79;animation:shipSpin .8s linear infinite}
      .shipping-quote-card h3{margin:0 0 8px;color:#263548}.shipping-quote-card p{margin:0;color:#768697}.shipping-quote-card strong{display:block;font-size:34px;margin-top:16px;color:#e82d79}
      .customer-shipping-quote{grid-column:1/-1;border:1px solid #dfe5ed;background:#fff;border-radius:18px;padding:16px;display:grid;gap:12px}.customer-shipping-quote>div{display:flex;flex-direction:column}.customer-shipping-quote small{font-weight:800;color:#2d9ca8;letter-spacing:.08em}.customer-shipping-quote b{color:#263548}.customer-shipping-quote button{border:0;border-radius:14px;padding:14px 18px;background:linear-gradient(135deg,#e82d79,#ff5b9f);color:#fff;font-weight:800}.customer-shipping-quote p{margin:0;color:#39495d;line-height:1.45}.customer-shipping-quote p strong{font-size:24px;color:#263548}.customer-shipping-quote p span{color:#7d8999}.customer-shipping-quote .manual{background:#fff7eb;border:1px solid #f5d7a6;border-radius:14px;padding:13px;color:#6f521d}
      @keyframes shipSpin{to{transform:rotate(360deg)}}
    \`}</style>
    {shippingStatus.state==='loading'&&<div className="shipping-quote-overlay" role="status" aria-live="polite"><div className="shipping-quote-card"><div className="shipping-quote-spinner"/><h3>Estamos cotizando tu envío</h3><p>No cierres esta ventana. Estamos buscando la opción correcta para tu localidad.</p><strong>{shippingStatus.remaining>0?shippingStatus.remaining+' s':'Unos segundos más…'}</strong><p>Normalmente demora entre 20 y 40 segundos.</p></div></div>}`,
  'overlay de espera del cliente'
)
fs.writeFileSync(customerFile,customer)

// 3) Versión y guardas.
if(!motor.includes('fetchJobStatus'))throw new Error('v25.0.65: falta fallback directo del Motor')
if(!customer.includes('Estamos cotizando tu envío'))throw new Error('v25.0.65: falta experiencia de espera del catálogo')
if(!customer.includes('ENVÍO A COTIZAR MANUALMENTE'))throw new Error('v25.0.65: falta derivación manual')
const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.65'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.65'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · motor directo + cotización guiada en catálogo'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.65'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.65'"))
console.log('v25.0.65 PREDEPLOY OK · Motor con estado directo de respaldo · catálogo cotiza con cuenta regresiva y derivación manual')
