import React, { useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { today } from '../lib/format'

export default function CutBatches({db,onSave}){
  const blank=()=>({name:'Placa '+today(),date:today(),notes:'',multiplier:1,items:[{figure:'',component:'complete',qty:1}]})
  const [form,setForm]=useState(blank())
  const [editing,setEditing]=useState(null)
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])
  const activeSparrowTests=useMemo(()=>
    (db.cutBatches||[]).filter(b=>b.status==='En corte'&&String(b.name||'').startsWith('Placa automática Sparrow')),
    [db.cutBatches]
  )

  function updateItem(ix,key,value){
    setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:value}:it)}))
  }

  async function submit(e){
    e.preventDefault()
    const items=form.items.filter(i=>i.figure&&Number(i.qty)>0).map(i=>({...i,component:i.component||'complete',qty:Number(i.qty)}))
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
    const movements=(batch.items||[]).map(i=>{
      const component=i.component||'complete'
      return {
        id:crypto.randomUUID(),
        date:today(),
        figure:i.figure,
        ...(component==='complete'?{}:{component}),
        type:'Entrada de corte',
        qty:Number(i.qty)*multiplier,
        detail:`Placa #${batch.number} ${batch.name} · ${component==='complete'?'figura completa':component} · corte ${multiplier===2?'doble':'simple'}`,
        createdAt:new Date().toISOString()
      }
    })
    const cutBatches=(db.cutBatches||[]).map(b=>b.id===batch.id?{...b,status:'Terminada',finishedAt:new Date().toISOString()}:b)
    await onSave({...db,movements:[...(db.movements||[]),...movements],cutBatches})
  }

  async function cancel(batch){
    if(!confirm('¿Cancelar esta placa? Las piezas volverán a Pedidos para cortar.'))return
    await onSave({...db,cutBatches:(db.cutBatches||[]).map(b=>b.id===batch.id?{...b,status:'Cancelada'}:b)})
  }

  async function restoreSparrowTests(){
    if(!activeSparrowTests.length)return alert('No hay placas Sparrow de prueba activas para restaurar.')
    const preview=activeSparrowTests.map(b=>`#${b.number} · ${(b.items||[]).map(i=>`${i.figure} × ${Number(i.qty||0)*(Number(b.multiplier)||1)}`).join(', ')}`).join('\n')
    if(!confirm(`Se cancelarán ${activeSparrowTests.length} placa(s) automáticas Sparrow que quedaron como En corte durante las pruebas.\n\n${preview}\n\nEsto NO borra pedidos ni stock físico: solamente devuelve esas piezas a “Para cortar”. Tus placas manuales no se modifican. ¿Continuar?`))return
    const ids=new Set(activeSparrowTests.map(b=>b.id))
    const now=new Date().toISOString()
    const cutBatches=(db.cutBatches||[]).map(b=>ids.has(b.id)?{...b,status:'Cancelada',cancelledAt:now,cancelReason:'Restaurada después de prueba del motor Sparrow'}:b)
    const result=await onSave({...db,cutBatches})
    if(result?.ok!==false)alert(`Listo. Se restauraron ${activeSparrowTests.length} placa(s) de prueba. Las piezas vuelven a figurar en “Para cortar”.`)
  }

  function edit(batch){
    setEditing(batch)
    setForm({name:batch.name,date:batch.date,notes:batch.notes||'',multiplier:Number(batch.multiplier)||1,items:JSON.parse(JSON.stringify(batch.items||[]))})
    window.scrollTo({top:0,behavior:'smooth'})
  }

  return <>
    <Title title="En corte" sub="Registrá exactamente las piezas que entran en cada placa o tanda de corte." actions={activeSparrowTests.length?<button type="button" className="danger" onClick={restoreSparrowTests}>↩ Restaurar pruebas Sparrow ({activeSparrowTests.length})</button>:null}/>
    {activeSparrowTests.length>0&&<div className="notice"><b>Pruebas del motor detectadas</b><span>Hay {activeSparrowTests.length} placa(s) automáticas Sparrow figurando como En corte. Mientras estén activas descuentan piezas de “Para cortar”. Podés restaurarlas con el botón de arriba sin modificar tus placas manuales ni el stock físico.</span></div>}
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
        <select value={it.component||'complete'} onChange={e=>updateItem(ix,'component',e.target.value)} aria-label="Parte a cortar">
          <option value="complete">Figura completa</option>
          <option value="tapa">Tapa</option>
          <option value="base">Base</option>
        </select>
        <input type="number" min="1" value={it.qty} onChange={e=>updateItem(ix,'qty',e.target.value)}/>
        <button type="button" className="danger smallbtn" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,i)=>i!==ix)}))}>×</button>
      </div>)}
      <button type="button" className="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{figure:'',component:'complete',qty:1}]}))}>＋ Agregar pieza</button>
      <Field label="Notas"><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
      <div className="actions"><button className="primary">{editing?'Guardar cambios':'Guardar placa'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{setEditing(null);setForm(blank())}}>Cancelar</button>}</div>
    </form>
    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Fecha</th><th>Piezas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {(db.cutBatches||[]).slice().reverse().map(b=><tr key={b.id}><td><b>#{b.number} · {b.name}</b><small className="block">{b.notes}</small></td><td>{b.date}</td><td>{(b.items||[]).map(i=>`${i.figure}${(i.component&&i.component!=='complete')?` · ${i.component}`:''} × ${Number(i.qty)*(Number(b.multiplier)||1)}`).join(', ')}<small className="block">Corte {(Number(b.multiplier)||1)===2?'doble':'simple'}</small></td><td><span className={'status-text '+(b.status==='En corte'?'low':'ok')}>{b.status}</span></td><td className="row-actions">{b.status==='En corte'&&<><button className="primary" onClick={()=>finish(b)}>Terminar</button><button className="ghost" onClick={()=>edit(b)}>Editar</button><button className="danger" onClick={()=>cancel(b)}>Cancelar</button></>}</td></tr>)}
      {!(db.cutBatches||[]).length&&<tr><td colSpan="5">Todavía no hay placas registradas.</td></tr>}
    </tbody></table></div>
  </>
}
