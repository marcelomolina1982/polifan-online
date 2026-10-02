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
  const [search,setSearch]=useState('')
  const [stockFilter,setStockFilter]=useState('all')
  const physicalRows=useMemo(()=>stockRows(db).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'})),[db])
  // Sólo amplía las opciones del selector de UNIFICAR. No modifica ni guarda el inventario.
  // Así también aparecen nombres históricos que existen como filas físicas (ej. "chop" y "Chopp").
  const mergeDb=useMemo(()=>({...db,figures:[...new Set([...(db.figures||[]),...physicalRows.map(r=>r.figure)])]}),[db,physicalRows])
  const visibleBulkRows=useMemo(()=>physicalRows.filter(r=>r.figure.toLowerCase().includes(bulkSearch.toLowerCase())),[physicalRows,bulkSearch])
  const visibleRows=useMemo(()=>physicalRows.filter(r=>{const matches=r.figure.toLowerCase().includes(search.toLowerCase());if(!matches)return false;if(stockFilter==='available')return Number(r.cut||0)>0;if(stockFilter==='loose')return Number(r.looseTapa||0)>0||Number(r.looseBase||0)>0;if(stockFilter==='empty')return Number(r.cut||0)===0&&Number(r.looseTapa||0)===0&&Number(r.looseBase||0)===0;return true}),[physicalRows,search,stockFilter])
  const physicalTotals=useMemo(()=>physicalRows.reduce((a,r)=>({complete:a.complete+Number(r.cut||0),tapa:a.tapa+Number(r.looseTapa||0),base:a.base+Number(r.looseBase||0)}),{complete:0,tapa:0,base:0}),[physicalRows])
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
    .inventory-page{--inv-blue:#2563eb;--inv-soft:#f5f7fb;--inv-line:#e5eaf2}
    .stock-dashboard{margin-top:18px}.stock-hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;padding:24px;border-radius:22px;background:#111827;color:#fff}.stock-eyebrow{font-size:11px;font-weight:800;letter-spacing:.16em;opacity:.65}.stock-hero h1{font-size:34px;line-height:1;margin:8px 0}.stock-hero p{margin:0;opacity:.7}.stock-summary{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:10px}.stock-summary>div{padding:13px 15px;border-radius:14px;background:rgba(255,255,255,.09);min-width:110px}.stock-summary b{display:block;font-size:25px}.stock-summary span{font-size:11px;opacity:.7}.stock-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;align-items:center;gap:12px;margin:16px 0}.stock-toolbar input{min-height:50px;padding:0 16px;border:1px solid var(--inv-line);border-radius:14px;background:#fff;font-size:16px}.stock-toolbar>span{font-size:13px;opacity:.6;white-space:nowrap}.stock-filters{display:flex;gap:5px;padding:4px;border-radius:13px;background:#eef2f7}.stock-filters button{border:0;background:transparent;padding:9px 11px;border-radius:10px;font-size:12px;font-weight:750;cursor:pointer}.stock-filters button.active{background:#fff;box-shadow:0 1px 5px rgba(15,23,42,.12)}.stock-card-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.stock-card{display:block;padding:17px;border:1px solid var(--inv-line);border-radius:18px;background:#fff;box-shadow:0 4px 14px rgba(15,23,42,.035)}.stock-card.is-empty{opacity:.62}.stock-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.stock-name{min-width:0}.stock-name>b{display:block;font-size:17px;line-height:1.2;overflow-wrap:anywhere}.stock-name small{display:block;margin-top:5px;font-size:11px;color:#b45309}.stock-status{flex:none;padding:5px 7px;border-radius:999px;font-size:9px;font-weight:900;letter-spacing:.04em}.stock-status.ok{background:#e9f8ef;color:#18733a}.stock-status.empty{background:#f1f3f6;color:#697386}.stock-main-number{display:flex;align-items:flex-end;justify-content:space-between;margin:18px 0 12px;padding:15px;border-radius:14px;background:#eef5ff}.stock-main-number span{font-size:10px;font-weight:850;letter-spacing:.06em;color:#48627e}.stock-main-number b{font-size:34px;line-height:.9}.stock-parts{display:grid;grid-template-columns:1fr 1fr;gap:8px}.stock-parts>div{display:flex;align-items:center;justify-content:space-between;padding:10px 11px;border-radius:11px;background:#f6f7f9}.stock-parts span{font-size:11px;color:#64748b}.stock-parts b{font-size:18px}.stock-empty{padding:28px;text-align:center;border:1px dashed var(--inv-line);border-radius:16px;opacity:.65}.stock-tools{margin-top:22px;border:1px solid var(--inv-line);border-radius:17px;background:#fff;overflow:hidden}.stock-tools>summary{cursor:pointer;padding:16px 18px;font-weight:800;display:flex;align-items:center;justify-content:space-between;gap:12px;list-style:none}.stock-tools>summary::-webkit-details-marker{display:none}.stock-tools>summary span{display:block}.stock-tools>summary b{display:block}.stock-tools>summary small{display:block;margin-top:3px;font-weight:500;color:#64748b}.stock-tools>summary strong{padding:7px 10px;border-radius:9px;background:#f1f5f9;font-size:11px}.stock-tools[open]>summary strong{font-size:0}.stock-tools[open]>summary strong:after{content:'Cerrar';font-size:11px}.stock-tools-inner{padding:0 16px 16px;border-top:1px solid var(--inv-line)}.stock-tools-inner>p{margin:14px 0;color:#64748b}.stock-tools-inner .inventory-kpis,.stock-tools-inner>.inventory-explanation{display:none!important}
    @media(max-width:900px){.stock-hero{align-items:stretch;flex-direction:column}.stock-summary{width:100%}.stock-card-list{grid-template-columns:1fr}.stock-toolbar{grid-template-columns:1fr}.stock-toolbar>span{padding-left:4px}}
    @media(max-width:640px){.stock-hero{padding:18px}.stock-hero h1{font-size:29px}.stock-summary{grid-template-columns:repeat(3,1fr)}.stock-summary>div{min-width:0;padding:10px}.stock-summary b{font-size:22px}.stock-card{align-items:flex-start;flex-direction:column}.stock-counts{width:100%;grid-template-columns:repeat(3,1fr)}.stock-toolbar{align-items:stretch;flex-direction:column}.stock-toolbar>span{padding-left:4px}}
    .inventory-page>.inventory-kpis{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0 20px}
    .inventory-page>.inventory-kpis>.panel{border:1px solid var(--inv-line);border-radius:16px;padding:16px 18px;box-shadow:none;background:linear-gradient(180deg,#fff,#f8fafc)}
    .inventory-page>.inventory-kpis>.panel small{font-size:12px;letter-spacing:.04em;font-weight:800;opacity:.65}
    .inventory-page>.inventory-kpis>.panel b{display:block;font-size:30px;line-height:1.05;margin:7px 0 4px}
    .inventory-page>.inventory-kpis>.panel span{font-size:13px;opacity:.72}
    .inventory-page .inventory-kpis > .panel:nth-child(5){display:none!important}
    .inventory-page>.notice.inventory-explanation{border-radius:14px;border:1px solid var(--inv-line);padding:12px 14px;margin:8px 0;background:#fff}
    .inventory-page>.notice.inventory-explanation b{display:block;margin-bottom:3px}
    .inventory-page>.notice.inventory-explanation span{font-size:14px;line-height:1.4}
    .inventory-page>.inventory-manual-merge{border-radius:18px;border:1px solid var(--inv-line);box-shadow:none;background:var(--inv-soft);padding:18px}
    .inventory-page>.filters{position:sticky;top:8px;z-index:10;border:0;box-shadow:0 8px 24px rgba(15,23,42,.10);border-radius:16px;padding:10px;background:#fff;margin:16px 0 10px}
    .inventory-page>.filters input{min-height:44px;border-radius:12px;font-size:16px}
    .inventory-page .inventory-table th:nth-child(8),.inventory-page .inventory-table td:nth-child(8){display:none!important}
    .inventory-page .table-wrap{overflow:auto;position:relative;border:1px solid var(--inv-line);border-radius:18px;padding:0!important;box-shadow:none}
    .inventory-page .inventory-table{width:100%;border-collapse:separate;border-spacing:0;background:#fff}
    .inventory-page .inventory-table th{padding:12px 10px;font-size:13px;line-height:1.2;text-transform:none;white-space:nowrap;background:#f8fafc;border-bottom:1px solid var(--inv-line)}
    .inventory-page .inventory-table td{padding:13px 10px;vertical-align:middle;border-bottom:1px solid #eef1f5;font-size:15px;font-variant-numeric:tabular-nums}
    .inventory-page .inventory-table tbody tr:last-child td{border-bottom:0}
    .inventory-page .inventory-table tbody tr:hover td{background:#f8fbff}
    .inventory-page .inventory-table td:first-child>b{font-size:15px}
    .inventory-page .inventory-table th:first-child,.inventory-page .inventory-table td:first-child{position:sticky;left:0;z-index:2;background:#fff;min-width:160px}
    .inventory-page .inventory-table th:first-child{z-index:5;background:#f8fafc}
    .inventory-page .inventory-table th:last-child,.inventory-page .inventory-table td:last-child{position:sticky;right:0;z-index:3;background:#fff;min-width:235px;border-left:1px solid var(--inv-line);box-shadow:-10px 0 18px rgba(15,23,42,.045)}
    .inventory-page .inventory-table th:last-child{z-index:6;background:#f8fafc}
    .inventory-page .inventory-state,.inventory-page .inventory-part-warning,.inventory-page .inventory-part-ok{display:block;margin-top:4px;font-size:11px}
    .inventory-page .stock-number-adjust{display:grid;grid-template-columns:minmax(112px,1fr) 72px;gap:7px;align-items:center}
    .inventory-page .stock-number-adjust select,.inventory-page .stock-number-adjust input{min-height:36px;border-radius:9px}
    .inventory-page .stock-number-actions{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:7px}
    .inventory-page .stock-number-actions button{width:100%;min-height:35px;padding:6px 8px;white-space:nowrap;border-radius:9px}
    .inventory-page>form.panel{margin-top:18px;border-radius:18px;border:1px solid var(--inv-line);box-shadow:none;padding:18px}
    .inventory-page>form.panel h3{margin-top:0;font-size:20px}
    .bulk-recount{margin:14px 0;padding:18px;border-radius:18px!important;border:1px solid var(--inv-line)!important;box-shadow:none!important;background:linear-gradient(135deg,#f8fbff,#fff)}
    .bulk-head{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap}.bulk-head>div:first-child{min-width:0;flex:1 1 320px}.bulk-head h3{margin:0 0 5px;font-size:20px;line-height:1.25;overflow-wrap:anywhere}.bulk-head p{margin:0;line-height:1.4;max-width:720px}.bulk-table-wrap{overflow:auto;max-height:62vh;margin-top:12px;border:1px solid var(--inv-line);border-radius:14px}.bulk-table{width:100%;border-collapse:collapse;table-layout:fixed}.bulk-table th,.bulk-table td{padding:11px;border-bottom:1px solid var(--inv-line);text-align:left;vertical-align:middle}.bulk-table th:first-child,.bulk-table td:first-child{width:auto}.bulk-table th:not(:first-child),.bulk-table td:not(:first-child){width:120px;text-align:center}.bulk-table th{position:sticky;top:0;z-index:2;background:#f8fafc;white-space:normal;line-height:1.2}.bulk-table input{width:88px;max-width:100%;min-height:40px;box-sizing:border-box;text-align:center;font-size:15px;font-variant-numeric:tabular-nums}.bulk-table tbody tr:focus-within td{background:#f8fbff}.bulk-table input:focus{outline:2px solid currentColor;outline-offset:1px}.bulk-actions{position:sticky;bottom:0;z-index:4;background:#fff;padding:12px 0 0;display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap}.bulk-actions button{min-height:40px}.bulk-badge{font-weight:700;white-space:nowrap;padding:7px 10px;border-radius:999px;background:#eef2f7}
    @media(max-width:1100px){.inventory-page>.inventory-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:900px){
      .inventory-page .inventory-table th:nth-child(3),.inventory-page .inventory-table td:nth-child(3),.inventory-page .inventory-table th:nth-child(4),.inventory-page .inventory-table td:nth-child(4),.inventory-page .inventory-table th:nth-child(6),.inventory-page .inventory-table td:nth-child(6){display:none}
      .inventory-page .inventory-table th:last-child,.inventory-page .inventory-table td:last-child{min-width:215px}
      .inventory-page .inventory-table th:first-child,.inventory-page .inventory-table td:first-child{min-width:135px}
    }
    @media(max-width:640px){
      .inventory-page>.inventory-kpis{grid-template-columns:1fr 1fr;gap:8px}.inventory-page>.inventory-kpis>.panel{padding:12px}.inventory-page>.inventory-kpis>.panel b{font-size:25px}
      .bulk-recount{padding:14px}.bulk-head{display:block}.bulk-head>div:first-child{width:100%}.bulk-head h3{font-size:19px}.bulk-head .bulk-badge{display:inline-block;margin-top:8px}.bulk-head button{width:100%;margin-top:10px}
      .bulk-table-wrap{overflow:visible;max-height:none;border:0}.bulk-table,.bulk-table tbody{display:block}.bulk-table thead{display:none}.bulk-table tr{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:10px 0;padding:12px;border:1px solid var(--inv-line);border-radius:12px}.bulk-table td{display:block;padding:0;border:0}.bulk-table td:first-child{grid-column:1/-1;font-size:16px;margin-bottom:2px}.bulk-table td:nth-child(2)::before{content:'Completas';}.bulk-table td:nth-child(3)::before{content:'Tapas';}.bulk-table td:nth-child(4)::before{content:'Bases';}.bulk-table td:not(:first-child)::before{display:block;font-size:11px;font-weight:700;opacity:.7;margin-bottom:4px}.bulk-table input{width:100%;min-width:0}.bulk-actions{margin:0 -14px -14px;padding:10px 14px;box-shadow:0 -5px 14px rgba(0,0,0,.08)}.bulk-actions button{flex:1 1 140px}
      .inventory-page .inventory-table th:nth-child(5),.inventory-page .inventory-table td:nth-child(5){display:none}
      .inventory-page .inventory-table th:last-child,.inventory-page .inventory-table td:last-child{min-width:200px}
      .inventory-page .inventory-table th:first-child,.inventory-page .inventory-table td:first-child{min-width:120px}
      .inventory-page .inventory-table th,.inventory-page .inventory-table td{padding:9px 7px;font-size:14px}
      .inventory-page .stock-number-adjust{grid-template-columns:1fr 64px;gap:5px}.inventory-page .stock-number-actions{gap:5px}.inventory-page .stock-number-actions button{font-size:12px;padding:6px 5px}
    }
  `}</style>
    {!bulkMode&&<div className="panel bulk-recount"><div className="bulk-head"><div><h3>🧮 Reajuste masivo de inventario</h3><p className="muted">Cargá todo el recuento físico y guardalo una sola vez al terminar.</p></div><button type="button" className="primary" onClick={startBulk}>Abrir reajuste masivo</button></div></div>}

    {bulkMode&&<div className="panel bulk-recount"><div className="bulk-head"><div><h3>🧮 Reajuste masivo</h3><p className="muted">Nada se guarda hasta que pulses “Guardar todo el inventario”.</p></div><div className="bulk-badge">Cambios: {changedCount}</div></div><input style={{width:'100%',marginTop:10}} type="search" placeholder="Buscar figura..." value={bulkSearch} onChange={e=>setBulkSearch(e.target.value)}/><div className="bulk-table-wrap"><table className="bulk-table"><thead><tr><th>Figura</th><th>Completas</th><th>Tapas sueltas</th><th>Bases sueltas</th></tr></thead><tbody>{visibleBulkRows.map(r=>{const v=bulkValues[r.figure]||{};return <tr key={r.figure}><td><b>{r.figure}</b></td><td><input type="number" min="0" value={v.complete??r.cut??0} onChange={e=>setBulk(r.figure,'complete',e.target.value)}/></td><td><input type="number" min="0" value={v.tapa??r.looseTapa??0} onChange={e=>setBulk(r.figure,'tapa',e.target.value)}/></td><td><input type="number" min="0" value={v.base??r.looseBase??0} onChange={e=>setBulk(r.figure,'base',e.target.value)}/></td></tr>})}</tbody></table></div><div className="bulk-actions"><button type="button" onClick={()=>{if(changedCount&&!window.confirm('Descartar todos los cambios del reajuste?'))return;setBulkMode(false);setBulkValues({})}} disabled={bulkSaving}>Cancelar cambios</button><button type="button" className="primary" onClick={saveBulk} disabled={bulkSaving||!changedCount}>{bulkSaving?'Guardando…':`💾 Guardar todo el inventario (${changedCount})`}</button></div></div>}

    {!bulkMode&&<div className="stock-dashboard">
      <div className="stock-hero"><div><span className="stock-eyebrow">STOCK FÍSICO</span><h1>Inventario</h1><p>Lo que tenés disponible ahora, sin mezclar producción ni proyecciones.</p></div><div className="stock-summary"><div><span>Completas</span><b>{physicalTotals.complete}</b></div><div><span>Tapas sueltas</span><b>{physicalTotals.tapa}</b></div><div><span>Bases sueltas</span><b>{physicalTotals.base}</b></div></div></div>
      <div className="stock-toolbar"><input type="search" placeholder="Buscar una figura..." value={search} onChange={e=>setSearch(e.target.value)}/><div className="stock-filters"><button className={stockFilter==='all'?'active':''} onClick={()=>setStockFilter('all')}>Todas</button><button className={stockFilter==='available'?'active':''} onClick={()=>setStockFilter('available')}>Con stock</button><button className={stockFilter==='loose'?'active':''} onClick={()=>setStockFilter('loose')}>Con sueltas</button><button className={stockFilter==='empty'?'active':''} onClick={()=>setStockFilter('empty')}>Sin stock</button></div><span>{visibleRows.length} figuras</span></div>
      <div className="stock-card-list">{visibleRows.map(r=>{const empty=Number(r.cut||0)===0&&Number(r.looseTapa||0)===0&&Number(r.looseBase||0)===0;return <article className={'stock-card '+(empty?'is-empty':'')} key={r.figure}><div className="stock-card-top"><div className="stock-name"><b>{r.figure}</b>{r.missingPart&&<small>⚠ Faltan {r.missingPart.qty} {r.missingPart.type}{r.missingPart.qty===1?'':'s'} para emparejar</small>}</div><span className={'stock-status '+(empty?'empty':'ok')}>{empty?'SIN STOCK':'EN STOCK'}</span></div><div className="stock-main-number"><span>FIGURAS COMPLETAS</span><b>{r.cut}</b></div><div className="stock-parts"><div><span>Tapas sueltas</span><b>{r.looseTapa}</b></div><div><span>Bases sueltas</span><b>{r.looseBase}</b></div></div></article>})}</div>
      {!visibleRows.length&&<div className="stock-empty">No encontré figuras con “{search}”.</div>}
      <details className="stock-tools"><summary><span><b>⚙ Herramientas</b><small>Ajustes, movimientos y unificación</small></span><strong>Abrir</strong></summary><div className="stock-tools-inner"><p>Esta zona queda separada de la consulta diaria para evitar mezclar stock físico con tareas administrativas.</p><StockBase {...props} db={mergeDb}/></div></details>
    </div>}
  </div>
}