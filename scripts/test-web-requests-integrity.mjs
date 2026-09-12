import fs from 'node:fs'

const pagePath='src/pages/WebRequests.jsx'
const groupedPath='src/pages/WebRequestsGrouped.jsx'

function fail(message){
  console.error(`WEB REQUESTS INTEGRITY ERROR: ${message}`)
  process.exit(1)
}

for(const path of [pagePath,groupedPath]){
  if(!fs.existsSync(path)) fail(`falta ${path}`)
}

const page=fs.readFileSync(pagePath,'utf8')
const grouped=fs.readFileSync(groupedPath,'utf8')

if(/^\s*(PLACEHOLDER\w*|TODO|TBD)\s*;?\s*$/i.test(page)) fail('WebRequests.jsx quedó reemplazado por un placeholder')
if(page.length<1200) fail('WebRequests.jsx parece incompleto o truncado')
if(!page.includes("from('web_requests')")) fail('WebRequests.jsx ya no consulta la tabla web_requests')
if(!page.includes("'Pendiente de pago'")||!page.includes("'Presupuesto enviado'")) fail('se perdió la lógica de solicitudes pendientes')
if(!page.includes("order('created_at',{ascending:false})")) fail('se perdió el orden cronológico de solicitudes')
if(!grouped.includes("import WebRequests from './WebRequests'")) fail('WebRequestsGrouped dejó de renderizar WebRequests')
if(!grouped.includes('<WebRequests')) fail('WebRequestsGrouped no monta la pantalla de solicitudes')

console.log('Web requests integrity: OK')
