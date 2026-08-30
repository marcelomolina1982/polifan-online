import React, { useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { normalizeFigureKey } from '../lib/inventory'
import { pendingCutPlan, productionStockSnapshot } from '../lib/cutPlanning'

function dateLabel(value){
  if(!value) return 'Sin fecha de entrega'
  const [y,m,d]=value.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(y,m-1,d))
}

export default function CutList({db,goMotor}){
  const [selectedDate,setSelectedDate]=useState('')
  const allGroups=useMemo(()=>pendingCutPlan(db),[db])
  const groups=useMemo(()=>allGroups.filter(g=>g.rows.length),[allGroups])
  const overdueGroups=useMemo(()=>groups.filter(g=>g.overdue),[groups])
  const overdueOrders=useMemo(()=>new Set(overdueGroups.flatMap(g=>g.orders)).size,[overdueGroups])

  const summaryRows=useMemo(()=>{
    const totals={}
    groups.forEach(g=>g.rows.forEach(r=>{totals[r.figure]=(totals[r.figure]||0)+Number(r.qty||0)}))
    const inv=Object.fromEntries(productionStockSnapshot(db).map(r=>[normalizeFigureKey(r.figure),r]))
    return Object.entries(totals).map(([figure,pending])=>{
      const base=inv[normalizeFigureKey(figure)]||{figure,physical:0,inCut:0}
      return {...base,figure,pending}
    }).sort((a,b)=>b.pending-a.pending)
  },[groups,db])

  const visibleGroups=selectedDate ? groups.filter(g=>g.key===selectedDate) : groups

  function printDailyList(){
    if(!visibleGroups.length) return alert('No hay piezas pendientes para la fecha seleccionada.')
    const sections=visibleGroups.map(g=>{
      const body=g.rows.map(r=>`<tr><td>${r.figure}</td><td>${r.qty}</td></tr>`).join('')
      const total=g.rows.reduce((a,r)=>a+r.qty,0)
      return `<section><h2>${g.overdue?'ATRASADO · ':''}Entrega: ${dateLabel(g.date)}</h2><p class="orders">Pedidos: ${g.orders.map(n=>'#'+n).join(', ')}</p><table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th>Total</th><th>${total}</th></tr></tfoot></table></section>`
    }).join('')
    const win=window.open('','_blank')
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Lista para cortar</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:12px}header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}h1{font-size:20px;margin:0 0 4px}header p{margin:0}section{break-inside:avoid;margin:0 0 14px}h2{font-size:15px;margin:0;background:#eee;padding:7px;border:1px solid #111}.orders{margin:5px 0;font-size:10px;color:#444}table{width:100%;border-collapse:collapse}th,td{border:1px solid #111;padding:6px;text-align:left}th:last-child,td:last-child{width:26%;text-align:center;font-weight:700}tfoot th{background:#f3f3f3}.note{margin-top:12px;font-size:10px;text-align:center}</style></head><body><header><h1>TU VIDA EN TINTA · POLIFAN</h1><p>LISTA DE PIEZAS PARA CORTAR</p></header>${sections}<p class="note">Mismo cálculo usado por Generar placas: stock físico real + piezas ya en corte, con pedidos activos vencidos primero.</p><script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  return <>
    <Title title="Pedidos para cortar" sub="Misma fuente de verdad que usa el motor de placas: pedidos activos, inventario físico y piezas ya en corte." actions={<div className="actions"><button className="primary" onClick={goMotor}>Generar placas</button><button className="ghost" onClick={printDailyList}>Imprimir lista</button></div>}/>
    <div className="notice"><b>Cálculo único de producción</b><span>Los atrasados siguen pendientes hasta Entregado o Cancelado. Lo que ya existe físicamente o está En corte no se vuelve a mandar a cortar.</span></div>
    {overdueOrders>0&&<div className="notice" style={{borderColor:'#ef4444'}}><b>⚠ {overdueOrders} pedidos activos con entrega vencida</b><span>Se procesan primero y ya no desaparecen por el solo hecho de haber pasado su fecha.</span></div>}

    <div className="panel filters cut-date-filter">
      <label><b>Ver por fecha de entrega</b></label>
      <select value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}>
        <option value="">Todas las fechas pendientes</option>
        {groups.map(g=><option key={g.key} value={g.key}>{g.overdue?'ATRASADO · ':''}{dateLabel(g.date)}</option>)}
      </select>
      <button className="ghost" onClick={printDailyList}>Imprimir lista seleccionada</button>
    </div>

    <div className="delivery-groups">
      {visibleGroups.map(g=><div className="panel delivery-group" key={g.key}>
        <div className="delivery-head"><div><small>{g.overdue?'⚠ ATRASADO':'FECHA DE ENTREGA'}</small><h3>{dateLabel(g.date)}</h3><span>Pedidos: {g.orders.map(n=>'#'+n).join(', ')}</span></div><b>{g.rows.reduce((a,r)=>a+r.qty,0)} piezas</b></div>
        <div className="table-wrap"><table><thead><tr><th>Figura</th><th>Cantidad a cortar</th></tr></thead><tbody>{g.rows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td className="big">{r.qty}</td></tr>)}</tbody></table></div>
        <details style={{marginTop:10}}><summary><b>Ver cómo se calculó esta fecha</b></summary><div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Figura</th><th>Pedido</th><th>Cubierto</th><th>Falta cortar</th></tr></thead><tbody>{g.auditRows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td>{r.ordered}</td><td>{r.covered}</td><td className={r.pending>0?'big':'green-text'}>{r.pending}</td></tr>)}</tbody></table></div></details>
      </div>)}
      {!visibleGroups.length&&<div className="panel">No hay piezas pendientes para cortar.</div>}
    </div>

    <details className="panel cut-summary"><summary><b>Ver resumen general por figura</b></summary><div className="table-wrap"><table><thead><tr><th>Figura</th><th>Stock físico</th><th>En corte</th><th>Falta cortar</th></tr></thead><tbody>
      {summaryRows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td>{Number(r.physical||0)}</td><td className="purple-text">{Number(r.inCut||0)}</td><td className="big">{r.pending}</td></tr>)}
      {!summaryRows.length&&<tr><td colSpan="4">No hay figuras pendientes para cortar.</td></tr>}
    </tbody></table></div></details>
  </>
}