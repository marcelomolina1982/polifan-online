import './prepare-v25.0.57.mjs'
import fs from 'node:fs'

const customerFile='src/pages/CustomerOrderBase.jsx'
let customer=fs.readFileSync(customerFile,'utf8')
function replaceOnce(text,before,after,label){
  if(!text.includes(before))throw new Error('v25.0.61 predeploy: no encontré '+label)
  const count=text.split(before).length-1
  if(count!==1)throw new Error('v25.0.61 predeploy: '+label+' aparece '+count+' veces')
  return text.replace(before,after)
}

customer=replaceOnce(customer,"import React, { useEffect, useMemo, useState } from 'react'","import React, { useEffect, useMemo, useRef, useState } from 'react'",'import useRef')
customer=replaceOnce(customer,"  const [viaCargoQuoting,setViaCargoQuoting]=useState(false)","  const [viaCargoQuoting,setViaCargoQuoting]=useState(false)\n  const viaCargoRequestRef=useRef(0)",'control de carrera Via Cargo')
customer=replaceOnce(customer,"    setViaCargoQuoting(true);setViaCargoQuoteError('')\n    try{","    const requestId=++viaCargoRequestRef.current\n    setViaCargoQuoting(true);setViaCargoQuoteError('')\n    try{",'ticket de cotización Via Cargo')
customer=replaceOnce(customer,"      setViaCargoQuote(normalized);return normalized","      if(requestId!==viaCargoRequestRef.current)return null\n      setViaCargoQuote(normalized);return normalized",'guardado de cotización vigente')
customer=replaceOnce(customer,"      setViaCargoQuote(null);setViaCargoQuoteError(message);if(!silent)alert(message);return null\n    }finally{setViaCargoQuoting(false)}","      if(requestId===viaCargoRequestRef.current){setViaCargoQuote(null);setViaCargoQuoteError(message);if(!silent)alert(message)}\n      return null\n    }finally{if(requestId===viaCargoRequestRef.current)setViaCargoQuoting(false)}",'cierre seguro de cotización')
customer=replaceOnce(customer,"  useEffect(()=>{\n    if(data.method!=='Vía Cargo'){setViaCargoQuote(null);setViaCargoQuoteError('');return}","  useEffect(()=>{\n    viaCargoRequestRef.current+=1\n    if(data.method!=='Vía Cargo'){setViaCargoQuote(null);setViaCargoQuoteError('');return}",'invalidación inmediata de cotización al cambiar datos')
customer=replaceOnce(customer,"    if(!/^\\d{4}$/.test(cp)||!locality||!province||total<1){setViaCargoQuote(null);return}\n    if(viaCargoQuote&&viaCargoQuote.destinationCp===cp&&String(viaCargoQuote.locality||'')===locality&&String(viaCargoQuote.province||'')===province&&Number(viaCargoQuote.quantity)===Number(total))return","    if(!/^\\d{4}$/.test(cp)||!locality||!province||total<1){setViaCargoQuote(null);setViaCargoQuoteError('');return}\n    const quoteStillMatches=viaCargoQuote&&viaCargoQuote.destinationCp===cp&&String(viaCargoQuote.locality||'')===locality&&String(viaCargoQuote.province||'')===province&&Number(viaCargoQuote.quantity)===Number(total)\n    if(quoteStillMatches)return\n    setViaCargoQuote(null);setViaCargoQuoteError('')",'limpieza de cotización obsoleta')
fs.writeFileSync(customerFile,customer)

const motorFile='src/pages/MotorDefinitivo.jsx'
const motor=fs.readFileSync(motorFile,'utf8')
if(motor.includes('pendingCutByDelivery'))throw new Error('v25.0.61 predeploy: el Motor conserva el cálculo viejo de pendientes')
if((motor.match(/pendingCutPlan\(db\)/g)||[]).length!==1)throw new Error('v25.0.61 predeploy: el Motor no consume exactamente una vez el plan único de corte')

const cutFile='src/pages/CutList.jsx'
const cut=fs.readFileSync(cutFile,'utf8')
if(!cut.includes('pendingCutPlan'))throw new Error('v25.0.61 predeploy: Para cortar no usa pendingCutPlan')
if(cut.includes('pendingCutByDelivery'))throw new Error('v25.0.61 predeploy: Para cortar conserva el cálculo viejo')

if(customer.includes('viacargo-quote-probe2.onrender.com/quote'))throw new Error('v25.0.61 predeploy: el cliente todavía apunta al endpoint viejo de Via Cargo')
if(!customer.includes('viacargo-quote-probe2.onrender.com/api/cotizar'))throw new Error('v25.0.61 predeploy: falta endpoint /api/cotizar de Via Cargo')
if(!customer.includes("data.method==='Logística GBA/CABA'&&!logisticsQuote"))throw new Error('v25.0.61 predeploy: falta bloqueo de zonas de logística desconocidas')

const viaCargoSource=fs.readFileSync('viacargo-api/src/viacargo.js','utf8')
for(const required of ['parseOfficialDestination','verifyDestination','verifyOrigin','CACHE_MAX_KEYS']){
  if(!viaCargoSource.includes(required))throw new Error('v25.0.61 predeploy: falta hardening Via Cargo: '+required)
}
const viaCargoRender=fs.readFileSync('viacargo-api/render.yaml','utf8')
if(/CORS_ORIGIN[\s\S]{0,80}value:\s*['\"]?\*/.test(viaCargoRender))throw new Error('v25.0.61 predeploy: CORS de Via Cargo volvió a quedar abierto')

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.61'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.61'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · producción unificada + Vía Cargo seguro'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.61'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.61'"))
console.log('v25.0.61 PREDEPLOY OK · build único V2 · Motor/Para cortar unificados · Via Cargo sin respuestas viejas')
