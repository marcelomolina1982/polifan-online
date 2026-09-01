import React,{useMemo,useState} from 'react'
import {money} from '../lib/format'
import {orderPieces,todayArgentinaISO,DAILY_PIECE_LIMIT,sheetsForPieces} from '../lib/production'
import {stockRows,isOrderCommitted} from '../lib/inventory'
import {productionColumns,packagingNeeds} from '../lib/operations'

const stageOrder=['Pendiente','Corte','Pegado','Embalaje','Listo']
const stageClass={Pendiente:'neutral',Corte:'blue',Pegado:'purple',Embalaje:'amber',Listo:'green'}

function clientName(o){return o.client||[o.firstName,o.lastName].filter(Boolean).join(' ')||'Sin nombre'}
function statusClass(status=''){const s=String(status).toLowerCase();if(s.includes('entreg')||s.includes('listo'))return'green';if(s.includes('corte'))return'blue';if(s.includes('peg'))return'purple';if(s.includes('embal'))return'amber';if(s.includes('cancel'))return'muted';return'neutral'}

export default function DashboardV3({db,go}){
  const [query,setQuery]=useState('')
  const today=todayArgentinaISO()
  const orders=db.orders||[]
  const active=orders.filter(o=>isOrderCommitted(o,today))
  const todayOrders=orders.filter(o=>o.delivery===today&&o.status!=='Cancelado')
  const todayPieces=todayOrders.reduce((s,o)=>s+orderPieces(o),0)
  const activePieces=active.reduce((s,o)=>s+orderPieces(o),0)
  const overdue=orders.filter(o=>o.delivery&&o.delivery<today&&!['Cancelado','Entregado'].includes(o.status))
  const lowStock=stockRows(db).filter(r=>r.total<=r.min)
  const stages=productionColumns(db)
  const free=Math.max(0,DAILY_PIECE_LIMIT-todayPieces)
  const load=Math.min(100,Math.round(todayPieces/DAILY_PIECE_LIMIT*100))
  const boxes=packagingNeeds(db,{from:today,days:7})
  const packagingStock=db.packagingStock||{}
  const boxesToBuy=boxes.reduce((s,row)=>s+Math.max(0,row.qty-Number(packagingStock[row.name]||0)),0)
  const month=today.slice(0,7)
  const monthOrders=orders.filter(o=>String(o.date||o.createdAt||'').slice(0,7)===month&&o.status!=='Cancelado')
  const revenue=monthOrders.reduce((s,o)=>s+Number(o.total||0),0)

  const upcoming=useMemo(()=>orders.filter(o=>o.delivery&&o.delivery>=today&&o.status!=='Cancelado').sort((a,b)=>String(a.delivery).localeCompare(String(b.delivery))).slice(0,8),[orders,today])
  const searchResults=useMemo(()=>{
    const q=query.trim().toLocaleLowerCase('es')
    if(q.length<2)return[]
    return orders.filter(o=>[o.number,clientName(o),o.phone,o.dni,o.locality,...(o.items||[]).map(i=>i.figure)].filter(Boolean).join(' ').toLocaleLowerCase('es').includes(q)).slice(0,7)
  },[query,orders])

  const queue=useMemo(()=>{
    const items=[]
    if(overdue.length)items.push({tone:'danger',title:`Resolver ${overdue.length} entrega${overdue.length===1?'':'s'} vencida${overdue.length===1?'':'s'}`,text:'Tienen fecha anterior a hoy y todavía no figuran entregadas.',action:'Ver pedidos',page:'orders'})
    const pending=stages.Pendiente?.length||0
    if(pending)items.push({tone:'primary',title:`Preparar ${pending} pedido${pending===1?'':'s'} para corte`,text:'Son pedidos confirmados que todavía no avanzaron de etapa.',action:'Ir a para cortar',page:'cut'})
    if(lowStock.length)items.push({tone:'warning',title:`Revisar ${lowStock.length} alerta${lowStock.length===1?'':'s'} de inventario`,text:'Hay piezas o insumos en mínimo o por debajo del mínimo.',action:'Abrir inventario',page:'stock'})
    if(boxesToBuy)items.push({tone:'warning',title:`Comprar ${boxesToBuy} caja${boxesToBuy===1?'':'s'} para despachos`,text:'Faltante estimado para cubrir los próximos siete días.',action:'Gestionar embalaje',page:'operations'})
    if(!items.length)items.push({tone:'success',title:'Operación al día',text:'No hay bloqueantes detectados. Podés seguir con el plan previsto.',action:'Ver centro operativo',page:'operations'})
    return items.slice(0,4)
  },[overdue,stages,lowStock,boxesToBuy])

  const nextOrder=upcoming[0]

  return <div className="ops-dashboard">
    <section className="ops-hero">
      <div className="ops-hero-copy"><span className="ops-eyebrow">CENTRO DE PRODUCCIÓN · V2</span><h1>Control operativo</h1><p>Lo urgente, la capacidad y el próximo trabajo en una sola pantalla.</p></div>
      <div className="ops-hero-actions"><button className="ops-btn ghost" onClick={()=>go('operations')}>Centro operativo</button><button className="ops-btn dark" onClick={()=>go('new')}>＋ Nuevo pedido</button></div>
    </section>

    <section className="ops-commandbar">
      <div className="ops-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar pedido, cliente, DNI, teléfono o figura…"/>{query&&<button onClick={()=>setQuery('')}>×</button>}</div>
      <button className="ops-quick" onClick={()=>go('cut')}><b>{activePieces}</b><span>piezas activas</span></button>
      <button className="ops-quick" onClick={()=>go('calendar')}><b>{free}</b><span>lugares libres hoy</span></button>
      {searchResults.length>0&&<div className="ops-search-popover">{searchResults.map(o=><button key={o.id} onClick={()=>go('orders')}><span><b>#{o.number} · {clientName(o)}</b><small>{orderPieces(o)} piezas · {o.delivery||'sin fecha'}</small></span><em className={`ops-badge ${statusClass(o.status)}`}>{o.status||'Ingresado'}</em></button>)}</div>}
    </section>

    <section className="ops-kpis">
      <button onClick={()=>go('calendar')}><small>CAPACIDAD HOY</small><strong>{todayPieces}<i>/ {DAILY_PIECE_LIMIT}</i></strong><span>{load}% ocupado · {sheetsForPieces(todayPieces)} planchas aprox.</span><div className="ops-progress"><i style={{width:`${load}%`}}/></div></button>
      <button onClick={()=>go('orders')}><small>PEDIDOS ACTIVOS</small><strong>{active.length}</strong><span>{activePieces} piezas comprometidas</span></button>
      <button onClick={()=>go('monthly')}><small>FACTURACIÓN MES</small><strong>{money(revenue)}</strong><span>{monthOrders.length} pedidos</span></button>
      <button className={overdue.length?'danger':''} onClick={()=>go('orders')}><small>RIESGO DE ENTREGA</small><strong>{overdue.length}</strong><span>{overdue.length?'requieren atención':'sin vencidos'}</span></button>
    </section>

    <section className="ops-main-grid">
      <article className="ops-panel ops-focus">
        <header><div><small>COLA DE TRABAJO</small><h2>Qué hacer ahora</h2></div><button onClick={()=>go('operations')}>Ver operación completa ›</button></header>
        <div className="ops-queue">{queue.map((item,i)=><div key={`${item.title}-${i}`} className={`ops-queue-item ${item.tone}`}><div className="ops-queue-index">{i+1}</div><div><b>{item.title}</b><p>{item.text}</p></div><button onClick={()=>go(item.page)}>{item.action} ›</button></div>)}</div>
      </article>

      <article className="ops-panel ops-stage-panel">
        <header><div><small>PRODUCCIÓN</small><h2>Etapas</h2></div><button onClick={()=>go('operations')}>Gestionar ›</button></header>
        <div className="ops-stages">{stageOrder.map(stage=><button key={stage} onClick={()=>go(stage==='Pendiente'?'cut':'operations')}><span><i className={stageClass[stage]}/>{stage}</span><b>{stages[stage]?.length||0}</b></button>)}</div>
        <div className="ops-stage-total"><span>Pedidos activos</span><b>{active.length}</b></div>
      </article>
    </section>

    <section className="ops-lower-grid">
      <article className="ops-panel">
        <header><div><small>AGENDA</small><h2>Próximas entregas</h2></div><button onClick={()=>go('orders')}>Ver todas ›</button></header>
        <div className="ops-deliveries">{upcoming.map(o=><button key={o.id} onClick={()=>go('orders')}><time><b>{String(o.delivery).slice(8,10)}</b><small>{new Date(`${o.delivery}T12:00:00`).toLocaleDateString('es-AR',{month:'short'}).replace('.','')}</small></time><span><b>#{o.number} · {clientName(o)}</b><small>{orderPieces(o)} piezas · {o.deliveryType||o.carrier||'Logística'}</small></span><em className={`ops-badge ${statusClass(o.status)}`}>{o.status||'Ingresado'}</em></button>)}{!upcoming.length&&<div className="ops-empty">No hay próximas entregas cargadas.</div>}</div>
      </article>

      <article className="ops-panel ops-next">
        <header><div><small>SIGUIENTE ENTREGA</small><h2>{nextOrder?`#${nextOrder.number} · ${clientName(nextOrder)}`:'Sin entregas próximas'}</h2></div></header>
        {nextOrder?<><div className="ops-next-date"><b>{nextOrder.delivery}</b><span>{orderPieces(nextOrder)} piezas</span></div><div className="ops-next-meta"><span>Estado <b>{nextOrder.status||'Ingresado'}</b></span><span>Entrega <b>{nextOrder.deliveryType||nextOrder.carrier||'Logística'}</b></span></div><button className="ops-btn dark wide" onClick={()=>go('orders')}>Abrir pedidos</button></>:<div className="ops-empty">La agenda está libre.</div>}
      </article>
    </section>

    <section className="ops-shortcuts"><button onClick={()=>go('cut')}><span>✂</span><b>Preparar corte</b><small>Priorizar producción</small></button><button onClick={()=>go('sheetplanner')}><span>▦</span><b>Generar placas</b><small>Motor de anidado</small></button><button onClick={()=>go('stock')}><span>◇</span><b>Inventario</b><small>{lowStock.length?`${lowStock.length} alertas`:'Sin alertas'}</small></button><button onClick={()=>go('webrequests')}><span>↙</span><b>Solicitudes web</b><small>Revisar ingresos</small></button></section>
  </div>
}
