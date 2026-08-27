import React,{useMemo,useState} from 'react'
import {Title,Badge} from '../components/UI'
import {money} from '../lib/format'
import {todayArgentinaISO,orderPieces} from '../lib/production'
import {dispatchGroups,productionColumns,packagingNeeds,workload,normalizeDeliveryType} from '../lib/operations'
import {estimatedOrderProfit} from '../lib/finance'
import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'

const statusOrder=['Pendiente','Corte','Pegado','Embalaje','Listo']
const addDays=(iso,days)=>{const [y,m,d]=String(iso).split('-').map(Number);const x=new Date(y,m-1,d+days);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`}
function completeSvgModels(db){
 const groups=new Map();(db.svgLibrary||[]).forEach(x=>{const key=normalizeFigureKey(x.productName||x.modelName||x.name);if(!key)return;if(!groups.has(key))groups.set(key,new Set());groups.get(key).add(x.role||'simple')})
 const ready=new Set();groups.forEach((roles,key)=>{if(roles.has('simple')||(roles.has('base')&&roles.has('tapa')))ready.add(key)});return ready
}
export default function OperationsHub({db,onSave,go}){
 const [date,setDate]=useState(todayArgentinaISO())
 const groups=useMemo(()=>dispatchGroups(db,date),[db,date])
 const columns=useMemo(()=>productionColumns(db),[db])
 const boxes=useMemo(()=>packagingNeeds(db,{from:date,days:7}),[db,date])
 const load=useMemo(()=>workload(db),[db])
 const pending=useMemo(()=>pendingCutByDelivery(db),[db])
 const svgReady=useMemo(()=>completeSvgModels(db),[db.svgLibrary])
 const dayOrders=(db.orders||[]).filter(o=>o.delivery===date&&o.status!=='Cancelado')
 const dayPieces=dayOrders.reduce((s,o)=>s+orderPieces(o),0)
 const dayRevenue=dayOrders.reduce((s,o)=>s+Number(o.total||0),0)
 const dayProfit=dayOrders.reduce((s,o)=>s+estimatedOrderProfit(o,db.costSettings).total,0)
 const packagingStock=db.packagingStock||{}
 const priorities=useMemo(()=>{
   const today=todayArgentinaISO(),tomorrow=addDays(today,1)
   const active=(db.orders||[]).filter(o=>!['Cancelado','Entregado'].includes(o.status))
   const overdue=active.filter(o=>o.delivery&&o.delivery<today)
   const dueSoon=active.filter(o=>o.delivery===today||o.delivery===tomorrow)
   const pendingPieces=pending.reduce((n,g)=>n+g.rows.reduce((s,r)=>s+Number(r.qty||0),0),0)
   const missingSvg=[...new Set(pending.flatMap(g=>g.rows.map(r=>r.figure)).filter(name=>!svgReady.has(normalizeFigureKey(name))))]
   const boxesToBuy=boxes.reduce((n,row)=>n+Math.max(0,Number(row.qty||0)-Number(packagingStock[row.name]||0)),0)
   return [
    overdue.length&&{level:'danger',icon:'!',title:`${overdue.length} pedido${overdue.length===1?'':'s'} vencido${overdue.length===1?'':'s'}`,detail:'La fecha de salida ya pasó y todavía no figura entregado.',route:'orders'},
    dueSoon.length&&{level:'warn',icon:'↗',title:`${dueSoon.length} pedido${dueSoon.length===1?'':'s'} sale${dueSoon.length===1?'':'n'} hoy o mañana`,detail:`${dueSoon.reduce((s,o)=>s+orderPieces(o),0)} piezas requieren seguimiento cercano.`,route:'calendar'},
    pendingPieces>0&&{level:'work',icon:'✂',title:`${pendingPieces} piezas faltan producir`,detail:`Distribuidas en ${pending.length} fecha${pending.length===1?'':'s'} de entrega.`,route:'cut'},
    missingSvg.length&&{level:'danger',icon:'⌁',title:`${missingSvg.length} modelo${missingSvg.length===1?'':'s'} sin SVG completo`,detail:missingSvg.slice(0,4).join(' · ')+(missingSvg.length>4?'…':''),route:'svglibrary'},
    boxesToBuy>0&&{level:'warn',icon:'□',title:`Comprar ${boxesToBuy} caja${boxesToBuy===1?'':'s'}`,detail:'Faltante estimado para los próximos 7 días.',route:'operations'}
   ].filter(Boolean).slice(0,5)
 },[db.orders,pending,svgReady,boxes,packagingStock])
 async function setStage(order,stage){
   const map={Pendiente:'Ingresado',Corte:'En corte',Pegado:'Pegado',Embalaje:'Embalando',Listo:'Listo'}
   const orders=(db.orders||[]).map(o=>o.id===order.id?{...o,status:map[stage],updatedAt:new Date().toISOString()}:o)
   await onSave({...db,orders})
 }
 async function setBoxStock(name,value){await onSave({...db,packagingStock:{...packagingStock,[name]:Math.max(0,Number(value)||0)}})}
 return <><Title title="Centro operativo" sub="Producción, prioridades, embalaje y despachos en una sola pantalla." actions={<div className="actions"><button className="ghost" onClick={()=>go?.('orders')}>Ver pedidos</button><button className="primary" onClick={()=>go?.('new')}>＋ Nuevo pedido</button></div>}/>
 <section className="ops-priority panel"><div className="panel-heading"><div><small className="section-kicker">AHORA</small><h3>Qué necesita tu atención</h3></div><span className="ops-priority-count">{priorities.length||'✓'}</span></div><div className="ops-priority-grid">{priorities.map((p,i)=><button key={i} className={`ops-priority-card ${p.level}`} onClick={()=>go?.(p.route)}><span className="ops-priority-icon">{p.icon}</span><span><b>{p.title}</b><small>{p.detail}</small></span><em>→</em></button>)}{!priorities.length&&<div className="ops-all-clear"><b>Todo bajo control</b><small>No detecto urgencias operativas con los datos actuales.</small></div>}</div></section>
 <section className="ops-daybar panel"><label><b>Día de trabajo</b><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><div><small>Pedidos</small><b>{dayOrders.length}</b></div><div><small>Piezas</small><b>{dayPieces}</b></div><div><small>Venta</small><b>{money(dayRevenue)}</b></div><div><small>Ganancia estimada</small><b>{money(dayProfit)}</b></div></section>
 <div className="cards"><div className="kpi"><small>Trabajo pendiente</small><b>{load.pieces} piezas</b><span>{load.hours} h estimadas</span></div><div className="kpi"><small>Corte estimado</small><b>{load.cutMinutes} min/fig.</b></div><div className="kpi"><small>Pegado estimado</small><b>{load.glueMinutes} min/fig.</b></div><div className="kpi"><small>Embalaje estimado</small><b>{load.packMinutes} min/pedido</b></div></div>
 <section className="panel"><div className="panel-heading"><div><h3>Despachos del día</h3><small>Agrupados automáticamente por transporte.</small></div><button className="ghost" onClick={()=>window.print()}>Imprimir vista</button></div><div className="dispatch-grid">{Object.entries(groups).map(([type,orders])=><div className="dispatch-card" key={type}><h4>{type}</h4><b>{orders.length} pedido{orders.length===1?'':'s'}</b>{orders.map(o=><div className="dispatch-order" key={o.id}><span><b>#{o.number} · {o.client}</b><small>{orderPieces(o)} piezas · {o.locality||o.province||''}</small></span><Badge status={o.status}/></div>)}</div>)}{!Object.keys(groups).length&&<div className="dash-empty"><b>No hay despachos para esta fecha.</b></div>}</div></section>
 <section className="panel"><h3>Flujo de producción</h3><small>Podés mover un pedido de etapa desde cada tarjeta.</small><div className="kanban-board">{statusOrder.map(stage=><div className="kanban-col" key={stage}><div className="kanban-head"><b>{stage}</b><span>{columns[stage].length}</span></div>{columns[stage].slice(0,30).map(o=><article className="kanban-card" key={o.id}><b>#{o.number} · {o.client}</b><small>{orderPieces(o)} piezas · {o.delivery||'Sin fecha'}</small><small>{normalizeDeliveryType(o)}</small><select value={stage} onChange={e=>setStage(o,e.target.value)}>{statusOrder.map(x=><option key={x}>{x}</option>)}</select></article>)}</div>)}</div></section>
 <section className="panel"><h3>Cajas necesarias para los próximos 7 días</h3><div className="table-wrap"><table><thead><tr><th>Embalaje</th><th>Necesitás</th><th>Stock</th><th>Comprar</th></tr></thead><tbody>{boxes.map(row=>{const stock=Number(packagingStock[row.name]||0),buy=Math.max(0,row.qty-stock);return <tr key={row.name}><td><b>{row.name}</b></td><td>{row.qty}</td><td><input className="stock-inline-input" type="number" min="0" value={stock} onChange={e=>setBoxStock(row.name,e.target.value)}/></td><td className={buy?'red-text':'green-text'}><b>{buy}</b></td></tr>})}{!boxes.length&&<tr><td colSpan="4">No hay cajas previstas para los próximos días.</td></tr>}</tbody></table></div></section>
 </>
}
