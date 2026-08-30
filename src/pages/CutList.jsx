import React, { useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { normalizeFigureKey, stockRows } from '../lib/inventory'
import { today } from '../lib/format'

function dateLabel(value){
  if(!value) return 'Sin fecha de entrega'
  const [y,m,d]=value.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(y,m-1,d))
}

function orderDate(order){return String(order?.delivery||'').slice(0,10)}
function isActiveOrder(order){return Boolean(order)&&!['Cancelado','Entregado'].includes(order.status)}

function pendingFromVisibleInventory(db){
  const inventoryRows=stockRows(db)
  const available={}
  const labels={}
  const snapshotDate=today()
  const activeOrders=(db.orders||[]).filter(isActiveOrder)
  const overdueOrders=activeOrders.filter(o=>orderDate(o)&&orderDate(o)<snapshotDate)

  inventoryRows.forEach(r=>{
    const key=normalizeFigureKey(r.figure)
    if(!key)return
    available[key]=(available[key]||0)+Math.max(0,Number(r.cut||0))
    if(!labels[key])labels[key]=r.figure
  })

  // stockRows() hoy descuenta automáticamente pedidos con fecha vencida.
  // Para que un pedido ACTIVO vencido no desaparezca de "Para cortar", primero
  // devolvemos temporalmente esa demanda al disponible y luego reservamos todo
  // otra vez en orden cronológico (vencidos primero, después hoy/futuros).
  overdueOrders.forEach(order=>{
    ;(order.items||[]).forEach(item=>{
      if(!item?.figure || item.inventoryTracked===false || Number(item.qty||0)<=0)return
      const key=normalizeFigureKey(item.figure)
      if(!key)return
      available[key]=(available[key]||0)+Number(item.qty||0)
      if(!labels[key])labels[key]=String(item.figure).trim()
    })
  })

  const groups={}
  activeOrders
    .slice()
    .sort((a,b)=>(orderDate(a)||'9999-12-31').localeCompare(orderDate(b)||'9999-12-31') || String(a.number||'').localeCompare(String(b.number||'')))
    .forEach(order=>{
      const date=orderDate(order)
      const groupKey=date||'sin-fecha'
      if(!groups[groupKey])groups[groupKey]={key:groupKey,date,overdue:Boolean(date&&date<snapshotDate),orders:[],rows:{},audit:{}}
      groups[groupKey].orders.push(order.number)
      ;(order.items||[]).forEach(item=>{
        if(!item?.figure || item.inventoryTracked===false || Number(item.qty||0)<=0)return
        const key=normalizeFigureKey(item.figure)
        if(!key)return
        const figure=labels[key]||String(item.figure).trim()
        const qty=Number(item.qty||0)
        const onHand=Math.max(0,Number(available[key]||0))
        const covered=Math.min(onHand,qty)
        available[key]=onHand-covered
        const pending=qty-covered
        if(!groups[groupKey].audit[key])groups[groupKey].audit[key]={figure,ordered:0,covered:0,pending:0,stockBefore:onHand}
        const a=groups[groupKey].audit[key]
        a.ordered+=qty;a.covered+=covered;a.pending+=pending
        if(pending>0)groups[groupKey].rows[figure]=(groups[groupKey].rows[figure]||0)+pending
      })
    })

  return Object.values(groups)
    .map(g=>({
      key:g.key,date:g.date,overdue:g.overdue,orders:[...new Set(g.orders)].filter(Boolean),
      rows:Object.entries(g.rows).map(([figure,qty])=>({figure,qty:Number(qty||0)})).filter(r=>r.qty>0).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'})),
      auditRows:Object.values(g.audit).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'}))
    }))
    .filter(g=>g.rows.length || g.auditRows.length)
    .sort((a,b)=>(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31'))
}

export default function CutList({db,goMotor}){
  const [selectedDate,setSelectedDate]=useState('')
  const allGroups=useMemo(()=>pendingFromVisibleInventory(db),[db])
  const groups=useMemo(()=>allGroups.filter(g=>g.rows.length),[allGroups])
  const overdueGroups=useMemo(()=>groups.filter(g=>g.overdue),[groups])
  const overdueOrders=useMemo(()=>new Set(overdueGroups.flatMap(g=>g.orders)).size,[overdueGroups])

  const summaryRows=useMemo(()=>{
    const totals={}
    groups.forEach(g=>g.rows.forEach(r=>{totals[r.figure]=(totals[r.figure]||0)+Number(r.qty||0)}))
    const inv=Object.fromEntries(stockRows(db).map(r=>[normalizeFigureKey(r.figure),r]))
    return Object.entries(totals).map(([figure,pending])=>{
      const base=inv[normalizeFigureKey(figure)]||{figure,cut:0,inCut:0,total:0}
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
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Lista para cortar</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:12px}header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}h1{font-size:20px;margin:0 0 4px}header p{margin:0}section{break-inside:avoid;margin:0 0 14px}h2{font-size:15px;margin:0;background:#eee;padding:7px;border:1px solid #111}.orders{margin:5px 0;font-size:10px;color:#444}table{width:100%;border-collapse:collapse}th,td{border:1px solid #111;padding:6px;text-align:left}th:last-child,td:last-child{width:26%;text-align:center;font-weight:700}tfoot th{background:#f3f3f3}.note{margin-top:12px;font-size:10px;text-align:center}</style></head><body><header><h1>TU VIDA EN TINTA · POLIFAN</h1><p>LISTA DE PIEZAS PARA CORTAR</p></header>${sections}<p class="note">Lista calculada desde el stock físico de Inventario. Los pedidos activos vencidos siguen visibles hasta marcarlos Entregado o Cancelado.</p><script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  return <>
    <Title title="Pedidos para cortar" sub="Piezas pendientes por fecha, usando como fuente de verdad el stock físico que ves en Inventario." actions={<div className="actions"><button className="primary" onClick={goMotor}>Generar placas</button><button className="ghost" onClick={printDailyList}>Imprimir lista</button></div>}/>
    <div className="notice"><b>Cálculo por inventario físico</b><span>Los pedidos activos no desaparecen por tener una fecha vencida. Se reservan primero los atrasados y después los pedidos de hoy y futuros. Sólo salen de esta cola cuando están Entregados o Cancelados.</span></div>
    {overdueOrders>0&&<div className="notice" style={{borderColor:'#ef4444'}}><b>⚠ {overdueOrders} pedidos activos con entrega vencida</b><span>Estaban quedando fuera del cálculo anterior. Ahora vuelven a aparecer como ATRASADOS sin descontar dos veces el inventario.</span></div>}

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
        <details style={{marginTop:10}}><summary><b>Ver cómo se calculó esta fecha</b></summary><div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Figura</th><th>Pedido</th><th>Cubierto por inventario</th><th>Falta cortar</th></tr></thead><tbody>{g.auditRows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td>{r.ordered}</td><td>{r.covered}</td><td className={r.pending>0?'big':'green-text'}>{r.pending}</td></tr>)}</tbody></table></div></details>
      </div>)}
      {!visibleGroups.length&&<div className="panel">No hay piezas pendientes para cortar.</div>}
    </div>

    <details className="panel cut-summary"><summary><b>Ver resumen general por figura</b></summary><div className="table-wrap"><table><thead><tr><th>Figura</th><th>Stock físico contado</th><th>En corte</th><th>Falta cortar</th></tr></thead><tbody>
      {summaryRows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td>{Number(r.cut||0)}</td><td className="purple-text">{Number(r.inCut||0)}</td><td className="big">{r.pending}</td></tr>)}
      {!summaryRows.length&&<tr><td colSpan="4">No hay figuras pendientes para cortar.</td></tr>}
    </tbody></table></div></details>
  </>
}
