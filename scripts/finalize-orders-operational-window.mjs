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
