import React, { useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { isOrderCommitted, normalizeFigureKey, stockRows } from '../lib/inventory'
import { today } from '../lib/format'

function dateLabel(value){
  if(!value) return 'Sin fecha de entrega'
  const [y,m,d]=value.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(y,m-1,d))
}

function orderDate(order){return String(order?.delivery||'').slice(0,10)}

function pendingFromVisibleInventory(db){
  const inventoryRows=stockRows(db)
  const available={}
  const labels={}

  // Fuente de verdad: exactamente lo que Inventario muestra como CORTADAS AHORA.
  // También suma EN CORTE para no volver a pedir una pieza que ya está en máquina.
  inventoryRows.forEach(r=>{
    const key=normalizeFigureKey(r.figure)
    if(!key)return
    available[key]=(available[key]||0)+Math.max(0,Number(r.cut||0))+Math.max(0,Number(r.inCut||0))
    if(!labels[key])labels[key]=r.figure
  })

  const groups={}
  ;(db.orders||[])
    .filter(o=>isOrderCommitted(o))
    .slice()
    .sort((a,b)=>(orderDate(a)||'9999-12-31').localeCompare(orderDate(b)||'9999-12-31') || String(a.number||'').localeCompare(String(b.number||'')))
    .forEach(order=>{
      const date=orderDate(order)
      const groupKey=date||'sin-fecha'
      if(!groups[groupKey])groups[groupKey]={key:groupKey,date,orders:[],rows:{}}
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
        if(pending>0)groups[groupKey].rows[figure]=(groups[groupKey].rows[figure]||0)+pending
      })
    })

  return Object.values(groups)
    .map(g=>({
      key:g.key,
      date:g.date,
      orders:[...new Set(g.orders)].filter(Boolean),
      rows:Object.entries(g.rows)
        .map(([figure,qty])=>({figure,qty:Number(qty||0)}))
        .filter(r=>r.qty>0)
        .sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'}))
    }))
    .filter(g=>g.rows.length)
    .sort((a,b)=>(a.date||'9999-12-31').localeCompare(b.date||'9999-12-31'))
}

const PACKED_TODAY_KEY='polifan-cutlist-packed-today'

export default function CutList({db,goMotor}){
  const todayKey=today()
  const [packedToday,setPackedToday]=useState(()=>{
    try{return localStorage.getItem(PACKED_TODAY_KEY)===todayKey}catch{return false}
  })

  const calcDb=useMemo(()=>{
    if(!packedToday)return db
    return {...db,orders:(db.orders||[]).filter(o=>String(o?.delivery||'').slice(0,10)!==todayKey)}
  },[db,packedToday,todayKey])

  const groups=useMemo(()=>pendingFromVisibleInventory(calcDb),[calcDb])
  const summaryRows=useMemo(()=>{
    const totals={}
    groups.forEach(g=>g.rows.forEach(r=>{totals[r.figure]=(totals[r.figure]||0)+Number(r.qty||0)}))
    const inv=Object.fromEntries(stockRows(calcDb).map(r=>[normalizeFigureKey(r.figure),r]))
    return Object.entries(totals).map(([figure,pending])=>{
      const base=inv[normalizeFigureKey(figure)]||{figure,cut:0,inCut:0,total:0}
      return {...base,figure,pending}
    }).sort((a,b)=>b.pending-a.pending)
  },[groups,calcDb])

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
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Lista para cortar</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:12px}header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}h1{font-size:20px;margin:0 0 4px}header p{margin:0}section{break-inside:avoid;margin:0 0 14px}h2{font-size:15px;margin:0;background:#eee;padding:7px;border:1px solid #111}.orders{margin:5px 0;font-size:10px;color:#444}table{width:100%;border-collapse:collapse}th,td{border:1px solid #111;padding:6px;text-align:left}th:last-child,td:last-child{width:26%;text-align:center;font-weight:700}tfoot th{background:#f3f3f3}.note{margin-top:12px;font-size:10px;text-align:center}</style></head><body><header><h1>TU VIDA EN TINTA · POLIFAN</h1><p>LISTA DE PIEZAS PARA CORTAR</p></header>${sections}<p class="note">Lista calculada directamente desde lo que Inventario muestra como cortado, más lo que ya está en corte.</p><script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  const originalTodayGroup=useMemo(()=>pendingFromVisibleInventory(db).find(g=>g.date===todayKey),[db,todayKey])
  const todayQty=originalTodayGroup?.rows?.reduce((a,r)=>a+r.qty,0)||0

  return <>
    <Title title="Pedidos para cortar" sub="Piezas pendientes por fecha, usando como fuente de verdad el stock físico que ves en Inventario." actions={<div className="actions"><button className="primary" onClick={goMotor}>Generar placas</button><button className="ghost" onClick={printDailyList}>Imprimir lista</button></div>}/>
    <div className="notice"><b>Cálculo corregido</b><span>“Para cortar” ahora toma exactamente las cantidades que ves en Inventario como <b>Cortadas ahora</b>, suma lo que ya está <b>En corte</b> y recién después calcula la diferencia de los pedidos, empezando por la fecha más próxima.</span></div>

    {originalTodayGroup&&!packedToday&&<div className="notice" style={{border:'2px solid #e89acb'}}><b>¿Los pedidos de hoy ya están embalados?</b><span>Figuran {todayQty} piezas de hoy. Si esas piezas ya están en cajas y están incluidas en tu recuento físico, marcá esta opción para que no vuelvan a consumir stock en el cálculo.</span><button type="button" className="primary smallbtn" onClick={markTodayPacked}>📦 Hoy ya está embalado</button></div>}
    {packedToday&&<div className="notice"><b>📦 Hoy embalado</b><span>Los pedidos de hoy no consumen inventario en el cálculo. El inventario y los pedidos siguen intactos.</span><button type="button" className="ghost smallbtn" onClick={undoTodayPacked}>Deshacer</button></div>}

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
      {!visibleGroups.length&&<div className="panel">No hay piezas pendientes para cortar.</div>}
    </div>

    <details className="panel cut-summary"><summary><b>Ver resumen general por figura</b></summary><div className="table-wrap"><table><thead><tr><th>Figura</th><th>Stock actual</th><th>En corte</th><th>Falta cortar</th></tr></thead><tbody>
      {summaryRows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td>{Number(r.cut||0)}</td><td className="purple-text">{Number(r.inCut||0)}</td><td className="big">{r.pending}</td></tr>)}
      {!summaryRows.length&&<tr><td colSpan="4">No hay figuras pendientes para cortar.</td></tr>}
    </tbody></table></div></details>
  </>
}
