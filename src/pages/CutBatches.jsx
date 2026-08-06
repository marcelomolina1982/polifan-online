import React, { useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { today } from '../lib/format'

export default function CutBatches({db,onSave}){
  const blank=()=>({name:'Placa '+today(),date:today(),notes:'',multiplier:1,items:[{figure:'',qty:1}]})
  const [form,setForm]=useState(blank())
  const [editing,setEditing]=useState(null)
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])

  function updateItem(ix,key,value){
    setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:value}:it)}))
  }

  async function submit(e){
    e.preventDefault()
    const items=form.items.filter(i=>i.figure&&Number(i.qty)>0).map(i=>({...i,qty:Number(i.qty)}))
    if(!items.length)return alert('Agregá al menos una figura.')
    if(editing){
      const cutBatches=(db.cutBatches||[]).map(b=>b.id===editing.id?{...b,...form,items,updatedAt:new Date().toISOString()}:b)
      await onSave({...db,cutBatches})
    }else{
      const batch={...form,items,id:crypto.randomUUID(),number:String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0'),status:'En corte',createdAt:new Date().toISOString()}
      await onSave({...db,cutBatches:[...(db.cutBatches||[]),batch]})
    }
    setEditing(null);setForm(blank())
  }

  async function finish(batch){
    if(!confirm('¿Marcar esta placa como terminada y sumar sus piezas al inventario?'))return
    const multiplier=Math.max(1,Number(batch.multiplier)||1)
    const movements=(batch.items||[]).map(i=>({
      id:crypto.randomUUID(),date:today(),figure:i.figure,type:'Entrada de corte',qty:Number(i.qty)*multiplier,detail:`Placa #${batch.number} ${batch.name} · corte ${multiplier===2?'doble':'simple'}`,createdAt:new Date().toISOString()
    }))
    const cutBatches=(db.cutBatches||[]).map(b=>b.id===batch.id?{...b,status:'Terminada',finishedAt:new Date().toISOString()}:b)
    await onSave({...db,movements:[...(db.movements||[]),...movements],cutBatches})
  }

  async function cancel(batch){
    if(!confirm('¿Cancelar esta placa? Las piezas volverán a Pedidos para cortar.'))return
    await onSave({...db,cutBatches:(db.cutBatches||[]).map(b=>b.id===batch.id?{...b,status:'Cancelada'}:b)})
  }

  function edit(batch){
    setEditing(batch)
    setForm({name:batch.name,date:batch.date,notes:batch.notes||'',multiplier:Number(batch.multiplier)||1,items:JSON.parse(JSON.stringify(batch.items||[]))})
    window.scrollTo({top:0,behavior:'smooth'})
  }

  return <>
    <Title title="En corte" sub="Registrá exactamente las piezas que entran en cada placa o tanda de corte."/>
    <form className="panel" onSubmit={submit}>
      <h3>{editing?'Editar placa':'Nueva placa de corte'}</h3>
      <div className="form-grid">
        <Field label="Nombre"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
        <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
        <Field label="Tipo de corte"><select value={form.multiplier||1} onChange={e=>setForm({...form,multiplier:Number(e.target.value)})}><option value="1">Simple · 1 placa</option><option value="2">Doble · 2 placas iguales</option></select></Field>
      </div>
      {form.items.map((it,ix)=><div className="item-row" key={ix}>
        <input list={`cutfig-${ix}`} placeholder="🔍 Buscar figura" value={it.figure} onChange={e=>updateItem(ix,'figure',e.target.value)}/>
        <datalist id={`cutfig-${ix}`}>{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist>
        <input type="number" min="1" value={it.qty} onChange={e=>updateItem(ix,'qty',e.target.value)}/>
        <button type="button" className="danger smallbtn" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,i)=>i!==ix)}))}>×</button>
      </div>)}
      <button type="button" className="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{figure:'',qty:1}]}))}>＋ Agregar figura</button>
      <Field label="Notas"><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
      <div className="actions"><button className="primary">{editing?'Guardar cambios':'Guardar placa'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{setEditing(null);setForm(blank())}}>Cancelar</button>}</div>
    </form>
    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Fecha</th><th>Piezas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {(db.cutBatches||[]).slice().reverse().map(b=><tr key={b.id}><td><b>#{b.number} · {b.name}</b><small className="block">{b.notes}</small></td><td>{b.date}</td><td>{(b.items||[]).map(i=>`${i.figure} × ${Number(i.qty)*(Number(b.multiplier)||1)}`).join(', ')}<small className="block">Corte {(Number(b.multiplier)||1)===2?'doble':'simple'}</small></td><td><span className={'status-text '+(b.status==='En corte'?'low':'ok')}>{b.status}</span></td><td className="row-actions">{b.status==='En corte'&&<><button className="primary" onClick={()=>finish(b)}>Terminar</button><button className="ghost" onClick={()=>edit(b)}>Editar</button><button className="danger" onClick={()=>cancel(b)}>Cancelar</button></>}</td></tr>)}
      {!(db.cutBatches||[]).length&&<tr><td colSpan="5">Todavía no hay placas registradas.</td></tr>}
    </tbody></table></div>
  </>
}

