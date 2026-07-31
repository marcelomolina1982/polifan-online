import React, { useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { today } from '../lib/format'
import { stockRows } from '../lib/inventory'

export default function Stock({db,onSave}){
  const [form,setForm]=useState({date:today(),figure:db.figures[0]||'',type:'Entrada extra',qty:1,detail:''})
  const [search,setSearch]=useState('')
  const rows=stockRows(db).filter(r=>r.figure.toLowerCase().includes(search.toLowerCase()))
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])

  async function add(e){
    e.preventDefault()
    if(!form.figure||Number(form.qty)<=0)return alert('Elegí una figura y una cantidad válida.')
    const movement={...form,id:crypto.randomUUID(),qty:Number(form.qty),createdAt:new Date().toISOString()}
    await onSave({...db,movements:[...(db.movements||[]),movement]})
    setForm({...form,qty:1,detail:''})
  }

  async function quick(figure,delta){
    const movement={id:crypto.randomUUID(),date:today(),figure,type:delta>0?'Ajuste positivo':'Ajuste negativo',qty:Math.abs(delta),detail:'Ajuste rápido',createdAt:new Date().toISOString()}
    await onSave({...db,movements:[...(db.movements||[]),movement]})
  }

  return <>
    <Title title="Inventario / Stock" sub="El saldo puede ser negativo: indica cuántas piezas faltan producir para cubrir los pedidos."/>
    <div className="notice"><b>Ejemplo</b><span>Si cargás un pedido de 3 pelotas y no tenés stock, verás −3. Al fabricar 3, vuelve a 0.</span></div>
    <div className="panel filters"><input type="search" placeholder="🔍 Buscar figura..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div className="panel table-wrap"><table><thead><tr><th>Figura</th><th>Ingresado/fabricado</th><th>Pedidos</th><th>Saldo</th><th>Ajuste rápido</th></tr></thead><tbody>
      {rows.map(s=><tr key={s.figure}><td><b>{s.figure}</b></td><td className="green-text">{s.available}</td><td>{s.ordered}</td><td className={s.total<0?'red-text':s.total>0?'green-text':'purple-text'}><b>{s.total}</b></td><td className="row-actions"><button className="ghost smallbtn" onClick={()=>quick(s.figure,-1)}>−1</button><button className="primary smallbtn" onClick={()=>quick(s.figure,1)}>+1</button></td></tr>)}
    </tbody></table></div>
    <form className="panel" onSubmit={add}><h3>Agregar o quitar piezas manualmente</h3><div className="form-grid">
      <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
      <Field label="Figura"><input list="stockfigures" value={form.figure} onChange={e=>setForm({...form,figure:e.target.value})}/><datalist id="stockfigures">{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist></Field>
      <Field label="Movimiento"><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{['Entrada extra','Salida manual','Ajuste positivo','Ajuste negativo'].map(x=><option key={x}>{x}</option>)}</select></Field>
      <Field label="Cantidad"><input type="number" min="1" value={form.qty} onChange={e=>setForm({...form,qty:e.target.value})}/></Field>
    </div><Field label="Detalle"><input value={form.detail} onChange={e=>setForm({...form,detail:e.target.value})}/></Field><button className="primary">Guardar movimiento</button></form>
  </>
}


