import React, { useEffect, useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { normalizeFigureKey } from '../lib/inventory'
import { pendingCutPlan, productionStockSnapshot } from '../lib/cutPlanning'
import { loadV2Sections } from '../lib/v2Data'
import { todayArgentinaISO } from '../lib/production'

function dateLabel(value){
  if(!value) return 'Sin fecha de entrega'
  const [y,m,d]=value.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(y,m-1,d))
}

function productionOrderIsCurrent(order,today){
  if(!order || ['Cancelado','Entregado'].includes(order.status)) return false
  const date=String(order?.delivery||'').slice(0,10)
  return !date || date>=today
}

export default function CutList({db,goMotor}){
  const [selectedDate,setSelectedDate]=useState('')
  const [liveDb,setLiveDb]=useState(db)
  const [refreshing,setRefreshing]=useState(false)
  const today=todayArgentinaISO()

  useEffect(()=>{ setLiveDb(db) },[db])

  useEffect(()=>{
    let alive=true
    async function refresh(){
      setRefreshing(true)
      try{
        const result=await loadV2Sections(['orders','movements','stockMin','figures','cutBatches'])
        if(!alive)return
        setLiveDb(current=>({...current,...result.data}))
      }catch(error){
        console.error('No se pudo refrescar Para cortar',error)
      }finally{
        if(alive)setRefreshing(false)
      }
    }
    refresh()
    const onFocus=()=>refresh()
    const onVisibility=()=>{if(document.visibilityState==='visible')refresh()}
    window.addEventListener('focus',onFocus)
    document.addEventListener('visibilitychange',onVisibility)
    const timer=setInterval(refresh,30000)
    return()=>{
      alive=false
      clearInterval(timer)
      window.removeEventListener('focus',onFocus)
      document.removeEventListener('visibilitychange',onVisibility)
    }
  },[])

  const calculationDb=useMemo(()=>({
    ...liveDb,
    orders:(liveDb.orders||[]).filter(order=>productionOrderIsCurrent(order,today))
  }),[liveDb,today])

  const allGroups=useMemo(()=>pendingCutPlan(calculationDb),[calculationDb])
  const groups=useMemo(()=>allGroups.filter(g=>g.rows.length),[allGroups])

  const summaryRows=useMemo(()=>{
    const totals={}
    groups.forEach(g=>g.rows.forEach(r=>{totals[r.figure]=(totals[r.figure]||0)+Number(r.qty||0)}))
    const inv=Object.fromEntries(productionStockSnapshot(calculationDb).map(r=>[normalizeFigureKey(r.figure),r]))
    return Object.entries(totals).map(([figure,pending])=>{
      const base=inv[normalizeFigureKey(figure)]||{figure,physical:0,inCut:0}
      return {...base,figure,pending}
    }).sort((a,b)=>b.pending-a.pending)
  },[groups,calculationDb])

  const visibleGroups=selectedDate ? groups.filter(g=>g.key===selectedDate) : groups

  function printDailyList(){
    if(!visibleGroups.length) return alert('No hay piezas pendientes para la fecha seleccionada.')
    const sections=visibleGroups.map(g=>{
      const body=g.rows.map(r=>`<tr><td>${r.figure}</td><td>${r.qty}</td></tr>`).join('')
      const total=g.rows.reduce((a,r)=>a+r.qty,0)
      return `<section><h2>Entrega: ${dateLabel(g.date)}</h2><p class="orders">Pedidos: ${g.orders.map(n=>'#'+n).join(', ')}</p><table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th>Total</th><th>${total}</th></tr></tfoot></table></section>`
    }).join('')
    const win=window.open('','_blank')
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Lista para cortar</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:12px}header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}h1{font-size:20px;margin:0 0 4px}header p{margin:0}section{break-inside:avoid;margin:0 0 14px}h2{font-size:15px;margin:0;background:#eee;padding:7px;border:1px solid #111}.orders{margin:5px 0;font-size:10px;color:#444}table{width:100%;border-collapse:collapse}th,td{border:1px solid #111;padding:6px;text-align:left}th:last-child,td:last-child{width:26%;text-align:center;font-weight:700}tfoot th{background:#f3f3f3}.note{margin-top:12px;font-size:10px;text-align:center}</style></head><body><header><h1>TU VIDA EN TINTA · POLIFAN</h1><p>LISTA DE PIEZAS PARA CORTAR</p></header>${sections}<p class="note">Cálculo operativo actual: pedidos desde hoy en adelante + stock producido + piezas ya en corte.</p><script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  return <>
    <Title title="Pedidos para cortar" sub="Fuente operativa en vivo: pedidos vigentes, inventario producido y piezas ya en corte." actions={<div className="actions"><button className="primary" onClick={goMotor}>Generar placas</button><button className="ghost" onClick={printDailyList}>Imprimir lista</button></div>}/>
    <div className="notice"><b>{refreshing?'Actualizando producción…':'Producción sincronizada con Supabase'}</b><span>Los pedidos con fecha anterior a hoy no vuelven a reservar stock. Las piezas producidas y las que están En corte se descuentan una sola vez del faltante vigente.</span></div>

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
        <details style={{marginTop:10}}><summary><b>Ver cómo se calculó esta fecha</b></summary><div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Figura</th><th>Pedido</th><th>Cubierto</th><th>Falta cortar</th></tr></thead><tbody>{g.auditRows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td>{r.ordered}</td><td>{r.covered}</td><td className={r.pending>0?'big':'green-text'}>{r.pending}</td></tr>)}</tbody></table></div></details>
      </div>)}
      {!visibleGroups.length&&<div className="panel">No hay piezas pendientes para cortar.</div>}
    </div>

    <details className="panel cut-summary"><summary><b>Ver resumen general por figura</b></summary><div className="table-wrap"><table><thead><tr><th>Figura</th><th>Stock producido</th><th>En corte</th><th>Falta cortar</th></tr></thead><tbody>
      {summaryRows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td>{Number(r.physical||0)}</td><td className="purple-text">{Number(r.inCut||0)}</td><td className="big">{r.pending}</td></tr>)}
      {!summaryRows.length&&<tr><td colSpan="4">No hay figuras pendientes para cortar.</td></tr>}
    </tbody></table></div></details>
  </>
}