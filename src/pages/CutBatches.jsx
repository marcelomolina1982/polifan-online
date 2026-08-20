import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Title, Field } from '../components/UI'
import { today } from '../lib/format'

export default function CutBatches({db,onSave}){
  const blank=()=>({name:'Placa '+today(),date:today(),notes:'',multiplier:1,items:[{figure:'',component:'complete',qty:1}]})
  const [form,setForm]=useState(blank())
  const [editing,setEditing]=useState(null)
  const autoFinishRef=useRef(false)
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])

  function updateItem(ix,key,value){
    setForm(f=>({...f,items:f.items.map((it,i)=>i===ix?{...it,[key]:value}:it)}))
  }

  function movementForItem(batch,item,sign=1,detailPrefix='Placa terminada'){
    const multiplier=Math.max(1,Number(batch.multiplier)||1)
    const component=item.component||'complete'
    const qty=Math.max(0,Number(item.qty||0)*multiplier)
    if(!qty)return null
    const positive=sign>0
    return {
      id:crypto.randomUUID(),
      batchId:batch.id,
      date:today(),
      figure:item.figure,
      ...(component==='complete'?{}:{component}),
      type:component==='complete'?(positive?'Entrada de corte':'Ajuste negativo'):(positive?'Ajuste componente positivo':'Ajuste componente negativo'),
      qty,
      detail:`${detailPrefix} · Placa #${batch.number} ${batch.name} · ${component==='complete'?'figura completa':component} · corte ${multiplier===2?'doble':'simple'}`,
      createdAt:new Date().toISOString()
    }
  }

  function inventoryMovements(batch,sign=1,detailPrefix='Placa terminada'){
    return (batch.items||[]).map(i=>movementForItem(batch,i,sign,detailPrefix)).filter(Boolean)
  }

  useEffect(()=>{
    if(autoFinishRef.current)return
    const pending=(db.cutBatches||[]).filter(b=>b.status==='En corte' && String(b.name||'').startsWith('Placa automática Sparrow'))
    if(!pending.length)return
    autoFinishRef.current=true
    ;(async()=>{
      const now=new Date().toISOString()
      const ids=new Set(pending.map(b=>b.id))
      const movements=[...(db.movements||[])]
      pending.forEach(batch=>movements.push(...inventoryMovements(batch,1,'Alta automática desde SVG')))
      const cutBatches=(db.cutBatches||[]).map(b=>ids.has(b.id)?{...b,status:'Terminada',finishedAt:now,autoFinished:true}:b)
      const result=await onSave({...db,movements,cutBatches})
      if(result?.ok===false)autoFinishRef.current=false
    })()
  },[db.cutBatches,db.movements,onSave])

  async function submit(e){
    e.preventDefault()
    const items=form.items.filter(i=>i.figure&&Number(i.qty)>0).map(i=>({...i,component:i.component||'complete',qty:Number(i.qty)}))
    if(!items.length)return alert('Agregá al menos una figura.')
    let saved
    if(editing){
      const updated={...editing,...form,items,updatedAt:new Date().toISOString()}
      let movements=[...(db.movements||[])]
      if(editing.status==='Terminada'){
        movements.push(...inventoryMovements(editing,-1,'Corrección: retirar contenido anterior'))
        movements.push(...inventoryMovements(updated,1,'Corrección: ingresar contenido modificado'))
      }
      const cutBatches=(db.cutBatches||[]).map(b=>b.id===editing.id?updated:b)
      saved=await onSave({...db,movements,cutBatches})
    }else{
      const batch={...form,items,id:crypto.randomUUID(),number:String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0'),status:'En corte',createdAt:new Date().toISOString()}
      saved=await onSave({...db,cutBatches:[...(db.cutBatches||[]),batch]})
    }
    if(saved?.ok===false)return
    setEditing(null);setForm(blank())
  }

  async function finish(batch){
    if(!confirm('¿Marcar esta placa como terminada y sumar sus piezas al inventario?'))return
    const movements=inventoryMovements(batch,1,'Placa terminada')
    const cutBatches=(db.cutBatches||[]).map(b=>b.id===batch.id?{...b,status:'Terminada',finishedAt:new Date().toISOString()}:b)
    await onSave({...db,movements:[...(db.movements||[]),...movements],cutBatches})
  }

  async function cancel(batch){
    const wasFinished=batch.status==='Terminada'
    const message=wasFinished
      ?'¿Anular este corte terminado? Se retirarán del inventario exactamente las piezas que esta placa había sumado.'
      :'¿Cancelar esta placa? Las piezas volverán a Pedidos para cortar.'
    if(!confirm(message))return
    const reversals=wasFinished?inventoryMovements(batch,-1,'Corte anulado: retirar del inventario'):[]
    const cutBatches=(db.cutBatches||[]).map(b=>b.id===batch.id?{...b,status:'Cancelada',cancelledAt:new Date().toISOString()}:b)
    await onSave({...db,movements:[...(db.movements||[]),...reversals],cutBatches})
  }

  function edit(batch){
    setEditing(batch)
    setForm({name:batch.name,date:batch.date,notes:batch.notes||'',multiplier:Number(batch.multiplier)||1,items:JSON.parse(JSON.stringify(batch.items||[]))})
    window.scrollTo({top:0,behavior:'smooth'})
  }

  return <>
    <Title title="En corte" sub="Las placas automáticas de Sparrow pasan a Terminadas al ingresar y suman su producción al inventario. Después podés modificarlas o anularlas y el stock se corrige automáticamente."/>
    <form className="panel" onSubmit={submit}>
      <h3>{editing?`Modificar placa #${editing.number}`:'Nueva placa de corte'}</h3>
      {editing?.status==='Terminada'&&<div className="notice"><b>Placa ya terminada</b><span>Al guardar cambios, la app quitará del inventario el contenido anterior y cargará el nuevo automáticamente.</span></div>}
      <div className="form-grid">
        <Field label="Nombre"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
        <Field label="Fecha"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
        <Field label="Tipo de corte"><select value={form.multiplier||1} onChange={e=>setForm({...form,multiplier:Number(e.target.value)})}><option value="1">Simple · 1 placa</option><option value="2">Doble · 2 placas iguales</option></select></Field>
      </div>
      {form.items.map((it,ix)=><div className="item-row" key={ix}>
        <input list={`cutfig-${ix}`} placeholder="🔍 Buscar figura" value={it.figure} onChange={e=>updateItem(ix,'figure',e.target.value)}/>
        <datalist id={`cutfig-${ix}`}>{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist>
        <select value={it.component||'complete'} onChange={e=>updateItem(ix,'component',e.target.value)} aria-label="Parte a cortar"><option value="complete">Figura completa</option><option value="tapa">Tapa</option><option value="base">Base</option></select>
        <input type="number" min="1" value={it.qty} onChange={e=>updateItem(ix,'qty',e.target.value)}/>
        <button type="button" className="danger smallbtn" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,i)=>i!==ix)}))}>×</button>
      </div>)}
      <button type="button" className="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{figure:'',component:'complete',qty:1}]}))}>＋ Agregar pieza</button>
      <Field label="Notas"><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
      <div className="actions"><button className="primary">{editing?'Guardar modificación':'Guardar placa'}</button>{editing&&<button type="button" className="ghost" onClick={()=>{setEditing(null);setForm(blank())}}>Cancelar edición</button>}</div>
    </form>
    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Fecha</th><th>Piezas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {(db.cutBatches||[]).slice().reverse().map(b=><tr key={b.id}><td><b>#{b.number} · {b.name}</b><small className="block">{b.notes}</small></td><td>{b.date}</td><td>{(b.items||[]).map(i=>`${i.figure}${(i.component&&i.component!=='complete')?` · ${i.component}`:''} × ${Number(i.qty)*(Number(b.multiplier)||1)}`).join(', ')}<small className="block">Corte {(Number(b.multiplier)||1)===2?'doble':'simple'}</small></td><td><span className={'status-text '+(b.status==='En corte'?'low':b.status==='Cancelada'?'':'ok')}>{b.status}</span></td><td className="row-actions">{b.status==='En corte'&&<><button className="primary" onClick={()=>finish(b)}>Terminar</button><button className="ghost" onClick={()=>edit(b)}>Modificar</button><button className="danger" onClick={()=>cancel(b)}>Cancelar</button></>}{b.status==='Terminada'&&<><button className="ghost" onClick={()=>edit(b)}>Modificar</button><button className="danger" onClick={()=>cancel(b)}>Anular corte</button></>}</td></tr>)}
      {!(db.cutBatches||[]).length&&<tr><td colSpan="5">Todavía no hay placas registradas.</td></tr>}
    </tbody></table></div>
  </>
}
