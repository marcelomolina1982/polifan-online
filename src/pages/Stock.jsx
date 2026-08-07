import React, { useMemo, useState } from 'react'
import { Title, Field } from '../components/UI'
import { today } from '../lib/format'
import { stockRows, duplicateFigureGroups, mergeDuplicateFigures, catalogFigureInfo, mergeFigureInto } from '../lib/inventory'

export default function Stock({db,onSave}){
  const [form,setForm]=useState({date:today(),figure:db.figures[0]||'',component:'complete',type:'Entrada extra',qty:1,detail:''})
  const [search,setSearch]=useState('')
  const [quickQty,setQuickQty]=useState({})
  const [quickPart,setQuickPart]=useState({})
  const [mergeA,setMergeA]=useState('')
  const [mergeB,setMergeB]=useState('')
  const [mergeKeep,setMergeKeep]=useState('')
  const rows=stockRows(db).filter(r=>r.figure.toLowerCase().includes(search.toLowerCase()))
  const sortedFigures=useMemo(()=>[...new Set([...(db.figures||[]),...(db.customerCatalog||[]).map(p=>p.name).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures,db.customerCatalog])
  const duplicateGroups=useMemo(()=>duplicateFigureGroups(db),[db])
  const mergeInfoA=useMemo(()=>catalogFigureInfo(db,mergeA),[db,mergeA])
  const mergeInfoB=useMemo(()=>catalogFigureInfo(db,mergeB),[db,mergeB])
  const selectedKeep=useMemo(()=>{if(mergeInfoA.isCatalog&&!mergeInfoB.isCatalog)return mergeA;if(mergeInfoB.isCatalog&&!mergeInfoA.isCatalog)return mergeB;return mergeKeep||mergeA},[mergeA,mergeB,mergeKeep,mergeInfoA.isCatalog,mergeInfoB.isCatalog])
  const selectedSource=selectedKeep===mergeA?mergeB:mergeA
  const rowByFigure=useMemo(()=>Object.fromEntries(stockRows(db).map(r=>[r.figure,r])),[db])
  const totals=useMemo(()=>rows.reduce((a,r)=>({cut:a.cut+r.cut,ordered:a.ordered+r.ordered,inCut:a.inCut+r.inCut,free:a.free+r.free,projected:a.projected+r.projected}),{cut:0,ordered:0,inCut:0,free:0,projected:0}),[rows])

  async function add(e){e.preventDefault();if(!form.figure||Number(form.qty)<=0)return alert('Elegí una figura y una cantidad válida.');const movement={...form,id:crypto.randomUUID(),component:form.component==='complete'?undefined:form.component,qty:Number(form.qty),createdAt:new Date().toISOString()};await onSave({...db,movements:[...(db.movements||[]),movement]});setForm({...form,qty:1,detail:''})}
  async function cleanDuplicates(){
    if(!duplicateGroups.length)return alert('No se encontraron nombres duplicados en el inventario.')
    const preview=duplicateGroups.slice(0,12).map(g=>`• ${g.names.join(' / ')} → ${g.canonical}${g.fromCatalog?' (catálogo)':''}`).join('\n')
    const extra=duplicateGroups.length>12?`\n… y ${duplicateGroups.length-12} grupo(s) más.`:''
    if(!window.confirm(`Se unificarán ${duplicateGroups.length} grupo(s) duplicados.\n\n${preview}${extra}\n\nSe conservará el nombre del catálogo cuando exista. Los pedidos, movimientos y piezas en corte pasarán automáticamente al nombre principal. ¿Continuar?`))return
    const result=mergeDuplicateFigures(db)
    const saved=await onSave(result.db)
    if(saved?.ok!==false)alert(`Listo. Se unificaron ${result.groups.length} grupo(s) y se eliminaron ${result.changes} nombre(s) duplicados sin perder pedidos ni stock.`)
  }

  async function mergeManual(){
    if(!mergeA||!mergeB)return alert('Elegí las dos figuras que querés unificar.')
    if(mergeA===mergeB)return alert('Elegí dos figuras diferentes.')
    const infoA=catalogFigureInfo(db,mergeA),infoB=catalogFigureInfo(db,mergeB)
    let keep=selectedKeep
    if(infoA.isCatalog&&!infoB.isCatalog)keep=mergeA
    if(infoB.isCatalog&&!infoA.isCatalog)keep=mergeB
    const source=keep===mergeA?mergeB:mergeA
    const src=rowByFigure[source]||{},dst=rowByFigure[keep]||{}
    const catalogText=infoA.isCatalog&&infoB.isCatalog?'Las dos pertenecen al catálogo.':infoA.isCatalog?`${mergeA} es la del catálogo.`:infoB.isCatalog?`${mergeB} es la del catálogo.`:'Ninguna de las dos coincide con un nombre del catálogo.'
    const preview=`${catalogText}\n\nSe conservará: ${keep}\nSe eliminará del inventario: ${source}\n\nSe migrará desde ${source}:\n• Cortadas: ${Number(src.cut||0)}\n• Pedidas: ${Number(src.ordered||0)}\n• En corte: ${Number(src.inCut||0)}\n• Tapas sueltas: ${Number(src.looseTapa||0)}\n• Bases sueltas: ${Number(src.looseBase||0)}\n\nTodo se sumará/unificará con lo que ya tenga ${keep}. ¿Continuar?`
    if(!window.confirm(preview))return
    const result=mergeFigureInto(db,source,keep)
    if(result.error)return alert(result.error)
    const saved=await onSave(result.db)
    if(saved?.ok!==false){
      setMergeA('');setMergeB('');setMergeKeep('')
      alert(`Listo. ${source} se unificó dentro de ${keep}. Se migraron stock, pedidos, piezas en corte, tapas/bases y referencias relacionadas.`)
    }
  }

  async function quick(figure,direction){
    const qty=Math.max(0,Number(quickQty[figure]||0))
    if(!qty)return alert('Ingresá una cantidad mayor a 0.')
    const positive=direction==='add'
    const component=quickPart[figure]||'complete'
    const isPart=component==='tapa'||component==='base'

    if(!positive&&isPart){
      const row=rowByFigure[figure]||{}
      const looseAvailable=component==='tapa'?Number(row.looseTapa||0):Number(row.looseBase||0)
      const fromLoose=Math.min(qty,looseAvailable)
      const remaining=qty-fromLoose
      const completeAvailable=Math.max(0,Number(row.cut||0))
      if(remaining>completeAvailable){
        return alert(`No hay suficientes ${component}s para quitar. Tenés ${looseAvailable} ${component}${looseAvailable===1?'':'s'} suelta${looseAvailable===1?'':'s'} y ${completeAvailable} figura${completeAvailable===1?'':'s'} completa${completeAvailable===1?'':'s'} disponible${completeAvailable===1?'':'s'}.`)
      }

      const now=new Date().toISOString()
      const movements=[]
      if(fromLoose>0){
        movements.push({
          id:crypto.randomUUID(),date:today(),figure,component,
          type:'Ajuste componente negativo',qty:fromLoose,
          detail:`Quitar ${fromLoose} ${component}${fromLoose===1?'':'s'} suelta${fromLoose===1?'':'s'}`,
          createdAt:now
        })
      }
      if(remaining>0){
        const opposite=component==='tapa'?'base':'tapa'
        // Desarmar una figura completa: baja una completa y deja la otra mitad como pieza suelta.
        movements.push({
          id:crypto.randomUUID(),date:today(),figure,
          type:'Ajuste negativo',qty:remaining,
          detail:`Desarmado: se quitaron ${remaining} ${component}${remaining===1?'':'s'} de figura${remaining===1?'':'s'} completa${remaining===1?'':'s'}`,
          createdAt:now
        })
        movements.push({
          id:crypto.randomUUID(),date:today(),figure,component:opposite,
          type:'Ajuste componente positivo',qty:remaining,
          detail:`Parte recuperada al quitar ${component}: ${remaining} ${opposite}${remaining===1?'':'s'} suelta${remaining===1?'':'s'}`,
          createdAt:now
        })
      }
      await onSave({...db,movements:[...(db.movements||[]),...movements]})
      setQuickQty(v=>({...v,[figure]:''}))
      return
    }

    const movement={
      id:crypto.randomUUID(),date:today(),figure,
      component:isPart?component:undefined,
      type:isPart?(positive?'Ajuste componente positivo':'Ajuste componente negativo'):(positive?'Ajuste positivo':'Ajuste negativo'),
      qty,
      detail:isPart?`${positive?'Agregar':'Quitar'} ${component}${qty===1?'':'s'} suelta${qty===1?'':'s'}`:(positive?'Ajuste manual: agregar figuras completas':'Ajuste manual: quitar figuras completas'),
      createdAt:new Date().toISOString()
    }
    await onSave({...db,movements:[...(db.movements||[]),movement]})
    setQuickQty(v=>({...v,[figure]:''}))
  }

  return <>
    <Title title="Inventario en tiempo real" sub="Muestra lo que ya está cortado, lo pedido, lo que está en máquina y si sobra o falta producir."/>
    <div className="notice inventory-explanation"><b>Quitar una tapa o base</b><span>Si la parte está suelta, se descuenta directamente. Si ya forma parte de una figura completa, la app desarma esa figura: por ejemplo, quitar 1 tapa descuenta 1 figura completa y deja 1 base suelta.</span></div>
    <div className="notice inventory-explanation"><b>Armado automático de tapa + base</b><span>Cuando una figura tiene 1 tapa y 1 base sueltas, el inventario las convierte automáticamente en 1 figura completa. Las dos partes dejan de mostrarse como sueltas. La Proyección también tiene en cuenta las tapas y bases que todavía están En corte.</span></div>
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
    <div className={"notice inventory-explanation "+(duplicateGroups.length?"inventory-duplicate-alert":"")}><b>Duplicados del inventario</b><span>{duplicateGroups.length?`Encontré ${duplicateGroups.length} grupo(s) con el mismo nombre escrito de distintas maneras. Se conservará la versión vinculada al catálogo y se migrarán automáticamente los pedidos, movimientos y piezas en corte.`:'No se detectan nombres duplicados.'}</span>{duplicateGroups.length>0&&<button type="button" className="primary smallbtn" onClick={cleanDuplicates}>🧹 Unificar duplicados</button>}</div>
    <div className="panel inventory-manual-merge"><div className="inventory-manual-merge-head"><div><h3>🔗 Unificar dos figuras manualmente</h3><p className="muted">Usalo cuando sabés que dos nombres diferentes son la misma mercadería. La app te indica cuál pertenece al catálogo y migra todo al nombre que se conserva.</p></div></div><div className="inventory-merge-grid"><Field label="Figura 1"><select value={mergeA} onChange={e=>{setMergeA(e.target.value);setMergeKeep('')}}><option value="">Elegir figura...</option>{sortedFigures.map(f=><option key={`a-${f}`} value={f} disabled={f===mergeB}>{f}</option>)}</select>{mergeA&&<small className={mergeInfoA.isCatalog?'inventory-catalog-badge':'inventory-manual-badge'}>{mergeInfoA.isCatalog?'✓ Figura del catálogo':'Nombre manual / histórico'}</small>}</Field><Field label="Figura 2"><select value={mergeB} onChange={e=>{setMergeB(e.target.value);setMergeKeep('')}}><option value="">Elegir figura...</option>{sortedFigures.map(f=><option key={`b-${f}`} value={f} disabled={f===mergeA}>{f}</option>)}</select>{mergeB&&<small className={mergeInfoB.isCatalog?'inventory-catalog-badge':'inventory-manual-badge'}>{mergeInfoB.isCatalog?'✓ Figura del catálogo':'Nombre manual / histórico'}</small>}</Field><Field label="Nombre que se conserva"><select value={selectedKeep||''} onChange={e=>setMergeKeep(e.target.value)} disabled={(mergeInfoA.isCatalog&&!mergeInfoB.isCatalog)||(mergeInfoB.isCatalog&&!mergeInfoA.isCatalog)}><option value="">Elegir...</option>{mergeA&&<option value={mergeA}>{mergeA}{mergeInfoA.isCatalog?' · CATÁLOGO':''}</option>}{mergeB&&<option value={mergeB}>{mergeB}{mergeInfoB.isCatalog?' · CATÁLOGO':''}</option>}</select>{mergeA&&mergeB&&((mergeInfoA.isCatalog&&!mergeInfoB.isCatalog)||(mergeInfoB.isCatalog&&!mergeInfoA.isCatalog))&&<small>Se conserva automáticamente la figura del catálogo.</small>}</Field></div>{mergeA&&mergeB&&<div className="inventory-merge-summary"><div><b>{mergeA}</b><span>{Number(rowByFigure[mergeA]?.cut||0)} cortadas · {Number(rowByFigure[mergeA]?.ordered||0)} pedidas · {Number(rowByFigure[mergeA]?.inCut||0)} en corte</span></div><div className="inventory-merge-arrow">→</div><div><b>{mergeB}</b><span>{Number(rowByFigure[mergeB]?.cut||0)} cortadas · {Number(rowByFigure[mergeB]?.ordered||0)} pedidas · {Number(rowByFigure[mergeB]?.inCut||0)} en corte</span></div></div>}<button type="button" className="primary" disabled={!mergeA||!mergeB||!selectedKeep} onClick={mergeManual}>🔗 Unificar y migrar todo</button></div>
    <div className="panel filters"><input type="search" placeholder="🔍 Buscar figura..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div className="panel table-wrap"><table className="inventory-table"><thead><tr><th>Figura</th><th>Cortadas</th><th>Tapas sueltas</th><th>Bases sueltas</th><th>Pedidas hoy/futuras</th><th>En corte</th><th>Saldo actual</th><th>Proyección</th><th>Ajuste</th></tr></thead><tbody>
      {rows.map(s=><tr key={s.figure}><td><b>{s.figure}</b>{s.missingPart&&<small className="inventory-part-warning">⚠ Falta{ s.missingPart.qty===1?'':'n'} {s.missingPart.qty} {s.missingPart.type}{s.missingPart.qty===1?'':'s'}</small>}{!s.missingPart&&s.loosePairs>0&&<small className="inventory-part-ok">✓ {s.loosePairs} par{s.loosePairs===1?'':'es'} suelto{s.loosePairs===1?'':'s'}</small>}</td><td className="green-text"><b>{s.cut}</b></td><td><b>{s.looseTapa}</b></td><td><b>{s.looseBase}</b></td><td>{s.ordered}</td><td className="purple-text"><b>{s.inCut}</b>{(s.inCutTapa>0||s.inCutBase>0)&&<small className="inventory-state">{s.inCutTapa>0?`Tapas: ${s.inCutTapa}`:''}{s.inCutTapa>0&&s.inCutBase>0?' · ':''}{s.inCutBase>0?`Bases: ${s.inCutBase}`:''}</small>}</td><td className={s.free<0?'red-text':s.free>0?'green-text':'purple-text'}><b>{s.free>0?`+${s.free}`:s.free}</b><small className="inventory-state">{s.free<0?'Faltan':s.free>0?'Sobran':'Justo'}</small></td><td className={s.projected<0?'red-text':s.projected>0?'green-text':'purple-text'}><b>{s.projected>0?`+${s.projected}`:s.projected}</b></td><td><div className="stock-number-adjust"><select aria-label={`Qué ajustar en ${s.figure}`} value={quickPart[s.figure]||'complete'} onChange={e=>setQuickPart(v=>({...v,[s.figure]:e.target.value}))}><option value="complete">Figura completa</option><option value="tapa">Tapa suelta</option><option value="base">Base suelta</option></select><input aria-label={`Cantidad para ajustar ${s.figure}`} type="number" min="1" inputMode="numeric" placeholder="Cantidad" value={quickQty[s.figure]??''} onChange={e=>setQuickQty(v=>({...v,[s.figure]:e.target.value}))}/><div className="stock-number-actions"><button type="button" className="primary smallbtn" onClick={()=>quick(s.figure,'add')}>＋ Agregar</button><button type="button" className="ghost smallbtn" onClick={()=>quick(s.figure,'remove')}>− Quitar</button></div></div></td></tr>)}
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
