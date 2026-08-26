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
      let saved=false,lastError=null
      for(let attempt=1;attempt<=5&&!saved;attempt++){
        const {data:row,error:readError}=await supabase.from('app_state').select('data,updated_at').eq('id','main').maybeSingle()
        if(readError){lastError=readError;break}
        const latestData=row?.data||{}
        const latestClosed=Array.isArray(latestData.productionClosedDates)?latestData.productionClosedDates:[]
        const next=selectedClosed
          ? latestClosed.filter(d=>d!==selected)
          : [...new Set([...latestClosed,selected])].sort()
        const updatedAt=new Date().toISOString()
        let query=supabase.from('app_state').update({data:{...latestData,productionClosedDates:next},updated_at:updatedAt}).eq('id','main')
        if(row?.updated_at)query=query.eq('updated_at',row.updated_at)
        const result=await query.select('updated_at')
        if(result.error){lastError=result.error;break}
        if(result.data?.length){saved=true;break}
        await new Promise(resolve=>setTimeout(resolve,120*attempt))
      }
      if(!saved)throw lastError||new Error('El estado cambió varias veces mientras se guardaba.')
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
