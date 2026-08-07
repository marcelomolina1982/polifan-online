import React, { useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { today } from '../lib/format'
import { stockRows } from '../lib/inventory'

export default function Stock({db,onSave}){
  const [form,setForm]=useState({date:today(),figure:db.figures[0]||'',component:'complete',type:'Entrada extra',qty:1,detail:''})
  const [search,setSearch]=useState('')
  const [quickQty,setQuickQty]=useState({})
  const [quickPart,setQuickPart]=useState({})
  const rows=stockRows(db).filter(r=>r.figure.toLowerCase().includes(search.toLowerCase()))
  const sortedFigures=useMemo(()=>[...new Set([...(db.figures||[]),...(db.customerCatalog||[]).map(p=>p.name).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures,db.customerCatalog])
  const totals=useMemo(()=>rows.reduce((a,r)=>({cut:a.cut+r.cut,ordered:a.ordered+r.ordered,inCut:a.inCut+r.inCut,free:a.free+r.free,projected:a.projected+r.projected}),{cut:0,ordered:0,inCut:0,free:0,projected:0}),[rows])

  async function add(e){e.preventDefault();if(!form.figure||Number(form.qty)<=0)return alert('Elegí una figura y una cantidad válida.');const movement={...form,id:crypto.randomUUID(),component:form.component==='complete'?undefined:form.component,qty:Number(form.qty),createdAt:new Date().toISOString()};await onSave({...db,movements:[...(db.movements||[]),movement]});setForm({...form,qty:1,detail:''})}
  async function quick(figure,direction){
    const qty=Math.max(0,Number(quickQty[figure]||0))
    if(!qty)return alert('Ingresá una cantidad mayor a 0.')
    const positive=direction==='add'
    const component=quickPart[figure]||'complete'
    const isLoose=component==='tapa'||component==='base'
    const movement={id:crypto.randomUUID(),date:today(),figure,component:isLoose?component:undefined,type:isLoose?(positive?'Ajuste componente positivo':'Ajuste componente negativo'):(positive?'Ajuste positivo':'Ajuste negativo'),qty,detail:isLoose?`${positive?'Agregar':'Quitar'} ${component}${qty===1?'':'s'} suelta${component==='tapa'&&qty!==1?'s':''}`:(positive?'Ajuste manual: agregar figuras completas':'Ajuste manual: quitar figuras completas'),createdAt:new Date().toISOString()}
    await onSave({...db,movements:[...(db.movements||[]),movement]})
    setQuickQty(v=>({...v,[figure]:''}))
  }

  return <>
    <Title title="Inventario en tiempo real" sub="Muestra lo que ya está cortado, lo pedido, lo que está en máquina y si sobra o falta producir."/>
    <div className="inventory-kpis">
      <div className="panel"><small>CORTADAS AHORA</small><b>{totals.cut}</b><span>Piezas físicas registradas</span></div>
      <div className="panel"><small>PEDIDAS HOY / FUTURAS</small><b>{totals.ordered}</b><span>Comprometidas hasta su fecha de salida</span></div>
      <div className="panel"><small>EN CORTE</small><b>{totals.inCut}</b><span>Producción todavía no terminada</span></div>
      <div className={'panel '+(totals.free<0?'inventory-negative':'inventory-positive')}><small>SALDO ACTUAL</small><b>{totals.free>0?`+${totals.free}`:totals.free}</b><span>{totals.free<0?'Faltan piezas hoy':'Sobran piezas disponibles hoy'}</span></div>
      <div className={'panel '+(totals.projected<0?'inventory-negative':'inventory-positive')}><small>PROYECCIÓN</small><b>{totals.projected>0?`+${totals.projected}`:totals.projected}</b><span>Saldo cuando termine lo que está en corte</span></div>
    </div>
    <div className="notice inventory-explanation"><b>Inventario automático por fecha de salida</b><span>No hace falta marcar pedidos como <b>Entregados</b>. Durante el día de salida las piezas siguen en <b>Pedidas</b>. Al comenzar el día siguiente, ese pedido sale automáticamente de Pedidas y sus piezas se descuentan de <b>Cortadas</b>. Si el cliente no retira o el envío se posterga, reprogramá la fecha de salida para que las piezas sigan reservadas.</span></div>
    <div className="notice inventory-explanation"><b>Tapas y bases sueltas</b><span>Podés registrar partes por separado sin sumarlas como figura completa. Si hay más tapas que bases, el inventario te avisa cuántas bases faltan para emparejarlas, y viceversa.</span></div>
    <div className="notice inventory-explanation"><b>¿Qué significa Proyección?</b><span>Es el saldo futuro suponiendo que todas las placas que figuran <b>En corte</b> terminan correctamente. Fórmula: <b>Cortadas + En corte − Pedidas</b>. Ejemplo: tenés 10, te piden 14 y hay 6 en corte → proyección <b>+2</b>. Eso significa que, cuando termine la máquina, podrás cubrir los pedidos y sobrarán 2.</span></div>
    <div className="panel filters"><input type="search" placeholder="🔍 Buscar figura..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div className="panel table-wrap"><table className="inventory-table"><thead><tr><th>Figura</th><th>Cortadas</th><th>Tapas sueltas</th><th>Bases sueltas</th><th>Pedidas hoy/futuras</th><th>En corte</th><th>Saldo actual</th><th>Proyección</th><th>Ajuste</th></tr></thead><tbody>
      {rows.map(s=><tr key={s.figure}><td><b>{s.figure}</b>{s.missingPart&&<small className="inventory-part-warning">⚠ Falta{ s.missingPart.qty===1?'':'n'} {s.missingPart.qty} {s.missingPart.type}{s.missingPart.qty===1?'':'s'}</small>}{!s.missingPart&&s.loosePairs>0&&<small className="inventory-part-ok">✓ {s.loosePairs} par{s.loosePairs===1?'':'es'} suelto{s.loosePairs===1?'':'s'}</small>}</td><td className="green-text"><b>{s.cut}</b></td><td><b>{s.looseTapa}</b></td><td><b>{s.looseBase}</b></td><td>{s.ordered}</td><td className="purple-text">{s.inCut}</td><td className={s.free<0?'red-text':s.free>0?'green-text':'purple-text'}><b>{s.free>0?`+${s.free}`:s.free}</b><small className="inventory-state">{s.free<0?'Faltan':s.free>0?'Sobran':'Justo'}</small></td><td className={s.projected<0?'red-text':s.projected>0?'green-text':'purple-text'}><b>{s.projected>0?`+${s.projected}`:s.projected}</b></td><td><div className="stock-number-adjust"><select aria-label={`Qué ajustar en ${s.figure}`} value={quickPart[s.figure]||'complete'} onChange={e=>setQuickPart(v=>({...v,[s.figure]:e.target.value}))}><option value="complete">Figura completa</option><option value="tapa">Tapa suelta</option><option value="base">Base suelta</option></select><input aria-label={`Cantidad para ajustar ${s.figure}`} type="number" min="1" inputMode="numeric" placeholder="Cantidad" value={quickQty[s.figure]??''} onChange={e=>setQuickQty(v=>({...v,[s.figure]:e.target.value}))}/><div className="stock-number-actions"><button type="button" className="primary smallbtn" onClick={()=>quick(s.figure,'add')}>＋ Agregar</button><button type="button" className="ghost smallbtn" onClick={()=>quick(s.figure,'remove')}>− Quitar</button></div></div></td></tr>)}
    </tbody></table></div>
    <form className="panel" onSubmit={add}><h3>Movimiento manual</h3><div className="form-grid">
      <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
      <Field label="Figura"><input list="stockfigures" value={form.figure} onChange={e=>setForm({...form,figure:e.target.value})}/><datalist id="stockfigures">{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist></Field>
      <Field label="Parte"><select value={form.component} onChange={e=>setForm({...form,component:e.target.value})}><option value="complete">Figura completa</option><option value="tapa">Tapa suelta</option><option value="base">Base suelta</option></select></Field>
      <Field label="Movimiento"><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{['Entrada extra','Salida manual','Ajuste positivo','Ajuste negativo'].map(x=><option key={x}>{x}</option>)}</select></Field>
      <Field label="Cantidad"><input type="number" min="1" value={form.qty} onChange={e=>setForm({...form,qty:e.target.value})}/></Field>
    </div><Field label="Detalle"><input value={form.detail} onChange={e=>setForm({...form,detail:e.target.value})}/></Field><button className="primary">Guardar movimiento</button></form>
  </>
}
