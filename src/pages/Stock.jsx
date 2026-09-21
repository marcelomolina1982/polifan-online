import React,{useEffect,useMemo,useState} from 'react'
import StockBase from './StockBase'
import {automaticOrderOutflow,looseComponentBalance,manualBalance,stockRows} from '../lib/inventory'
import {today} from '../lib/format'

const RECOUNT_ID='inventario-fisico-2026-08-14-v1'
export default function Stock(props){
  const {db,onSave}=props
  const [bulkMode,setBulkMode]=useState(false)
  const [bulkSearch,setBulkSearch]=useState('')
  const [bulkValues,setBulkValues]=useState({})
  const [bulkSaving,setBulkSaving]=useState(false)
  const physicalRows=useMemo(()=>stockRows(db).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'})),[db])
  // Sólo amplía las opciones del selector de UNIFICAR. No modifica ni guarda el inventario.
  // Así también aparecen nombres históricos que existen como filas físicas (ej. "chop" y "Chopp").
  const mergeDb=useMemo(()=>({...db,figures:[...new Set([...(db.figures||[]),...physicalRows.map(r=>r.figure)])]}),[db,physicalRows])
  const visibleBulkRows=useMemo(()=>physicalRows.filter(r=>r.figure.toLowerCase().includes(bulkSearch.toLowerCase())),[physicalRows,bulkSearch])
  const changedCount=Object.keys(bulkValues).filter(f=>{
    const r=physicalRows.find(x=>x.figure===f)||{}
    const v=bulkValues[f]||{}
    return Number(v.complete??r.cut??0)!==Number(r.cut||0)||Number(v.tapa??r.looseTapa??0)!==Number(r.looseTapa||0)||Number(v.base??r.looseBase??0)!==Number(r.looseBase||0)
  }).length

  function startBulk(){
    const initial={}
    physicalRows.forEach(r=>{initial[r.figure]={complete:Number(r.cut||0),tapa:Number(r.looseTapa||0),base:Number(r.looseBase||0)}})
    setBulkValues(initial);setBulkMode(true)
  }

  function setBulk(figure,key,value){
    const n=Math.max(0,Number(value||0))
    setBulkValues(v=>({...v,[figure]:{...(v[figure]||{}),[key]:n}}))
  }

  async function saveBulk(){
    if(!changedCount)return alert('No hay cambios para guardar.')
    if(!window.confirm(`Vas a guardar ${changedCount} figura${changedCount===1?'':'s'} ajustada${changedCount===1?'':'s'} según el recuento físico.\n\nEsto modifica sólo el stock físico. No cambia pedidos, fechas ni catálogo. ¿Continuar?`))return
    setBulkSaving(true)
    try{
      const rawManual=manualBalance(db),autoOut=automaticOrderOutflow(db),rawLoose=looseComponentBalance(db)
      const movements=[...(db.movements||[])]
      const now=new Date().toISOString(),date=today()
      for(const r of physicalRows){
        const wanted=bulkValues[r.figure]||{complete:r.cut||0,tapa:r.looseTapa||0,base:r.looseBase||0}
        for(const component of ['tapa','base']){
          const current=Math.max(0,Number(rawLoose[r.figure]?.[component]||0))
          const desired=Math.max(0,Number(wanted[component]||0))
          const delta=desired-current
          if(delta!==0)movements.push({id:crypto.randomUUID(),date,figure:r.figure,component,type:delta>0?'Ajuste componente positivo':'Ajuste componente negativo',qty:Math.abs(delta),detail:`REAJUSTE MASIVO · fijar ${component}s sueltas en ${desired}`,createdAt:now})
        }
        const currentManual=Number(rawManual[r.figure]||0)
        const desiredManual=Math.max(0,Number(wanted.complete||0))+Number(autoOut[r.figure]||0)
        const delta=desiredManual-currentManual
        if(delta!==0)movements.push({id:crypto.randomUUID(),date,figure:r.figure,type:delta>0?'Ajuste positivo':'Ajuste negativo',qty:Math.abs(delta),detail:`REAJUSTE MASIVO · fijar figuras completas en ${Math.max(0,Number(wanted.complete||0))}`,createdAt:now})
      }
      const result=await onSave({...db,movements})
      if(result?.ok===false)return alert('No se pudo guardar el reajuste. No cierres la pantalla y volvé a intentar.')
      setBulkMode(false);setBulkValues({});alert('✅ Inventario reajustado y guardado en una sola operación.')
    }finally{setBulkSaving(false)}
  }

  useEffect(()=>{
    const clean=()=>document.querySelectorAll('.inventory-page .inventory-explanation').forEach(el=>{if(el.textContent?.toLocaleLowerCase('es').includes('proyección'))el.style.display='none'})
    clean();const observer=new MutationObserver(clean);const root=document.querySelector('.inventory-page');if(root)observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect()
  },[])


  // El cierre histórico del 14/08 ya no se ejecuta automáticamente al abrir Inventario.
  // Es una migración destructiva (cambia estados de pedidos y agrega movimientos), por lo que
  // no debe bloquear ni alterar una pantalla de consulta. Si ya fue aplicado, se respeta tal cual.
  // Si quedó pendiente en una base antigua, el inventario igualmente carga con sus datos actuales.

  return <div className="inventory-page"><style>{`
    .inventory-page .inventory-kpis > .panel:nth-child(5){display:none!important}
    .inventory-page .inventory-table th:nth-child(8),.inventory-page .inventory-table td:nth-child(8){display:none!important}
    .bulk-recount{margin:14px 0;padding:16px}.bulk-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.bulk-table-wrap{overflow:auto;max-height:62vh;margin-top:12px}.bulk-table{width:100%;border-collapse:collapse}.bulk-table th,.bulk-table td{padding:8px;border-bottom:1px solid #ddd;text-align:left}.bulk-table input{width:88px}.bulk-actions{position:sticky;bottom:0;background:var(--panel,#fff);padding:12px 0;display:flex;gap:10px;justify-content:flex-end}.bulk-badge{font-weight:700}
  `}</style>
    {!bulkMode&&<div className="panel bulk-recount"><div className="bulk-head"><div><h3>🧮 Reajuste masivo de inventario</h3><p className="muted">Cargá todo el recuento físico y guardalo una sola vez al terminar.</p></div><button type="button" className="primary" onClick={startBulk}>Abrir reajuste masivo</button></div></div>}

    {bulkMode&&<div className="panel bulk-recount"><div className="bulk-head"><div><h3>🧮 Reajuste masivo</h3><p className="muted">Nada se guarda hasta que pulses “Guardar todo el inventario”.</p></div><div className="bulk-badge">Cambios: {changedCount}</div></div><input style={{width:'100%',marginTop:10}} type="search" placeholder="Buscar figura..." value={bulkSearch} onChange={e=>setBulkSearch(e.target.value)}/><div className="bulk-table-wrap"><table className="bulk-table"><thead><tr><th>Figura</th><th>Completas</th><th>Tapas sueltas</th><th>Bases sueltas</th></tr></thead><tbody>{visibleBulkRows.map(r=>{const v=bulkValues[r.figure]||{};return <tr key={r.figure}><td><b>{r.figure}</b></td><td><input type="number" min="0" value={v.complete??r.cut??0} onChange={e=>setBulk(r.figure,'complete',e.target.value)}/></td><td><input type="number" min="0" value={v.tapa??r.looseTapa??0} onChange={e=>setBulk(r.figure,'tapa',e.target.value)}/></td><td><input type="number" min="0" value={v.base??r.looseBase??0} onChange={e=>setBulk(r.figure,'base',e.target.value)}/></td></tr>})}</tbody></table></div><div className="bulk-actions"><button type="button" onClick={()=>{if(changedCount&&!window.confirm('Descartar todos los cambios del reajuste?'))return;setBulkMode(false);setBulkValues({})}} disabled={bulkSaving}>Cancelar cambios</button><button type="button" className="primary" onClick={saveBulk} disabled={bulkSaving||!changedCount}>{bulkSaving?'Guardando…':`💾 Guardar todo el inventario (${changedCount})`}</button></div></div>}

    {!bulkMode&&<StockBase {...props} db={mergeDb}/>} 
  </div>
}