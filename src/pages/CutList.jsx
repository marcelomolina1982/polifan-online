import React, { useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { pendingCutByDelivery, pendingCutRows } from '../lib/inventory'
import { today } from '../lib/format'

function dateLabel(value){
  if(!value) return 'Sin fecha de entrega'
  const [y,m,d]=value.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(y,m-1,d))
}

const PACKED_TODAY_KEY='polifan-cutlist-packed-today'

export default function CutList({db,goMotor}){
  const todayKey=today()
  const [packedToday,setPackedToday]=useState(()=>{
    try{return localStorage.getItem(PACKED_TODAY_KEY)===todayKey}catch{return false}
  })

  // IMPORTANTE: si hoy ya está embalado y el recuento físico incluye esas piezas,
  // esos pedidos no deben consumir inventario al calcular lo que falta para mañana.
  const calcDb=useMemo(()=>{
    if(!packedToday)return db
    return {
      ...db,
      orders:(db.orders||[]).filter(o=>String(o?.delivery||'').slice(0,10)!==todayKey)
    }
  },[db,packedToday,todayKey])

  const groups=useMemo(()=>pendingCutByDelivery(calcDb),[calcDb])
  const rows=useMemo(()=>pendingCutRows(calcDb).sort((a,b)=>b.pending-a.pending),[calcDb])
  const [selectedDate,setSelectedDate]=useState('')
  const visibleGroups=selectedDate ? groups.filter(g=>g.key===selectedDate) : groups

  function markTodayPacked(){
    if(!window.confirm('¿Confirmás que los pedidos de HOY ya están embalados y que esas piezas están incluidas en tu recuento físico?\n\nDesde ahora esos pedidos no consumirán inventario al calcular “Para cortar”. No se modifica ningún pedido ni cantidad del inventario.'))return
    try{localStorage.setItem(PACKED_TODAY_KEY,todayKey)}catch{}
    setPackedToday(true)
    setSelectedDate('')
  }

  function undoTodayPacked(){
    try{localStorage.removeItem(PACKED_TODAY_KEY)}catch{}
    setPackedToday(false)
  }

  function printDailyList(){
    if(!visibleGroups.length) return alert('No hay piezas pendientes para la fecha seleccionada.')
    const sections=visibleGroups.map(g=>{
      const body=g.rows.map(r=>`<tr><td>${r.figure}</td><td>${r.qty}</td></tr>`).join('')
      const total=g.rows.reduce((a,r)=>a+r.qty,0)
      return `<section><h2>Entrega: ${dateLabel(g.date)}</h2><p class="orders">Pedidos: ${g.orders.map(n=>'#'+n).join(', ')}</p><table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th>Total</th><th>${total}</th></tr></tfoot></table></section>`
    }).join('')
    const win=window.open('','_blank')
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Lista para cortar</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:12px}header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}h1{font-size:20px;margin:0 0 4px}header p{margin:0}section{break-inside:avoid;margin:0 0 14px}h2{font-size:15px;margin:0;background:#eee;padding:7px;border:1px solid #111}.orders{margin:5px 0;font-size:10px;color:#444}table{width:100%;border-collapse:collapse}th,td{border:1px solid #111;padding:6px;text-align:left}th:last-child,td:last-child{width:26%;text-align:center;font-weight:700}tfoot th{background:#f3f3f3}.note{margin-top:12px;font-size:10px;text-align:center}</style></head><body><header><h1>TU VIDA EN TINTA · POLIFAN</h1><p>LISTA DE PIEZAS PARA CORTAR</p></header>${sections}<p class="note">Lista calculada según pedidos, inventario disponible y piezas registradas en corte.</p><script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  const originalTodayGroup=useMemo(()=>pendingCutByDelivery(db).find(g=>g.date===todayKey),[db,todayKey])
  const todayQty=originalTodayGroup?.rows?.reduce((a,r)=>a+r.qty,0)||0

  return <>
    <Title title="Pedidos para cortar" sub="Piezas pendientes agrupadas por fecha de entrega, descontando inventario y piezas que ya están en corte." actions={<div className="actions"><button className="primary" onClick={goMotor}>Generar placas</button><button className="ghost" onClick={printDailyList}>Imprimir lista</button></div>}/>
    <div className="notice"><b>Cálculo automático</b><span>Para cortar se forma comparando los pedidos contra el inventario físico cortado. Si una fecha ya está embalada y esas piezas están incluidas en el recuento, esa fecha no debe consumir inventario otra vez.</span></div>

    {originalTodayGroup&&!packedToday&&<div className="notice" style={{border:'2px solid #e89acb'}}><b>¿Los pedidos de hoy ya están embalados?</b><span>Figuran {todayQty} piezas de hoy. Si esas piezas ya están en cajas y están incluidas en tu recuento físico, marcá esta opción para que no vuelvan a consumir stock en el cálculo.</span><button type="button" className="primary smallbtn" onClick={markTodayPacked}>📦 Hoy ya está embalado</button></div>}
    {packedToday&&<div className="notice"><b>📦 Hoy embalado</b><span>Los pedidos de hoy ya no consumen inventario dentro del cálculo de “Para cortar”. El inventario y los pedidos no fueron modificados.</span><button type="button" className="ghost smallbtn" onClick={undoTodayPacked}>Deshacer</button></div>}

    <div className="panel filters cut-date-filter">
      <label><b>Ver por fecha de entrega</b></label>
      <select value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}>
        <option value="">Todas las fechas pendientes</option>
        {groups.map(g=><option key={g.key} value={g.key}>{dateLabel(g.date)}</option>)}
      </select>
      <button className="ghost" onClick={printDailyList}>Imprimir lista seleccionada</button>
    </div>

    <div className="delivery-groups">
      {visibleGroups.map(g=><div className="panel delivery-group" key={g.key}>
        <div className="delivery-head"><div><small>FECHA DE ENTREGA</small><h3>{dateLabel(g.date)}</h3><span>Pedidos: {g.orders.map(n=>'#'+n).join(', ')}</span></div><b>{g.rows.reduce((a,r)=>a+r.qty,0)} piezas</b></div>
        <div className="table-wrap"><table><thead><tr><th>Figura</th><th>Cantidad a cortar</th></tr></thead><tbody>{g.rows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td className="big">{r.qty}</td></tr>)}</tbody></table></div>
      </div>)}
      {!visibleGroups.length&&<div className="panel">No hay piezas pendientes para la fecha seleccionada.</div>}
    </div>

    <details className="panel cut-summary"><summary><b>Ver resumen general por figura</b></summary><div className="table-wrap"><table><thead><tr><th>Figura</th><th>Stock actual</th><th>En corte</th><th>Falta cortar</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td className={r.total<0?'red-text':'green-text'}>{r.total}</td><td className="purple-text">{r.inCut}</td><td className="big">{r.pending}</td></tr>)}
      {!rows.length&&<tr><td colSpan="4">No hay figuras pendientes para cortar.</td></tr>}
    </tbody></table></div></details>
  </>
}
