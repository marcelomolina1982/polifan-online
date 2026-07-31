import React, { useState } from 'react'
import { Title, Kpi } from '../components/UI'
import { money } from '../lib/format'

export default function Monthly({db}){
  const now=new Date()
  const [month,setMonth]=useState(now.getMonth()+1)
  const [year,setYear]=useState(now.getFullYear())
  const list=db.orders.filter(o=>{
    const d=new Date(o.date||o.createdAt)
    return d.getMonth()+1===Number(month)&&d.getFullYear()===Number(year)
  })
  const valid=list.filter(o=>o.status!=='Cancelado')
  const pieces=valid.reduce((a,o)=>a+(o.items||[]).reduce((b,i)=>b+Number(i.qty||0),0),0)
  const revenue=valid.reduce((a,o)=>a+Number(o.total||0),0)
  const byFig={}
  valid.forEach(o=>(o.items||[]).forEach(i=>byFig[i.figure]=(byFig[i.figure]||0)+Number(i.qty||0)))
  return <>
    <Title title="Resumen mensual" sub="Consultá pedidos, piezas y facturación por mes."/>
    <div className="panel filters"><select value={month} onChange={e=>setMonth(e.target.value)}>{Array.from({length:12},(_,i)=><option value={i+1} key={i}>{new Date(2024,i,1).toLocaleString('es-AR',{month:'long'})}</option>)}</select><input type="number" value={year} onChange={e=>setYear(e.target.value)}/></div>
    <div className="cards"><Kpi label="Pedidos" value={valid.length}/><Kpi label="Piezas" value={pieces}/><Kpi label="Facturación" value={money(revenue)}/><Kpi label="Entregados" value={valid.filter(o=>o.status==='Entregado').length}/></div>
    <div className="panel table-wrap"><table><thead><tr><th>Figura</th><th>Cantidad</th></tr></thead><tbody>{Object.entries(byFig).sort((a,b)=>b[1]-a[1]).map(([f,q])=><tr key={f}><td>{f}</td><td><b>{q}</b></td></tr>)}</tbody></table></div>
  </>
}

