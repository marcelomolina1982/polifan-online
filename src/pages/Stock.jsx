import React,{useEffect,useMemo,useRef,useState} from 'react'
import StockBase from './StockBase'
import {automaticOrderOutflow,looseComponentBalance,manualBalance,normalizeFigureKey,stockRows} from '../lib/inventory'
import {today} from '../lib/format'

const RECOUNT_ID='inventario-fisico-2026-08-14-v1'
const RECOUNT_CUTOFF='2026-08-14'
const CLOSEOUT_ID='inventario-fisico-2026-08-14-cierre-v1'
const PHYSICAL_RECOUNT=[
  ['COPA DEL MUNDO',8,1,0],['CARAMELO',13,0,0],['OSO',1,0,0],['JESSIE',1,0,0],['TE AMO',1,0,0],['AUTO',2,0,0],['MINIONS',1,0,0],['SPIDERMAN',2,0,0],['SONIC',4,0,0],['CHANCHO',5,0,0],['DINO',10,0,0],['DINO CORAZON',2,0,0],['BOTIN',4,0,0],['ESCUDO RACING',2,0,0],['RUMMI',2,2,0],['UNICORNIO',1,0,2],
  ['PATO',0,0,1],['BABY SHARK',0,0,1],['ESCUDO RIVER',1,0,0],['MICKEY',1,0,0],['MINNIE',3,0,0],['CORAZON',1,0,0],['CAMISETA',1,0,0],['FELIZ DIA CORAZON',1,0,0],['CHOPP',4,0,0],['CARA DE PAPA',2,0,0],['STITCH COMPLETO',3,0,0],['MARCIANO',1,0,0],['GRACIAS',1,0,0],['OVEJA',1,0,0],['LETRA J',1,0,0],['FLOR DE CEREZO',1,0,0],['SEÑO CORAZON',2,0,0],['MANOS MICKEY',1,0,0],['WODY',3,0,0],['ARCO IRIS',5,0,0],['ESCUDO BOCA',6,0,0],['BESO',8,0,0],['INFINITO MAMA',3,0,0],['PICADA',5,0,0],['GATO',2,0,0],['TORTUGA NINJA',1,0,0],['ROMPE CABEZA CPRAZON',2,0,1],['MATE',2,0,0],['PALABRA MAMA IMPRENTA',5,0,0],['PERRO SALCHICHA',1,0,0],['MARIPOSA DIVISION',5,0,0],['CORAZON DIVISION',13,0,0],['FLOR SIMPLE',5,0,0],['FLOR CON TALLO',2,0,0],['PELOTA',4,0,0],['ABEJITA',2,0,0],['SKYE',1,0,0],['PLIM PLIM',2,0,0],['GOKU',1,0,0],['CORAZON MAMA',1,0,0],['CORAZON SEÑO',1,0,0],['KITTY',2,0,0],['CAMARA DE FOTO',1,0,0],['TAZA DE TE SEÑO',1,0,0],['LAPIZ',1,0,0],['MARGARITA',1,0,0]
]

const EXTRA_ALIASES={
  'wody':['woody'],
  'rompe cabeza cprazon':['rompe cabeza corazon','rompecabeza corazon','rompecabezas corazon'],
  'stitch completo':['stitch'],
  'camara de foto':['camara de fotos','camara'],
  'taza de te seño':['taza seño','taza de te seño'],
  'palabra mama imprenta':['mama imprenta','mama palabra imprenta'],
  'arco iris':['arcoiris'],
  'dino corazon':['dinosaurio corazon'],
  'flor de cerezo':['flor cerezo']
}

function allNames(db){
  const out=[]
  ;(db.figures||[]).forEach(x=>x&&out.push(String(x)))
  ;(db.customerCatalog||[]).forEach(x=>x?.name&&out.push(String(x.name)))
  ;(db.orders||[]).forEach(o=>(o.items||[]).forEach(i=>i?.figure&&out.push(String(i.figure))))
  ;(db.movements||[]).forEach(m=>m?.figure&&out.push(String(m.figure)))
  ;(db.cutBatches||[]).forEach(b=>(b.items||[]).forEach(i=>i?.figure&&out.push(String(i.figure))))
  return [...new Set(out)]
}

function resolveName(raw,names){
  const key=normalizeFigureKey(raw)
  const exact=names.find(n=>normalizeFigureKey(n)===key)
  if(exact)return exact
  for(const alias of (EXTRA_ALIASES[key]||[])){
    const hit=names.find(n=>normalizeFigureKey(n)===normalizeFigureKey(alias))
    if(hit)return hit
  }
  return raw
}

function buildRecountState(db){
  const names=allNames(db)
  const target=new Map()
  for(const [raw,complete,tapa,base] of PHYSICAL_RECOUNT){
    const figure=resolveName(raw,names)
    target.set(figure,{complete:Number(complete)||0,tapa:Number(tapa)||0,base:Number(base)||0})
    if(!names.includes(figure))names.push(figure)
  }
  const rawManual=manualBalance(db)
  const autoOut=automaticOrderOutflow(db)
  const rawLoose=looseComponentBalance(db)
  const every=new Set([...names,...Object.keys(rawManual),...Object.keys(autoOut),...Object.keys(rawLoose)])
  const movements=[...(db.movements||[])]
  const now=new Date().toISOString(),date=today()
  for(const figure of every){
    const wanted=target.get(figure)||{complete:0,tapa:0,base:0}
    for(const component of ['tapa','base']){
      const current=Math.max(0,Number(rawLoose[figure]?.[component]||0))
      const desired=Math.max(0,Number(wanted[component]||0))
      const delta=desired-current
      if(delta!==0)movements.push({id:crypto.randomUUID(),date,figure,component,type:delta>0?'Ajuste componente positivo':'Ajuste componente negativo',qty:Math.abs(delta),detail:`RECUENTO FÍSICO 14/08 · fijar ${component}s sueltas en ${desired}`,createdAt:now})
    }
    const currentManual=Number(rawManual[figure]||0)
    const desiredManual=Math.max(0,Number(wanted.complete||0))+Number(autoOut[figure]||0)
    const delta=desiredManual-currentManual
    if(delta!==0)movements.push({id:crypto.randomUUID(),date,figure,type:delta>0?'Ajuste positivo':'Ajuste negativo',qty:Math.abs(delta),detail:`RECUENTO FÍSICO 14/08 · fijar figuras completas en ${wanted.complete}`,createdAt:now})
  }
  const figures=[...new Set([...(db.figures||[]),...PHYSICAL_RECOUNT.map(([raw])=>resolveName(raw,names))])].filter(Boolean).sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))
  return {...db,figures,movements,inventoryRecount:{id:RECOUNT_ID,appliedAt:now,completeTotal:170,looseBases:4,looseTops:3,source:'INVENTARIO PIEZAS 14-08.txt'}}
}

function buildRecountCloseoutState(db){
  const before=automaticOrderOutflow(db)
  const now=new Date().toISOString()
  let closedOrders=0
  const orders=(db.orders||[]).map(order=>{
    const delivery=String(order?.delivery||'').slice(0,10)
    if(!delivery||delivery>RECOUNT_CUTOFF||order.status==='Cancelado'||order.status==='Entregado')return order
    closedOrders+=1
    return {...order,status:'Entregado',inventoryClosedAt:now,inventoryClosedReason:'Recuento físico 14/08'}
  })
  const intermediate={...db,orders}
  const after=automaticOrderOutflow(intermediate)
  const movements=[...(db.movements||[])]
  const names=new Set([...Object.keys(before),...Object.keys(after)])
  let compensatedPieces=0
  names.forEach(figure=>{
    const delta=Number(after[figure]||0)-Number(before[figure]||0)
    if(delta<=0)return
    compensatedPieces+=delta
    movements.push({id:crypto.randomUUID(),date:RECOUNT_CUTOFF,figure,type:'Ajuste positivo',qty:delta,detail:`CIERRE RECUENTO 14/08 · compensar ${delta} pieza${delta===1?'':'s'} ya incluida${delta===1?'':'s'} en el conteo físico`,createdAt:now})
  })
  return {...intermediate,movements,inventoryRecountCloseout:{id:CLOSEOUT_ID,cutoffDate:RECOUNT_CUTOFF,appliedAt:now,closedOrders,compensatedPieces,source:'Recuento físico 14/08: pedidos entregados ya incluidos en el stock real'}}
}

export default function Stock(props){
  const {db,onSave}=props
  const applyingRef=useRef(false)
  const closeoutRef=useRef(false)
  const [recountStatus,setRecountStatus]=useState(db.inventoryRecount?.id===RECOUNT_ID?'applied':'pending')
  const [bulkMode,setBulkMode]=useState(false)
  const [bulkSearch,setBulkSearch]=useState('')
  const [bulkValues,setBulkValues]=useState({})
  const [bulkSaving,setBulkSaving]=useState(false)
  const closeoutApplied=db.inventoryRecountCloseout?.id===CLOSEOUT_ID
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
    const clean=()=>document.querySelectorAll('.stock-no-projection .inventory-explanation').forEach(el=>{if(el.textContent?.toLocaleLowerCase('es').includes('proyección'))el.style.display='none'})
    clean();const observer=new MutationObserver(clean);const root=document.querySelector('.stock-no-projection');if(root)observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect()
  },[])

  useEffect(()=>{
    if(!db||!onSave||db.inventoryRecount?.id===RECOUNT_ID||applyingRef.current)return
    applyingRef.current=true;setRecountStatus('applying')
    ;(async()=>{
      const next=buildRecountState(db)
      const result=await onSave(next)
      if(result?.ok===false){applyingRef.current=false;setRecountStatus('error');alert('No se pudo aplicar el recuento físico. No se modificó el inventario. Revisá la conexión y volvé a entrar a Inventario.');return}
      setRecountStatus('applied')
      alert('✅ Recuento físico 14/08 aplicado. Inventario ajustado a 170 figuras completas + 4 bases + 3 tapas.')
    })()
  },[db,onSave])

  useEffect(()=>{
    if(!db||!onSave||db.inventoryRecount?.id!==RECOUNT_ID||db.inventoryRecountCloseout?.id===CLOSEOUT_ID||closeoutRef.current)return
    closeoutRef.current=true
    ;(async()=>{
      const next=buildRecountCloseoutState(db)
      const result=await onSave(next)
      if(result?.ok===false){closeoutRef.current=false;alert('No se pudo cerrar el recuento del 14/08. El inventario no se cambió. Volvé a entrar a Inventario para reintentar.');return}
      const info=next.inventoryRecountCloseout
      alert(`✅ Cierre 14/08 aplicado. ${info.closedOrders} pedido${info.closedOrders===1?'':'s'} entregado${info.closedOrders===1?'':'s'} hasta hoy dejaron de figurar en “Para cortar”. El stock físico de 170 se conserva sin doble descuento.`)
    })()
  },[db,onSave])

  return <div className="stock-no-projection"><style>{`
    .stock-no-projection .inventory-kpis > .panel:nth-child(5){display:none!important}
    .stock-no-projection .inventory-table th:nth-child(8),.stock-no-projection .inventory-table td:nth-child(8){display:none!important}
    .bulk-recount{margin:14px 0;padding:16px}.bulk-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.bulk-table-wrap{overflow:auto;max-height:62vh;margin-top:12px}.bulk-table{width:100%;border-collapse:collapse}.bulk-table th,.bulk-table td{padding:8px;border-bottom:1px solid #ddd;text-align:left}.bulk-table input{width:88px}.bulk-actions{position:sticky;bottom:0;background:var(--panel,#fff);padding:12px 0;display:flex;gap:10px;justify-content:flex-end}.bulk-badge{font-weight:700}
  `}</style>
    {recountStatus!=='applied'&&<div className="notice"><b>{recountStatus==='applying'?'Aplicando recuento físico 14/08…':'Recuento físico 14/08 pendiente'}</b><span>{recountStatus==='error'?'Falló el guardado. Salí y volvé a entrar a Inventario para reintentar.':'No cierres esta pantalla hasta que aparezca la confirmación.'}</span></div>}
    {recountStatus==='applied'&&<div className="notice"><b>✅ Inventario físico 14/08 aplicado</b><span>Base real: 170 completas · 4 bases sueltas · 3 tapas sueltas. {closeoutApplied?'Pedidos entregados hasta el recuento ya cerrados; no volverán a descontarse.':'Cerrando pedidos ya entregados para evitar doble descuento…'}</span></div>}

    {!bulkMode&&<div className="panel bulk-recount"><div className="bulk-head"><div><h3>🧮 Reajuste masivo de inventario</h3><p className="muted">Cargá todo el recuento físico y guardalo una sola vez al terminar.</p></div><button type="button" className="primary" onClick={startBulk}>Abrir reajuste masivo</button></div></div>}

    {bulkMode&&<div className="panel bulk-recount"><div className="bulk-head"><div><h3>🧮 Reajuste masivo</h3><p className="muted">Nada se guarda hasta que pulses “Guardar todo el inventario”.</p></div><div className="bulk-badge">Cambios: {changedCount}</div></div><input style={{width:'100%',marginTop:10}} type="search" placeholder="Buscar figura..." value={bulkSearch} onChange={e=>setBulkSearch(e.target.value)}/><div className="bulk-table-wrap"><table className="bulk-table"><thead><tr><th>Figura</th><th>Completas</th><th>Tapas sueltas</th><th>Bases sueltas</th></tr></thead><tbody>{visibleBulkRows.map(r=>{const v=bulkValues[r.figure]||{};return <tr key={r.figure}><td><b>{r.figure}</b></td><td><input type="number" min="0" value={v.complete??r.cut??0} onChange={e=>setBulk(r.figure,'complete',e.target.value)}/></td><td><input type="number" min="0" value={v.tapa??r.looseTapa??0} onChange={e=>setBulk(r.figure,'tapa',e.target.value)}/></td><td><input type="number" min="0" value={v.base??r.looseBase??0} onChange={e=>setBulk(r.figure,'base',e.target.value)}/></td></tr>})}</tbody></table></div><div className="bulk-actions"><button type="button" onClick={()=>{if(changedCount&&!window.confirm('Descartar todos los cambios del reajuste?'))return;setBulkMode(false);setBulkValues({})}} disabled={bulkSaving}>Cancelar cambios</button><button type="button" className="primary" onClick={saveBulk} disabled={bulkSaving||!changedCount}>{bulkSaving?'Guardando…':`💾 Guardar todo el inventario (${changedCount})`}</button></div></div>}

    {!bulkMode&&<StockBase {...props} db={mergeDb}/>} 
  </div>
}