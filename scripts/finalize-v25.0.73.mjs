import './finalize-v25.0.71.mjs'
import fs from 'node:fs'

const quoteFile='src/lib/quoteReceipt.js'
let quote=fs.readFileSync(quoteFile,'utf8')
quote=quote.replace("const unitPrice=i=>Number(i.unitPrice??i.price??0)||0","const unitPrice=i=>{const raw=Number(i.unitPrice??i.price);return Number.isFinite(raw)&&raw>0?raw:null}")
quote=quote.replace("    const qty=Number(i.qty||0), unit=unitPrice(i)\n    return `<tr><td>${esc(i.figure||i.name)}</td><td>${esc(i.measure||'')}</td><td>${qty}</td><td>${money(unit)}</td><td>${money(qty*unit)}</td></tr>`","    const qty=Number(i.qty||0), unit=unitPrice(i)\n    return `<tr><td>${esc(i.figure||i.name)}</td><td>${esc(i.measure||'')}</td><td>${qty}</td><td>${unit===null?'—':money(unit)}</td><td>${unit===null?'—':money(qty*unit)}</td></tr>`")
quote=quote.replace("  const shipping=Math.max(0,Number(q.shippingCost||q.deliveryCost||q.shipping||0)||0)\n  return `<div class=\"quote-receipt\">","  const shipping=Math.max(0,Number(q.shippingCost||q.deliveryCost||q.shipping||0)||0)\n  const productsTotal=Math.max(0,Number(q.productsTotal??(Number(q.total||0)-shipping))||0)\n  return `<div class=\"quote-receipt\">")
quote=quote.replace("<section class=\"quote-total\"><span>TOTAL PRODUCTOS</span><b>${money(q.total)}</b></section>","<section class=\"quote-total\"><span>TOTAL PRODUCTOS</span><b>${money(productsTotal)}</b></section>")
if(!quote.includes("money(productsTotal)"))throw new Error('v25.0.73: no quedó total de productos separado del envío')
if(!quote.includes("unit===null?'—':money(unit)"))throw new Error('v25.0.73: no quedó precio faltante sin falso $0')
fs.writeFileSync(quoteFile,quote)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.73'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.73'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Presupuesto final corregido + V2 candidata oficial'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.73'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.73'"))

console.log('v25.0.73 FINALIZE OK · presupuesto separa productos/envío y elimina $0 falsos')
