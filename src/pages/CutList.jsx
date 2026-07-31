import React from 'react'
import { Title } from '../components/UI'
import { today } from '../lib/format'
import { pendingCutRows } from '../lib/inventory'

export default function CutList({db,onSave,goBatches}){
  const rows=pendingCutRows(db).sort((a,b)=>b.pending-a.pending)

  async function createSuggested(){
    if(!rows.length)return alert('No hay piezas pendientes para enviar a corte.')
    const batch={
      id:crypto.randomUUID(),
      number:String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0'),
      date:today(),
      name:'Placa sugerida '+today(),
      status:'En corte',
      notes:'Generada automáticamente desde las piezas pendientes.',
      items:rows.map(r=>({figure:r.figure,qty:r.pending})),
      createdAt:new Date().toISOString()
    }
    await onSave({...db,cutBatches:[...(db.cutBatches||[]),batch]})
    if(confirm('Placa sugerida creada. ¿Ir a la sección En corte para revisarla?')) goBatches()
  }

  return <>
    <Title title="Pedidos para cortar" sub="Muestra únicamente lo que falta producir, descontando el inventario disponible y lo que ya está en corte." actions={<div className="actions"><button className="primary" onClick={createSuggested}>Crear placa sugerida</button><button className="ghost" onClick={()=>window.print()}>Imprimir</button></div>}/>
    <div className="notice"><b>Cálculo automático</b><span>Pedido − inventario − piezas actualmente en corte.</span></div>
    <div className="panel table-wrap"><table><thead><tr><th>Figura</th><th>Stock actual</th><th>En corte</th><th>Falta cortar</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.figure}><td><b>{r.figure}</b></td><td className={r.total<0?'red-text':'green-text'}>{r.total}</td><td className="purple-text">{r.inCut}</td><td className="big">{r.pending}</td></tr>)}
      {!rows.length&&<tr><td colSpan="4">No hay figuras pendientes para cortar.</td></tr>}
    </tbody></table></div>
  </>
}

