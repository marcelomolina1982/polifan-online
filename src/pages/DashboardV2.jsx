import React,{useMemo,useState} from 'react'
import {money} from '../lib/format'
import {orderPieces,todayArgentinaISO,DAILY_PIECE_LIMIT,sheetsForPieces} from '../lib/production'
import {stockRows,isOrderCommitted} from '../lib/inventory'
import {packagingNeeds,productionColumns} from '../lib/operations'

const DAY_NAMES=['dom','lun','mar','mié','jue','vie','sáb']
const statusTone=status=>{
  const s=String(status||'').toLocaleLowerCase('es')
  if(s.includes('entreg'))return'ok'
  if(s.includes('cancel'))return'muted'
  if(s.includes('corte'))return'blue'
  if(s.includes('peg'))return'purple'
  if(s.includes('embal'))return'amber'
  return'neutral'
}

export default function DashboardV2({db,go}){
  const [query,setQuery]=useState('')
  const today=todayArgentinaISO(),orders=db.orders||[]
  const active=orders.filter(o=>isOrderCommitted(o,today))
  const todayOrders=orders.filter(o=>o.delivery===today&&o.status!=='Cancelado')
  const todayPieces=todayOrders.reduce((sum,o)=>sum+orderPieces(o),0)
  const activePieces=active.reduce((sum,o)=>sum+orderPieces(o),0)
  const overdue=orders.filter(o=>o.delivery&&o.delivery<today&&!['Cancelado','Entregado'].includes(o.status))
  const lowStock=stockRows(db).filter(r=>r.total<=r.min)
  const stages=productionColumns(db)
  const free=Math.max(0,DAILY_PIECE_LIMIT-todayPieces)
  const month=today.slice(0,7)
  const monthOrders=orders.filter(o=>String(o.date||o.createdAt||'').slice(0,7)===month&&o.status!=='Cancelado')
  const revenue=monthOrders.reduce((sum,o)=>sum+Number(o.total||0),0)
  const boxes=packagingNeeds(db,{from:today,days:7}),packagingStock=db.packagingStock||{}
  const boxesToBuy=boxes.reduce((sum,row)=>sum+Math.max(0,row.qty-Number(packagingStock[row.name]||0)),0)
  const upcoming=orders.filter(o=>o.delivery&&o.delivery>=today&&o.status!=='Cancelado').sort((a,b)=>String(a.delivery).localeCompare(String(b.delivery))).slice(0,6)

  const week=useMemo(()=>{
    const base=new Date(`${today}T12:00:00`)
    return Array.from({length:6},(_,i)=>{
      const d=new Date(base);d.setDate(d.getDate()+i)
      const iso=d.toISOString().slice(0,10)
      const dayOrders=orders.filter(o=>o.delivery===iso&&o.status!=='Cancelado')
      const pieces=dayOrders.reduce((sum,o)=>sum+orderPieces(o),0)
      return{iso,label:DAY_NAMES[d.getDay()],day:d.getDate(),pieces,count:dayOrders.length,percent:Math.min(100,Math.round(pieces/DAILY_PIECE_LIMIT*100))}
    })
  },[orders,today])

  const results=useMemo(()=>{
    const q=query.trim().toLocaleLowerCase('es')
    if(q.length<2)return[]
    return orders.filter(o=>[o.number,o.client,o.firstName,o.lastName,o.phone,o.dni,o.locality,...(o.items||[]).map(i=>i.figure)].filter(Boolean).join(' ').toLocaleLowerCase('es').includes(q)).slice(0,6)
  },[query,orders])

  const urgent=overdue.length?{kind:'danger',eyebrow:'ATENCIÓN AHORA',title:`${overdue.length} pedido${overdue.length===1?'':'s'} con fecha vencida`,text:'Revisalos antes de seguir con producción para evitar entregas desfasadas.',action:'Revisar pedidos',page:'orders'}:
    stages.Pendiente?.length?{kind:'primary',eyebrow:'SIGUIENTE ACCIÓN',title:`Preparar ${stages.Pendiente.length} pedido${stages.Pendiente.length===1?'':'s'} para corte`,text:'Son los pedidos activos que todavía no avanzaron a producción.',action:'Ir a para cortar',page:'cut'}:
    boxesToBuy?{kind:'warning',eyebrow:'PREPARAR DESPACHOS',title:`Faltan ${boxesToBuy} caja${boxesToBuy===1?'':'s'}`,text:'Necesarias para cubrir los próximos 7 días de entregas.',action:'Gestionar embalaje',page:'operations'}:
    {kind:'ok',eyebrow:'OPERACIÓN AL DÍA',title:'No hay bloqueantes importantes',text:'Podés seguir con el plan de producción previsto.',action:'Ver centro operativo',page:'operations'}

  return <div className="v2-dashboard">
    <section className="v2-welcome">
      <div><span className="v2-kicker">CENTRO DE PRODUCCIÓN</span><h1>Buen día. <span>Esto es lo importante hoy.</span></h1><p>{todayOrders.length} entregas programadas · {todayPieces} piezas · {sheetsForPieces(todayPieces)} planchas aproximadas</p></div>
      <div className="v2-welcome-actions"><button className="v2-btn secondary" onClick={()=>go('operations')}>Centro operativo</button><button className="v2-btn primary" onClick={()=>go('new')}>＋ Nuevo pedido</button></div>
    </section>

    <section className="v2-search-wrap"><div className="v2-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar pedido, cliente, teléfono, DNI o figura…"/><kbd>⌘ K</kbd></div>{results.length>0&&<div className="v2-search-results">{results.map(o=><button key={o.id} onClick={()=>go('orders')}><span><b>#{o.number} · {o.client||[o.firstName,o.lastName].filter(Boolean).join(' ')||'Sin nombre'}</b><small>{orderPieces(o)} piezas · {o.delivery||'sin fecha'}</small></span><em className={`v2-status ${statusTone(o.status)}`}>{o.status||'Ingresado'}</em></button>)}</div>}</section>

    <section className={`v2-priority ${urgent.kind}`}><div className="v2-priority-mark">{urgent.kind==='danger'?'!':urgent.kind==='ok'?'✓':'→'}</div><div><small>{urgent.eyebrow}</small><h2>{urgent.title}</h2><p>{urgent.text}</p></div><button onClick={()=>go(urgent.page)}>{urgent.action}<span>›</span></button></section>

    <section className="v2-grid v2-grid-main">
      <article className="v2-card v2-capacity"><div className="v2-card-head"><div><small>CAPACIDAD DE HOY</small><h3>{todayPieces>=DAILY_PIECE_LIMIT?'Producción completa':todayPieces>=70?'Día de alta carga':'Producción bajo control'}</h3></div><button onClick={()=>go('calendar')}>Calendario ›</button></div><div className="v2-capacity-number"><strong>{todayPieces}</strong><span>/ {DAILY_PIECE_LIMIT} piezas</span></div><div className="v2-meter"><i style={{width:`${Math.min(100,Math.round(todayPieces/DAILY_PIECE_LIMIT*100))}%`}}/></div><div className="v2-capacity-meta"><span><b>{free}</b> lugares libres</span><span><b>{todayOrders.length}</b> entregas</span><span><b>{sheetsForPieces(todayPieces)}</b> planchas aprox.</span></div></article>

      <article className="v2-card v2-flow"><div className="v2-card-head"><div><small>FLUJO DE PRODUCCIÓN</small><h3>Pedidos por etapa</h3></div><button onClick={()=>go('operations')}>Gestionar ›</button></div><div className="v2-flow-list"><Flow label="Pendiente" value={stages.Pendiente?.length||0} tone="neutral"/><Flow label="Corte" value={stages.Corte?.length||0} tone="blue"/><Flow label="Pegado" value={stages.Pegado?.length||0} tone="purple"/><Flow label="Embalaje" value={stages.Embalaje?.length||0} tone="amber"/><Flow label="Listo" value={stages.Listo?.length||0} tone="ok"/></div></article>
    </section>

    <section className="v2-stat-grid"><Stat label="Pedidos activos" value={active.length} sub={`${activePieces} piezas`} action={()=>go('orders')}/><Stat label="Facturación del mes" value={money(revenue)} sub={`${monthOrders.length} pedidos`} action={()=>go('monthly')}/><Stat label="Alertas de stock" value={lowStock.length} sub={lowStock.length?'Requieren revisión':'Inventario en orden'} danger={lowStock.length>0} action={()=>go('stock')}/><Stat label="Cajas a comprar" value={boxesToBuy} sub="Próximos 7 días" danger={boxesToBuy>0} action={()=>go('operations')}/></section>

    <section className="v2-grid v2-grid-bottom">
      <article className="v2-card"><div className="v2-card-head"><div><small>PRÓXIMOS 6 DÍAS</small><h3>Carga de producción</h3></div><button onClick={()=>go('calendar')}>Ver calendario ›</button></div><div className="v2-week">{week.map(day=><button key={day.iso} onClick={()=>go('calendar')} className={day.pieces>=DAILY_PIECE_LIMIT?'full':day.pieces>=70?'busy':''}><span>{day.label}</span><b>{day.day}</b><div><i style={{height:`${Math.max(6,day.percent)}%`}}/></div><strong>{day.pieces}</strong><small>{day.count} ped.</small></button>)}</div></article>

      <article className="v2-card"><div className="v2-card-head"><div><small>AGENDA</small><h3>Próximas entregas</h3></div><button onClick={()=>go('orders')}>Ver todas ›</button></div><div className="v2-deliveries">{upcoming.map(o=><button key={o.id} onClick={()=>go('orders')}><time><b>{String(o.delivery).slice(8,10)}</b><small>{new Date(`${o.delivery}T12:00:00`).toLocaleDateString('es-AR',{month:'short'}).replace('.','')}</small></time><span><b>#{o.number} · {o.client||'Sin nombre'}</b><small>{orderPieces(o)} piezas · {o.deliveryType||o.carrier||'Logística'}</small></span><em className={`v2-status ${statusTone(o.status)}`}>{o.status||'Ingresado'}</em></button>)}{!upcoming.length&&<div className="v2-empty">No hay próximas entregas cargadas.</div>}</div></article>
    </section>

    <section className="v2-shortcuts"><button onClick={()=>go('cut')}><span>✂</span><b>Preparar corte</b><small>{activePieces} piezas activas</small></button><button onClick={()=>go('sheetplanner')}><span>▦</span><b>Generar placas</b><small>Motor de anidado</small></button><button onClick={()=>go('stock')}><span>◇</span><b>Inventario</b><small>{lowStock.length?`${lowStock.length} alertas`:'Stock en orden'}</small></button><button onClick={()=>go('webrequests')}><span>↙</span><b>Solicitudes web</b><small>Revisar ingresos</small></button></section>
  </div>
}

function Flow({label,value,tone}){return <div className="v2-flow-row"><span><i className={tone}/>{label}</span><b>{value}</b></div>}
function Stat({label,value,sub,danger,action}){return <button className={`v2-stat ${danger?'danger':''}`} onClick={action}><small>{label}</small><b>{value}</b><span>{sub}</span><i>›</i></button>}
