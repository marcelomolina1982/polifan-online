import './prepare-v25.0.56.mjs'
import fs from 'node:fs'
import { runLogisticsMoneyRegression } from '../src/lib/logisticsZones.js'

const regression=runLogisticsMoneyRegression()
if(!regression.ok)throw new Error('v25.0.61: regresión de tarifas de logística: '+JSON.stringify(regression.failures))
console.log(`v25.0.61: regresión logística OK · ${regression.total} controles de dinero`)

const file='src/pages/CustomerOrderBase.jsx'
let s=fs.readFileSync(file,'utf8')
function replaceOnce(before,after,label){
  if(!s.includes(before))throw new Error('v25.0.61: no encontré '+label)
  const count=s.split(before).length-1
  if(count!==1)throw new Error('v25.0.61: '+label+' aparece '+count+' veces')
  s=s.replace(before,after)
}

replaceOnce("import { argentinaNow, estimateProductionAvailability, formatArgentinaLongDate } from '../lib/production'","import { argentinaNow, estimateProductionAvailability, formatArgentinaLongDate } from '../lib/production'\nimport { resolveLogisticsZone } from '../lib/logisticsZones'",'import logisticsZones')

replaceOnce("  const total = items.reduce((sum, item) => sum + item.qty, 0)+specialQty\n  const deliveryEstimate",`  const total = items.reduce((sum, item) => sum + item.qty, 0)+specialQty
  const logisticsQuote=useMemo(()=>resolveLogisticsZone({locality:data.locality,district:data.district,province:data.province,postalCode:data.postalCode}),[data.locality,data.district,data.province,data.postalCode])
  const logisticsGrandTotal=estimatedTotal+(data.method==='Logística GBA/CABA'&&logisticsQuote?logisticsQuote.price:0)
  useEffect(()=>{
    if(data.method!=='Vía Cargo'){setViaCargoQuote(null);setViaCargoQuoteError('');return}
    const cp=String(data.postalCode||'').trim(),locality=String(data.locality||'').trim(),province=String(data.province||'').trim()
    if(!/^\\d{4}$/.test(cp)||!locality||!province||total<1){setViaCargoQuote(null);return}
    if(viaCargoQuote&&viaCargoQuote.destinationCp===cp&&String(viaCargoQuote.locality||'')===locality&&String(viaCargoQuote.province||'')===province&&Number(viaCargoQuote.quantity)===Number(total))return
    const timer=setTimeout(()=>quoteViaCargo({silent:true}),700)
    return()=>clearTimeout(timer)
  },[data.method,data.postalCode,data.locality,data.province,total])
  const deliveryEstimate`,'cálculo logística y precotización Via Cargo')

replaceOnce("    if(data.method==='Vía Cargo' && (!data.dni.trim()||!data.address.trim()||!data.locality.trim()||!data.district.trim()||!data.province.trim()||!data.postalCode.trim()||!data.email.trim())) return alert('Completá DNI, domicilio, localidad, partido, provincia, código postal y correo electrónico.')\n    setSending(true)","    if(data.method==='Vía Cargo' && (!data.dni.trim()||!data.address.trim()||!data.locality.trim()||!data.district.trim()||!data.province.trim()||!data.postalCode.trim()||!data.email.trim())) return alert('Completá DNI, domicilio, localidad, partido, provincia, código postal y correo electrónico.')\n    if(data.method==='Logística GBA/CABA'&&!logisticsQuote)return alert('La localidad o partido ingresado no está dentro de las zonas de entrega de nuestra logística. Podés elegir Vía Cargo u otro expreso.')\n    setSending(true)",'validación cobertura logística')

replaceOnce("data.method==='Vía Cargo'?`🚚 *Modalidad:* Agencia → Agencia · pago en destino`:'',data.method==='Vía Cargo'&&finalViaCargoQuote?`💳 *Envío Vía Cargo estimado:* ${money(finalViaCargoQuote.price)} · se abona al retirar en agencia`:'',productionText","data.method==='Logística GBA/CABA'&&logisticsQuote?`🚚 *Zona logística:* ${logisticsQuote.id}`:'',data.method==='Logística GBA/CABA'&&logisticsQuote?`💳 *Envío logística:* ${money(logisticsQuote.price)}`:'',data.method==='Vía Cargo'?`🚚 *Modalidad:* Agencia → Agencia · pago en destino`:'',data.method==='Vía Cargo'&&finalViaCargoQuote?`💳 *Envío Vía Cargo estimado:* ${money(finalViaCargoQuote.price)} · se abona al retirar en agencia`:'',productionText",'mensaje zona logística')

replaceOnce("estimatedTotal?`💰 *Total estimado:* ${money(estimatedTotal)}`:'','',`📝 *Observaciones:* ${data.notes.trim()||'Sin observaciones'}`,'','El total es estimado y no incluye envío.'","estimatedTotal?`💰 *Productos:* ${money(estimatedTotal)}`:'',data.method==='Logística GBA/CABA'&&logisticsQuote?`💜 *Total estimado con envío:* ${money(logisticsGrandTotal)}`:'','',`📝 *Observaciones:* ${data.notes.trim()||'Sin observaciones'}`,'',data.method==='Logística GBA/CABA'&&logisticsQuote?'El total incluye la tarifa vigente de logística para la zona detectada.':'El total es estimado y no incluye envío.'",'totales WhatsApp logística')

replaceOnce("customer:{...data,agencyDelivery:data.method==='Vía Cargo'?'Retiro en agencia':data.agencyDelivery,viaCargoQuote:data.method==='Vía Cargo'?finalViaCargoQuote:null,source:customerSource","customer:{...data,agencyDelivery:data.method==='Vía Cargo'?'Retiro en agencia':data.agencyDelivery,viaCargoQuote:data.method==='Vía Cargo'?finalViaCargoQuote:null,logisticsQuote:data.method==='Logística GBA/CABA'?logisticsQuote:null,shippingPrice:data.method==='Logística GBA/CABA'&&logisticsQuote?logisticsQuote.price:null,totalWithShipping:data.method==='Logística GBA/CABA'&&logisticsQuote?logisticsGrandTotal:null,source:customerSource",'guardado zona logística')

replaceOnce("metadata:{method:data.method,estimatedTotal,source:customerSource,specialFigure:","metadata:{method:data.method,estimatedTotal,shippingZone:data.method==='Logística GBA/CABA'?logisticsQuote?.id:null,shippingPrice:data.method==='Logística GBA/CABA'?logisticsQuote?.price:null,source:customerSource,specialFigure:",'analytics logística')

const formAnchor="</>}\n        {data.method==='Vía Cargo'&&<div className=\"delivery-estimate-box\">"
const formReplacement=`</>}
        {data.method==='Logística GBA/CABA'&&<div className="delivery-estimate-box logistics-zone-box"><small>🚚 ENVÍO LOGÍSTICA GBA/CABA</small>{logisticsQuote?<><b>{logisticsQuote.id} · {money(logisticsQuote.price)}</b><span>Cobertura detectada por {logisticsQuote.source==='district'?'partido/departamento':'localidad'}. Total estimado con envío: <strong>{money(logisticsGrandTotal)}</strong></span></>:data.locality.trim()||data.district.trim()?<><b>Zona no encontrada</b><span>Revisá localidad y partido. Si no pertenece a nuestras zonas, elegí Vía Cargo u otro expreso.</span></>:<><b>Completá localidad y partido</b><span>Te mostraremos automáticamente la zona y el valor del envío.</span></>}</div>}
        {data.method==='Vía Cargo'&&<div className="delivery-estimate-box">`
replaceOnce(formAnchor,formReplacement,'panel de precio logística')

fs.writeFileSync(file,s)

// El motor y la pantalla Para cortar deben consumir exactamente el mismo plan.
const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
const oldImport="import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'"
const newImport="import {normalizeFigureKey} from '../lib/inventory'\nimport {pendingCutPlan} from '../lib/cutPlanning'"
if(motor.includes(oldImport))motor=motor.replace(oldImport,newImport)
else if(!motor.includes(newImport))throw new Error('v25.0.61: MotorDefinitivo no tiene un import de planificación reconocido')
if(motor.includes('pendingCutByDelivery(db).forEach'))motor=motor.replace('pendingCutByDelivery(db).forEach','pendingCutPlan(db).forEach')
else if(!motor.includes('pendingCutPlan(db).forEach'))throw new Error('v25.0.61: MotorDefinitivo no tiene un consumo de planificación reconocido')
fs.writeFileSync(motorFile,motor)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.61'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.61'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · producción unificada + Vía Cargo rápido'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.61'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.61'"))
console.log('v25.0.61: Para cortar + motor unificados · atrasados activos visibles · Via Cargo precotiza directo en Render')