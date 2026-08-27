import React,{useMemo,useState} from 'react'
import {money} from '../lib/format'
import {orderPieces,todayArgentinaISO,DAILY_PIECE_LIMIT,sheetsForPieces} from '../lib/production'
import {stockRows,isOrderCommitted} from '../lib/inventory'
import {productionColumns,packagingNeeds} from '../lib/operations'

const stages=[['Pendiente','01'],['Corte','02'],['Pegado','03'],['Embalaje','04'],['Listo','05']]
const stageTone={Pendiente:'slate',Corte:'cyan',Pegado:'violet',Embalaje:'amber',Listo:'green'}
const name=o=>o.client||[o.firstName,o.lastName].filter(Boolean).join(' ')||'Sin nombre'

export default function DashboardV4({db,go}){
  const [q,setQ]=useState('')
  const today=todayArgentinaISO(),orders=db.orders||[]
  const active=orders.filter(o=>isOrderCommitted(o,today))
  const todayOrders=orders.filter(o=>o.delivery===today&&o.status!=='Cancelado')
  const todayPieces=todayOrders.reduce((s,o)=>s+orderPieces(o),0)
  const activePieces=active.reduce((s,o)=>s+orderPieces(o),0)
  const overdue=orders.filter(o=>o.delivery&&o.delivery<today&&!['Cancelado','Entregado'].includes(o.status))
  const stockAlerts=stockRows(db).filter(r=>r.total<=r.min)
  const cols=productionColumns(db)
  const free=Math.max(0,DAILY_PIECE_LIMIT-todayPieces)
  const load=Math.min(100,Math.round(todayPieces/DAILY_PIECE_LIMIT*100))
  const month=today.slice(0,7)
  const monthOrders=orders.filter(o=>String(o.date||o.createdAt||'').slice(0,7)===month&&o.status!=='Cancelado')
  const revenue=monthOrders.reduce((s,o)=>s+Number(o.total||0),0)
  const boxes=packagingNeeds(db,{from:today,days:7}),packagingStock=db.packagingStock||{}
  const boxesToBuy=boxes.reduce((s,row)=>s+Math.max(0,row.qty-Number(packagingStock[row.name]||0)),0)

  const upcoming=useMemo(()=>orders.filter(o=>o.delivery&&o.delivery>=today&&o.status!=='Cancelado').sort((a,b)=>String(a.delivery).localeCompare(String(b.delivery))).slice(0,7),[orders,today])
  const hits=useMemo(()=>{const term=q.trim().toLowerCase();if(term.length<2)return[];return orders.filter(o=>[o.number,name(o),o.phone,o.dni,o.locality,...(o.items||[]).map(i=>i.figure)].filter(Boolean).join(' ').toLowerCase().includes(term)).slice(0,6)},[q,orders])
  const priorities=useMemo(()=>{
    const list=[]
    if(overdue.length)list.push({tone:'red',kicker:'URGENTE',title:`${overdue.length} entrega${overdue.length===1?'':'s'} vencida${overdue.length===1?'':'s'}`,text:'Resolver antes de seguir sumando trabajo.',page:'orders',cta:'Abrir pedidos'})
    const pending=cols.Pendiente?.length||0
    if(pending)list.push({tone:'violet',kicker:'PRODUCCIÓN',title:`${pending} pedido${pending===1?'':'s'} esperan corte`,text:'Son la siguiente cola operativa.',page:'cut',cta:'Preparar corte'})
    if(stockAlerts.length)list.push({tone:'amber',kicker:'INVENTARIO',title:`${stockAlerts.length} alerta${stockAlerts.length===1?'':'s'} de stock`,text:'Hay piezas por debajo del mínimo.',page:'stock',cta:'Revisar stock'})
    if(boxesToBuy)list.push({tone:'cyan',kicker:'DESPACHOS',title:`Faltan ${boxesToBuy} caja${boxesToBuy===1?'':'s'}`,text:'Estimación para los próximos 7 días.',page:'operations',cta:'Ver embalaje'})
    if(!list.length)list.push({tone:'green',kicker:'TODO EN ORDEN',title:'Operación sin bloqueos',text:'No detecté urgencias en este momento.',page:'operations',cta:'Ver centro operativo'})
    return list.slice(0,4)
  },[overdue,cols,stockAlerts,boxesToBuy])

  const ringStyle={background:`conic-gradient(#6d4aff ${load*3.6}deg,#e9e7f6 0deg)`}

  return <div className="studio-dashboard">
    <section className="studio-topline">
      <div><span>POLIFAN / CONTROL ROOM</span><h1>Hoy, de un vistazo.</h1><p>Producción, entregas y decisiones importantes sin recorrer toda la app.</p></div>
      <div className="studio-top-actions"><button onClick={()=>go('operations')}>Centro operativo</button><button className="accent" onClick={()=>go('new')}>＋ Nuevo pedido</button></div>
    </section>

    <section className="studio-command">
      <div className="studio-search"><span>⌕</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar cliente, pedido, figura, DNI o teléfono"/>{q&&<button onClick={()=>setQ('')}>×</button>}{hits.length>0&&<div className="studio-results">{hits.map(o=><button key={o.id} onClick={()=>go('orders')}><b>#{o.number} · {name(o)}</b><small>{orderPieces(o)} piezas · {o.delivery||'sin fecha'} · {o.status||'Ingresado'}</small></button>)}</div>}</div>
      <div className="studio-live"><i/><span>Sistema en vivo</span><b>{active.length} pedidos activos</b></div>
    </section>

    <section className="studio-grid-main">
      <article className="studio-capacity">
        <div className="studio-card-label"><span>CAPACIDAD DE HOY</span><button onClick={()=>go('calendar')}>Calendario ↗</button></div>
        <div className="studio-capacity-body">
          <div className="studio-ring" style={ringStyle}><div><strong>{load}%</strong><span>ocupado</span></div></div>
          <div className="studio-capacity-copy"><strong>{todayPieces}<em> / {DAILY_PIECE_LIMIT}</em></strong><p>piezas programadas</p><div><span><b>{free}</b> libres</span><span><b>{sheetsForPieces(todayPieces)}</b> planchas aprox.</span></div></div>
        </div>
      </article>

      <article className="studio-priority">
        <div className="studio-card-label"><span>PRIORIDADES</span><button onClick={()=>go('operations')}>Ver todo ↗</button></div>
        <div className="studio-priority-list">{priorities.map((x,i)=><button key={x.title} className={x.tone} onClick={()=>go(x.page)}><span className="num">0{i+1}</span><span><small>{x.kicker}</small><b>{x.title}</b><em>{x.text}</em></span><strong>{x.cta} →</strong></button>)}</div>
      </article>
    </section>

    <section className="studio-metrics">
      <button onClick={()=>go('orders')}><small>PEDIDOS ACTIVOS</small><strong>{active.length}</strong><span>{activePieces} piezas comprometidas</span></button>
      <button onClick={()=>go('monthly')}><small>FACTURACIÓN MES</small><strong>{money(revenue)}</strong><span>{monthOrders.length} pedidos</span></button>
      <button className={overdue.length?'danger':''} onClick={()=>go('orders')}><small>RIESGO DE ENTREGA</small><strong>{overdue.length}</strong><span>{overdue.length?'requieren atención':'sin vencidos'}</span></button>
      <button onClick={()=>go('stock')}><small>INVENTARIO</small><strong>{stockAlerts.length}</strong><span>{stockAlerts.length?'alertas activas':'sin alertas'}</span></button>
    </section>

    <section className="studio-grid-lower">
      <article className="studio-flow">
        <div className="studio-card-label"><span>FLUJO DE PRODUCCIÓN</span><button onClick={()=>go('operations')}>Gestionar ↗</button></div>
        <div className="studio-stage-track">{stages.map(([stage,n],idx)=><React.Fragment key={stage}><button onClick={()=>go(stage==='Pendiente'?'cut':'operations')}><small>{n}</small><i className={stageTone[stage]}/><b>{stage}</b><strong>{cols[stage]?.length||0}</strong></button>{idx<stages.length-1&&<span className="connector"/>}</React.Fragment>)}</div>
      </article>

      <article className="studio-agenda">
        <div className="studio-card-label"><span>PRÓXIMAS ENTREGAS</span><button onClick={()=>go('orders')}>Todas ↗</button></div>
        <div className="studio-agenda-list">{upcoming.map(o=><button key={o.id} onClick={()=>go('orders')}><time><b>{String(o.delivery).slice(8,10)}</b><span>{new Date(`${o.delivery}T12:00:00`).toLocaleDateString('es-AR',{month:'short'}).replace('.','')}</span></time><span><b>#{o.number} · {name(o)}</b><small>{orderPieces(o)} piezas · {o.deliveryType||o.carrier||'Logística'}</small></span><em>{o.status||'Ingresado'}</em></button>)}{!upcoming.length&&<div className="studio-empty">No hay próximas entregas.</div>}</div>
      </article>
    </section>

    <section className="studio-launchpad">
      <span>ACCESOS RÁPIDOS</span>
      <div><button onClick={()=>go('cut')}><i>✂</i><b>Para cortar</b><small>Preparar producción</small></button><button onClick={()=>go('sheetplanner')}><i>◎</i><b>Generar placas</b><small>Motor de anidado</small></button><button onClick={()=>go('webrequests')}><i>↙</i><b>Solicitudes web</b><small>Nuevos ingresos</small></button><button onClick={()=>go('stock')}><i>◇</i><b>Inventario</b><small>Control de piezas</small></button></div>
    </section>
  </div>
}
