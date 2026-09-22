import fs from 'node:fs'

const orders=fs.readFileSync('src/pages/Orders.jsx','utf8')
const receipt=fs.readFileSync('src/lib/orderReceipt.js','utf8')
const journey=fs.readFileSync('src/lib/customerJourney.js','utf8')
const must=(ok,message)=>{if(!ok)throw new Error('ORDER COMMUNICATION GUARD: '+message)}

must(orders.includes("window.open('about:blank','_blank')"),'WhatsApp perdió apertura sincrónica anti-popup')
must(orders.includes("console.error('No se pudo recuperar el seguimiento; WhatsApp continúa.'"),'fallo de seguimiento vuelve a bloquear WhatsApp')
must(orders.includes("console.error('No se pudo descargar el comprobante; WhatsApp continúa.'"),'fallo de JPG vuelve a bloquear WhatsApp')
must(orders.includes("whatsappWindow.location.href=\`https://wa.me/"),'falta navegación final a WhatsApp')
must(!/catch\(error\)\{[\s\S]{0,250}whatsappWindow\.close\(\)/.test(orders),'un error vuelve a cerrar WhatsApp')
must(orders.includes("digits.length===10?\`549\${digits}\`"),'se perdió normalización móvil Argentina')
must(receipt.includes("a.download=\`comprobante-pedido-\${order.number}.jpg\`"),'se perdió descarga JPG')
must(journey.includes('trackingToken'),'mensaje de seguimiento perdió token')
console.log('ORDER COMMUNICATION GUARDS OK · WhatsApp, JPG y seguimiento desacoplados')
