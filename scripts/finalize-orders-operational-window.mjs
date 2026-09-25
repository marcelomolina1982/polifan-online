import fs from 'node:fs'

const path='src/pages/Orders.jsx'
let s=fs.readFileSync(path,'utf8')
const replace=(from,to,label)=>{
  if(!s.includes(from)) throw new Error(`ORDERS WINDOW: no se encontró ${label}`)
  s=s.replace(from,to)
}

replace(
"  const activeCount=useMemo(()=>db.orders.filter(o=>!['Entregado','Cancelado'].includes(o.status)).length,[db.orders])\n  const historyCount=useMemo(()=>db.orders.filter(o=>['Entregado','Cancelado'].includes(o.status)).length,[db.orders])",
"  const todayKey=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}\n  const isClosed=o=>['Entregado','Cancelado'].includes(o.status)\n  const isPastDelivery=o=>Boolean(o.delivery)&&String(o.delivery)<todayKey()\n  const isOperational=o=>!isClosed(o)&&!isPastDelivery(o)\n  const isHistorical=o=>isClosed(o)||isPastDelivery(o)\n  const activeCount=useMemo(()=>db.orders.filter(isOperational).length,[db.orders])\n  const historyCount=useMemo(()=>db.orders.filter(isHistorical).length,[db.orders])",
'conteos activos/historial')

replace(
"      const closed=['Entregado','Cancelado'].includes(o.status)\n      const sectionMatch=view==='history'?closed:!closed",
"      const sectionMatch=view==='history'?isHistorical(o):isOperational(o)",
'filtro por sección')

replace(
"    <Title title=\"Pedidos\" sub={view==='active'?'Pedidos activos: permanecen aquí hasta Entregado o Cancelado.':'Historial de pedidos Entregados y Cancelados.'}/>",
"    <Title title=\"Pedidos\" sub={view==='active'?'Pedidos operativos de hoy en adelante, ordenados por fecha de salida.':'Historial: pedidos vencidos, Entregados y Cancelados.'}/>",
'subtítulo')

replace(
"<small>{view==='active'?'Se muestran los pedidos activos, incluso si pasó su fecha prevista, hasta Entregado o Cancelado.':'El historial conserva pedidos Entregados y Cancelados para consultar, imprimir o eliminar con confirmación.'}</small>",
"<small>{view==='active'?'Se muestran únicamente pedidos con salida de hoy en adelante. Los vencidos pasan automáticamente al Historial.':'El historial conserva pedidos vencidos, Entregados y Cancelados para consultar, imprimir o eliminar con confirmación.'}</small>",
'ayuda visual')

fs.writeFileSync(path,s)
console.log('ORDERS WINDOW OK · hoy/futuro en Pedidos; vencidos, Entregados y Cancelados en Historial')
