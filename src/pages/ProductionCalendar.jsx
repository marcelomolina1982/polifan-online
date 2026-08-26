import React, {useMemo,useState} from 'react'
import {Title,Badge} from '../components/UI'
import {DAILY_PIECE_LIMIT,orderPieces,productionStatus,todayArgentinaISO,localISO} from '../lib/production'
import {packagingForPieces} from '../lib/packaging'
import {supabase} from '../supabase'

const iso=d=>localISO(d)
const add=(date,days)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+days);return iso(d)}
const label=date=>new Date(date+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'2-digit'})

export default function ProductionCalendar({db,onSave,go}){
  const [selected,setSelected]=useState(todayArgentinaISO())
  const [closing,setClosing]=useState(false)
  const closedDates=db.productionClosedDates||[]
  const days=useMemo(()=>Array.from({length:42},(_,i)=>add(todayArgentinaISO(),i)).filter(d=>new Date(d+'T12:00:00').getDay()!==0),[])
  const byDate=useMemo(()=>db.orders.filter(o=>o.delivery&&o.status!=='Cancelado').reduce((acc,o)=>{(acc[o.delivery]??=[]).push(o);return acc},{}),[db.orders])
  const orders=byDate[selected]||[]
  const selectedClosed=closedDates.includes(selected)
  const weeklyBoxes=useMemo(()=>{const start=todayArgentinaISO();const end=add(start,6);const grouped={};(db.orders||[]).filter(o=>o.delivery>=start&&o.delivery<=end&&o.status!=='Cancelado').forEach(o=>{const pack=packagingForPieces(orderPieces(o));pack.boxes.forEach(b=>{grouped[b.id]=grouped[b.id]||{...b,qty:0};grouped[b.id].qty+=b.qty})});return Object.values(grouped).sort((a,b)=>a.capacity-b.capacity)},[db.orders])

  async function toggleClosed(){
    const action=selectedClosed?'reabrir':'cerrar'
    if(!window.confirm(`¿Querés ${action} la producción del ${label(selected)}?`))return
    setClosing(true)
    try{
      const {error}=await supabase.rpc('set_production_closed_date',{p_date:selected,p_closed:!selectedClosed})
      if(error)throw error
      alert(selectedClosed?'Producción reabierta y sincronizada con el catálogo.':'Producción cerrada y sincronizada con el catálogo.')
      window.location.reload()
    }catch(error){
      alert('No se pudo sincronizar el calendario: '+(error?.message||'error de sincronización'))
      setClosing(false)
    }
  }

  return <>
    <Title title="Calendario de producción" sub="Capacidad diaria de 90 piezas. Cerrá un día cuando ya no quieras aceptar más producción para esa fecha." actions={<button className="primary" onClick={()=>go('new')}>＋ Nuevo pedido</button>}/>
    <div className="production-closure-note"><b>🔒 Cierre manual de producción</b><span>Las nuevas fechas estimadas comienzan después del último día cerrado y buscan el próximo día con capacidad disponible.</span></div>
    <section className="panel weekly-boxes"><div className="panel-heading"><div><h3>📦 Cajas necesarias · próximos 7 días</h3><small>Calculado automáticamente según los pedidos programados y sus cantidades.</small></div><b>{weeklyBoxes.reduce((s,b)=>s+b.qty,0)} cajas</b></div><div className="box-summary-grid">{weeklyBoxes.map(b=><div className="box-summary-card" key={b.id}><strong>{b.qty}</strong><span>{b.name}</span></div>)}{!weeklyBoxes.length&&<span className="muted">No hay cajas necesarias para pedidos de los próximos 7 días.</span>}</div></section>
    <div className="calendar-grid">{days.map(date=>{const list=byDate[date]||[];const pieces=list.reduce((s,o)=>s+orderPieces(o),0);const closed=closedDates.includes(date);const status=closed?'closed':productionStatus(pieces);return <button key={date} className={`calendar-day ${selected===date?'selected':''} ${status}`} onClick={()=>setSelected(date)}><small>{label(date)}</small><b>{closed?'PRODUCCIÓN CERRADA':`${pieces} / ${DAILY_PIECE_LIMIT}`}</b><span>{list.length} pedido{list.length===1?'':'s'}</span><i><em style={{width:closed?'100%':`${Math.min(100,pieces/DAILY_PIECE_LIMIT*100)}%`}}/></i></button>})}</div>
    <div className="panel"><div className="panel-heading"><div><h3>{label(selected)}</h3><small>{orders.reduce((s,o)=>s+orderPieces(o),0)} piezas programadas · {selectedClosed?'Producción cerrada':'Producción abierta'}</small></div><button className={selectedClosed?'ghost':'danger'} onClick={toggleClosed} disabled={closing}>{closing?'Sincronizando…':selectedClosed?'🔓 Reabrir producción':'🔒 Cerrar producción del día'}</button></div>
      <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Piezas</th><th>Caja sugerida</th><th>Estado</th></tr></thead><tbody>{orders.map(o=>{const pieces=orderPieces(o);return <tr key={o.id}><td>#{o.number}</td><td><b>{o.client}</b></td><td>{pieces}</td><td>{packagingForPieces(pieces).label}</td><td><Badge status={o.status}/></td></tr>})}{!orders.length&&<tr><td colSpan="5">No hay pedidos programados.</td></tr>}</tbody></table></div>
    </div>
  </>
}
