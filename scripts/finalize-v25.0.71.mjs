import './finalize-v25.0.68.mjs'
import fs from 'node:fs'

function one(text,before,after,label){
  const count=text.split(before).length-1
  if(count===0){console.log(`finalize-v25.0.71: ${label} ya no usa el bloque histórico; se conserva la implementación actual`);return text}
  if(count!==1)throw new Error(`finalize-v25.0.71: ${label} aparece ${count} veces`)
  return text.replace(before,after)
}

const webFile='src/pages/WebRequests.jsx'
let web=fs.readFileSync(webFile,'utf8')

const patches=[
 ["const isPending=row=>['Pendiente de pago','Presupuesto enviado'].includes(row.status)\nconst norm=value=>","const isPending=row=>['Pendiente de pago','Presupuesto enviado'].includes(row.status)\nconst shippingPriceFor=row=>Math.max(0,Number(row?.customer?.shippingPrice??row?.customer?.shippingQuote?.price??0)||0)\nconst totalWithShippingFor=row=>Math.round(Number(row?.estimated_total||0)+shippingPriceFor(row))\nconst norm=value=>",'helpers de envío']
]
for(const [before,after,label] of patches)web=one(web,before,after,label)
fs.writeFileSync(webFile,web)
console.log('finalize-v25.0.71 compatible con flujo web actual')
