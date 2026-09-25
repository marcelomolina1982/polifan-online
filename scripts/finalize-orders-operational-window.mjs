import fs from 'node:fs'

const path='src/pages/Orders.jsx'
let s=fs.readFileSync(path,'utf8')

const todayHelpers=`  const todayKey=()=>{const d=new Date();return \`${'${d.getFullYear()}'}-${'${String(d.getMonth()+1).padStart(2,\'0\')}'}-${'${String(d.getDate()).padStart(2,\'0\')}'}\`}\n  const isClosed=o=>['Entregado','Cancelado'].includes(o.status)\n  const isPastDelivery=o=>Boolean(o.delivery)&&String(o.delivery)<todayKey()\n  const isOperational=o=>!isClosed(o)&&!isPastDelivery(o)\n  const isHistorical=o=>isClosed(o)||isPastDelivery(o)\n  const activeCount=useMemo(()=>db.orders.filter(isOperational).length,[db.orders])\n  const historyCount=useMemo(()=>db.orders.filter(isHistorical).length,[db.orders])`

const oldCounts="  const activeCount=useMemo(()=>db.orders.filter(o=>!['Entregado','Cancelado'].includes(o.status)).length,[db.orders])\n  const historyCount=useMemo(()=>db.orders.filter(o=>['Entregado','Cancelado'].includes(o.status)).length,[db.orders])"
if(s.includes(oldCounts)) s=s.replace(oldCounts,todayHelpers)
else if(!s.includes('const isOperational=o=>')) throw new Error('ORDERS WINDOW: no se encontraron los conteos esperados')

const oldSection="      const closed=['Entregado','Cancelado'].includes(o.status)\n      const sectionMatch=view==='history'?closed:!closed"
if(s.includes(oldSection)) s=s.replace(oldSection,"      const sectionMatch=view==='history'?isHistorical(o):isOperational(o)")
else if(!s.includes("view==='history'?isHistorical(o):isOperational(o)")) throw new Error('ORDERS WINDOW: no se encontró el filtro por sección')

s=s.replace(
  '<Title title="Pedidos" sub={view===\'active\'?\'Pedidos activos: permanecen aquí hasta Entregado o Cancelado.\':\'Historial de pedidos Entregados y Cancelados.\'}/>',
  '<Title title="Pedidos" sub={view===\'active\'?\'Pedidos operativos de hoy en adelante, ordenados por fecha de salida.\':\'Historial: pedidos vencidos, Entregados y Cancelados.\'}/>'
)
s=s.replace(
  "<small>{view==='active'?'Se muestran los pedidos activos, incluso si pasó su fecha prevista, hasta Entregado o Cancelado.':'El historial conserva pedidos Entregados y Cancelados para consultar, imprimir o eliminar con confirmación.'}</small>",
  "<small>{view==='active'?'Se muestran únicamente pedidos con salida de hoy en adelante. Los vencidos pasan automáticamente al Historial.':'El historial conserva pedidos vencidos, Entregados y Cancelados para consultar, imprimir o eliminar con confirmación.'}</small>"
)

fs.writeFileSync(path,s)
console.log('ORDERS WINDOW OK · hoy/futuro en Pedidos; vencidos, Entregados y Cancelados en Historial')

// Inventario: una placa Terminada no es una segunda fuente de stock.
// El stock físico sale exclusivamente de movimientos reales. Antes, el reparador
// reconstruía producción histórica de placas y podía volver a sumar piezas ya
// consumidas (ej.: Te Amo / Margarita), inflando "Cortadas" y ocultando faltantes.
const inventoryPath='src/lib/inventory.js'
let inv=fs.readFileSync(inventoryPath,'utf8')
const oldManual="export function manualBalance(db){const balance={};(db.movements||[]).forEach(m=>{if(!m.figure||['tapa','base'].includes(m.component))return;const q=Number(m.qty||0),positive=['Entrada extra','Ajuste positivo','Entrada de corte'].includes(m.type),negative=['Salida manual','Ajuste negativo'].includes(m.type);if(!positive&&!negative)return;balance[m.figure]=(balance[m.figure]||0)+(positive?q:-q)});Object.entries(missingFinishedBatchProduction(db).complete).forEach(([figure,qty])=>balance[figure]=(balance[figure]||0)+Number(qty||0));return balance}"
const newManual="export function manualBalance(db){const balance={};(db.movements||[]).forEach(m=>{if(!m.figure||['tapa','base'].includes(m.component))return;const q=Number(m.qty||0),positive=['Entrada extra','Ajuste positivo','Entrada de corte'].includes(m.type),negative=['Salida manual','Ajuste negativo'].includes(m.type);if(!positive&&!negative)return;balance[m.figure]=(balance[m.figure]||0)+(positive?q:-q)});return balance}"
if(inv.includes(oldManual)) inv=inv.replace(oldManual,newManual)
else if(!inv.includes(newManual)) throw new Error('INVENTORY HISTORY FIX: no se encontró manualBalance esperado')

const oldLoose="export function looseComponentBalance(db){const balance={};(db.movements||[]).forEach(m=>{if(!m.figure||!['tapa','base'].includes(m.component))return;const q=Number(m.qty||0),positive=['Entrada extra','Ajuste positivo','Entrada de corte','Ajuste componente positivo'].includes(m.type),negative=['Salida manual','Ajuste negativo','Ajuste componente negativo'].includes(m.type);if(!positive&&!negative)return;if(!balance[m.figure])balance[m.figure]={tapa:0,base:0};balance[m.figure][m.component]+=positive?q:-q});Object.entries(missingFinishedBatchProduction(db).components).forEach(([figure,parts])=>{if(!balance[figure])balance[figure]={tapa:0,base:0};balance[figure].tapa+=Number(parts?.tapa||0);balance[figure].base+=Number(parts?.base||0)});Object.values(balance).forEach(v=>{v.tapa=Math.max(0,Number(v.tapa||0));v.base=Math.max(0,Number(v.base||0))});return balance}"
const newLoose="export function looseComponentBalance(db){const balance={};(db.movements||[]).forEach(m=>{if(!m.figure||!['tapa','base'].includes(m.component))return;const q=Number(m.qty||0),positive=['Entrada extra','Ajuste positivo','Entrada de corte','Ajuste componente positivo'].includes(m.type),negative=['Salida manual','Ajuste negativo','Ajuste componente negativo'].includes(m.type);if(!positive&&!negative)return;if(!balance[m.figure])balance[m.figure]={tapa:0,base:0};balance[m.figure][m.component]+=positive?q:-q});Object.values(balance).forEach(v=>{v.tapa=Math.max(0,Number(v.tapa||0));v.base=Math.max(0,Number(v.base||0))});return balance}"
if(inv.includes(oldLoose)) inv=inv.replace(oldLoose,newLoose)
else if(!inv.includes(newLoose)) throw new Error('INVENTORY HISTORY FIX: no se encontró looseComponentBalance esperado')
fs.writeFileSync(inventoryPath,inv)

const testPath='scripts/test-inventory-production-flow.mjs'
let test=fs.readFileSync(testPath,'utf8')
test=test.replace("must(physicalStockBalance(db).Arcoiris===2,'un movimiento con batchId ajeno no debe atribuirse a otra placa sólo porque comparte número')","must(physicalStockBalance(db).Arcoiris===1,'una placa Terminada no debe reconstruirse como stock adicional: sólo cuentan movimientos reales')")
if(!test.includes("physicalStockBalance(db).Arcoiris===1,'una placa Terminada no debe reconstruirse")) throw new Error('INVENTORY HISTORY FIX: no se pudo actualizar la regresión')
fs.writeFileSync(testPath,test)
console.log('INVENTORY HISTORY FIX OK · placas históricas no se vuelven a sumar como stock físico')
