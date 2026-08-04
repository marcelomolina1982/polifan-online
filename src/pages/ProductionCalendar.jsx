import React, {useMemo,useState} from 'react'
import {Title,Badge} from '../components/UI'
import {DAILY_PIECE_LIMIT,orderPieces,productionStatus} from '../lib/production'
import {packagingForPieces} from '../lib/packaging'

const iso=d=>{const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,10)}
const add=(date,days)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+days);return iso(d)}
const label=date=>new Date(date+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'2-digit'})

export default function ProductionCalendar({db,go}){
  const [selected,setSelected]=useState(iso(new Date()))
  const days=useMemo(()=>Array.from({length:28},(_,i)=>add(iso(new Date()),i)).filter(d=>new Date(d+'T12:00:00').getDay()!==0),[])
  const byDate=useMemo(()=>db.orders.filter(o=>o.delivery&&o.status!=='Cancelado').reduce((acc,o)=>{(acc[o.delivery]??=[]).push(o);return acc},{}),[db.orders])
  const orders=byDate[selected]||[]
  return <>
    <Title title="Calendario de producción" sub="Capacidad diaria de 90 piezas, sin domingos." actions={<button className="primary" onClick={()=>go('new')}>＋ Nuevo pedido</button>}/>
    <div className="calendar-grid">{days.map(date=>{const list=byDate[date]||[];const pieces=list.reduce((s,o)=>s+orderPieces(o),0);const status=productionStatus(pieces);return <button key={date} className={`calendar-day ${selected===date?'selected':''} ${status}`} onClick={()=>setSelected(date)}><small>{label(date)}</small><b>{pieces} / {DAILY_PIECE_LIMIT}</b><span>{list.length} pedido{list.length===1?'':'s'}</span><i><em style={{width:`${Math.min(100,pieces/DAILY_PIECE_LIMIT*100)}%`}}/></i></button>})}</div>
    <div className="panel"><div className="panel-heading"><div><h3>{label(selected)}</h3><small>{orders.reduce((s,o)=>s+orderPieces(o),0)} piezas programadas</small></div></div>
      <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Piezas</th><th>Caja sugerida</th><th>Estado</th></tr></thead><tbody>{orders.map(o=>{const pieces=orderPieces(o);return <tr key={o.id}><td>#{o.number}</td><td><b>{o.client}</b></td><td>{pieces}</td><td>{packagingForPieces(pieces).label}</td><td><Badge status={o.status}/></td></tr>})}{!orders.length&&<tr><td colSpan="5">No hay pedidos programados.</td></tr>}</tbody></table></div>
    </div>
  </>
}
