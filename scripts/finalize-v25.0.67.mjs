import './finalize-v25.0.66.mjs'
import fs from 'node:fs'

function one(text,before,after,label){
  const count=text.split(before).length-1
  if(count!==1)throw new Error(`finalize-v25.0.67: ${label} aparece ${count} veces`)
  return text.replace(before,after)
}

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
const oldRoute='/api/nest-status?id='
const occurrences=motor.split(oldRoute).length-1
if(occurrences<1)throw new Error('finalize-v25.0.67: no se encontró la ruta de estado anterior')
motor=motor.replaceAll(oldRoute,'/api/nest-status-v5?id=')
if(!motor.includes('/api/nest-status-v5?id='))throw new Error('finalize-v25.0.67: no quedó el proxy V5 nuevo')
fs.writeFileSync(motorFile,motor)

const customerFile='src/pages/CustomerOrderBase.jsx'
let customer=fs.readFileSync(customerFile,'utf8')
customer=one(customer,"  async function quoteCustomerShipping(){",`  async function fetchShippingTimed(url,options={},timeoutMs=45000){
    const controller=new AbortController()
    const timer=window.setTimeout(()=>controller.abort(),timeoutMs)
    try{return await fetch(url,{...options,signal:controller.signal})}
    finally{window.clearTimeout(timer)}
  }

  async function quoteCustomerShipping(){`,'helper timeout de envío')
customer=one(customer,"const destinationResponse=await fetch('https://viacargo-quote-probe2.onrender.com/api/destino'","const destinationResponse=await fetchShippingTimed('https://viacargo-quote-probe2.onrender.com/api/destino'",'timeout destino')
customer=one(customer,"const quoteResponse=await fetch('https://viacargo-quote-probe2.onrender.com/api/cotizar'","const quoteResponse=await fetchShippingTimed('https://viacargo-quote-probe2.onrender.com/api/cotizar'",'timeout cotización')
customer=one(customer,"shippingQuote?.kind==='manual'?'⚠️ *ENVÍO A COTIZAR MANUALMENTE*'",`shippingQuote?.kind==='manual'?\`⚠️ *ENVÍO A COTIZAR MANUALMENTE*\\n📮 *CP:* \${data.postalCode.trim()||'Sin informar'}\\n🏙️ *Localidad:* \${data.locality.trim()||'Sin informar'}\\n📌 *Provincia:* \${data.province.trim()||'Sin informar'}\\n🔢 *Cantidad:* \${total}\``,'detalle WhatsApp manual')
customer=one(customer,"Podés continuar con tu pedido. Te vamos a derivar por WhatsApp para cotizarlo personalmente y no agregaremos ningún costo hasta que lo confirmemos con vos.","Podés continuar con tu pedido. Te vamos a derivar a WhatsApp para que nuestro equipo cotice el envío personalmente. No se agregará ningún costo de envío hasta que lo confirmemos con vos.",'texto fallback manual')
if(!customer.includes('fetchShippingTimed'))throw new Error('No quedó timeout de cotización')
if(!customer.includes('ENVÍO A COTIZAR MANUALMENTE'))throw new Error('No quedó aviso manual')
if(!customer.includes("*Cantidad:* ${total}"))throw new Error('No quedó cantidad en WhatsApp manual')
fs.writeFileSync(customerFile,customer)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.67'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.67'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Motor V5 proxy fresco + envíos protegidos'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.67'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.67'"))

console.log('v25.0.67 FINALIZE OK · Motor V5 fresco · cotización acotada · fallback WhatsApp completo')
