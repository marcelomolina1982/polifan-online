import fs from 'node:fs'
import './finalize-v25.0.81.mjs'

function mustReplace(text,pattern,replacement,label){
  const next=typeof pattern==='string'?text.replace(pattern,replacement):text.replace(pattern,replacement)
  if(next===text)throw new Error(`journey lab: no se encontró ${label}`)
  return next
}

{
  const file='src/pages/MotorDefinitivo.jsx'
  let src=fs.readFileSync(file,'utf8')
  src=mustReplace(src,"import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'","import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'\nimport {advanceOperationalJourney} from '../lib/customerJourneyOperational'",'import operativo en MotorDefinitivo')
  const replacement=`  async function registerPlan(plan){
    if(!okStatus(plan.status)||!plan.svgText||plan.registered)return
    const multiplier=Number(plan.multiplier||1)
    const number=String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0')
    const items=[...plan.summary.map(x=>({figure:x.figure,component:'complete',qty:x.qty}))]
    const now=new Date().toISOString()
    const deliveryDates=[...new Set((plan.units||[]).map(u=>String(u.date||'').slice(0,10)).filter(Boolean))]
    const batch={id:crypto.randomUUID(),number,date:plan.date||today(),deliveryDates,name:\`Placa automática Sparrow \${plan.date||today()}\`,status:'En corte',sentToCutAt:now,journeyManaged:true,notes:\`Sparrow + V1.7 · \${plan.units.length} diseños · \${multiplier===2?'placa doble':'placa simple'} · ocupación \${Number(plan.density||0).toFixed(1)}% · ancho usado \${Number(plan.stripWidthMm||0).toFixed(0)} mm · separación \${plan.minGap} mm\`,multiplier,items,createdAt:now}
    const cutBatches=[...(db.cutBatches||[]),batch]
    const journey=advanceOperationalJourney({...db,cutBatches},now)
    const result=await onSave({...db,orders:journey.orders,cutBatches})
    if(result?.ok!==false)setPlans(list=>list.map(x=>x.id===plan.id?{...x,registered:true,batchNumber:number}:x))
  }

  return <>`
  src=mustReplace(src,/  async function registerPlan\(plan\)\{[\s\S]*?\n  \}\n\n  return <>/,replacement,'registerPlan de MotorDefinitivo')
  fs.writeFileSync(file,src)
}

{
  const file='src/pages/CutBatches.jsx'
  let src=fs.readFileSync(file,'utf8')
  src=mustReplace(src,"import {today} from '../lib/format'","import {today} from '../lib/format'\nimport {advanceOperationalJourney} from '../lib/customerJourneyOperational'",'import operativo en CutBatches')
  src=mustReplace(src,"  const autoFinishRef=useRef(false)","  const autoFinishRef=useRef(false)\n  const [displayBatches,setDisplayBatches]=useState(()=>db.cutBatches||[])\n  useEffect(()=>setDisplayBatches(db.cutBatches||[]),[db.cutBatches])",'estado visual sincronizado de placas')
  src=mustReplace(src,"const pending=(db.cutBatches||[]).filter(b=>b.status==='En corte' && String(b.name||'').startsWith('Placa automática Sparrow'))","const pending=[] // Customer Journey LAB: Sparrow espera confirmación manual del corte",'auto-finalización Sparrow')

  const editingStart=src.indexOf('    if(editing){')
  const editingEnd=src.indexOf('    }else{',editingStart)
  if(editingStart<0||editingEnd<0)throw new Error('journey lab: no se encontró bloque de edición de placa')
  let editingBlock=src.slice(editingStart,editingEnd)
  const savePos=editingBlock.lastIndexOf('saved=await onSave(')
  if(savePos<0)throw new Error('journey lab: no se encontró guardado de modificación de placa')
  const saveLineEnd=editingBlock.indexOf('\n',savePos)
  const saveEnd=saveLineEnd<0?editingBlock.length:saveLineEnd
  const editSave="const next={...db,movements,cutBatches}\n      const journey=advanceOperationalJourney(next,new Date().toISOString())\n      saved=await onSave({...next,orders:journey.orders})"
  editingBlock=editingBlock.slice(0,savePos)+editSave+editingBlock.slice(saveEnd)
  src=src.slice(0,editingStart)+editingBlock+src.slice(editingEnd)
  if(!src.includes("saved=await onSave({...next,orders:journey.orders})"))throw new Error('journey lab: no quedó reconciliación de modificación de placa')
  src=mustReplace(src,"    if(saved?.ok===false)return\n    setEditing(null);setForm(blank())","    if(saved?.ok===false)return\n    if(saved?.data?.cutBatches)setDisplayBatches(saved.data.cutBatches)\n    setEditing(null);setForm(blank())",'refresco inmediato tras modificar placa')

  src=mustReplace(src,/  async function finish\(batch\)\{[\s\S]*?\n  \}\n\n  async function cancel\(batch\)\{/,`  async function finish(batch){
    if(!confirm('¿Confirmar que esta placa terminó de cortarse y sumar sus piezas al inventario?'))return
    const now=new Date().toISOString()
    const movements=inventoryMovements(batch,1,'Placa terminada')
    const cutBatches=(db.cutBatches||[]).map(b=>b.id===batch.id?{...b,status:'Terminada',finishedAt:now}:b)
    const next={...db,movements:[...(db.movements||[]),...movements],cutBatches}
    const journey=advanceOperationalJourney(next,now)
    const saved=await onSave({...next,orders:journey.orders})
    if(saved?.ok!==false&&saved?.data?.cutBatches)setDisplayBatches(saved.data.cutBatches)
  }

  async function cancel(batch){`,'confirmación manual de corte')

  const cancelStart=src.indexOf('  async function cancel(batch){')
  const cancelEnd=src.indexOf('\n  function edit(batch){',cancelStart)
  if(cancelStart<0||cancelEnd<0)throw new Error('journey lab: no se encontró bloque de cancelación de placa')
  let cancelBlock=src.slice(cancelStart,cancelEnd)
  const cancelSavePos=cancelBlock.lastIndexOf('await onSave(')
  if(cancelSavePos<0)throw new Error('journey lab: no se encontró guardado de cancelación de placa')
  const cancelSaveLineEnd=cancelBlock.indexOf('\n',cancelSavePos)
  const cancelSaveEnd=cancelSaveLineEnd<0?cancelBlock.length:cancelSaveLineEnd
  const cancelSave="const next={...db,movements:[...(db.movements||[]),...reversals],cutBatches}\n    const journey=advanceOperationalJourney(next,new Date().toISOString())\n    const saved=await onSave({...next,orders:journey.orders})\n    if(saved?.ok!==false&&saved?.data?.cutBatches)setDisplayBatches(saved.data.cutBatches)"
  cancelBlock=cancelBlock.slice(0,cancelSavePos)+cancelSave+cancelBlock.slice(cancelSaveEnd)
  src=src.slice(0,cancelStart)+cancelBlock+src.slice(cancelEnd)
  if(!src.includes("const saved=await onSave({...next,orders:journey.orders})"))throw new Error('journey lab: no quedó reconciliación de cancelación')

  src=mustReplace(src,'Las placas automáticas de Sparrow pasan a Terminadas al ingresar y suman su producción al inventario. Después podés modificarlas o anularlas y el stock se corrige automáticamente.','Las placas automáticas de Sparrow quedan En corte hasta que confirmes que terminaron. Recién ahí suman su producción al inventario y comienza el reloj operativo del pedido.','texto de En corte')

  const tableStart='    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Fecha</th><th>Piezas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>'
  const tableEnd='    </tbody></table></div>'
  const ti=src.indexOf(tableStart),tj=src.indexOf(tableEnd,ti)
  if(ti<0||tj<0)throw new Error('journey lab: no se encontró tabla de En corte')
  const compact=`    <div className="panel" style={{display:'grid',gap:10}}>
      {(displayBatches||[]).slice().reverse().map(b=><article key={b.id} style={{border:'1px solid #e5e7eb',borderRadius:14,padding:14,display:'grid',gap:10,minWidth:0}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
          <div style={{minWidth:0,flex:'1 1 260px'}}><b>#{b.number} · {b.name}</b><small className="block">{b.date} · Corte {(Number(b.multiplier)||1)===2?'doble':'simple'}</small>{b.notes&&<small className="block" style={{marginTop:4}}>{b.notes}</small>}</div>
          <span className={'status-text '+(b.status==='En corte'?'low':b.status==='Cancelada'?'':'ok')} style={{flex:'0 0 auto'}}>{b.status}</span>
        </div>
        <div style={{fontSize:13,lineHeight:1.45,overflowWrap:'anywhere'}}>{(b.items||[]).map(i=>String(i.figure)+(i.component&&i.component!=='complete'?' · '+i.component:'')+' × '+(Number(i.qty)*(Number(b.multiplier)||1))).join(' · ')}</div>
        <div className="row-actions" style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-start'}}>{b.status==='En corte'&&<><button className="primary" onClick={()=>finish(b)}>Terminar corte</button><button className="ghost" onClick={()=>edit(b)}>Modificar</button><button className="danger" onClick={()=>cancel(b)}>Cancelar</button></>}{b.status==='Terminada'&&<><button className="ghost" onClick={()=>edit(b)}>Modificar</button><button className="danger" onClick={()=>cancel(b)}>Anular corte</button></>}</div>
      </article>)}
      {!(displayBatches||[]).length&&<div className="dash-empty"><b>Todavía no hay placas registradas.</b></div>}
    </div>`
  src=src.slice(0,ti)+compact+src.slice(tj+tableEnd.length)
  fs.writeFileSync(file,src)
}

{
  const file='src/pages/OperationsHub.jsx'
  let src=fs.readFileSync(file,'utf8')
  src=mustReplace(src,"import React,{useMemo} from 'react'","import React,{useEffect,useMemo} from 'react'",'useEffect en Centro operativo')
  src=mustReplace(src,"import {pendingCutPlan} from '../lib/cutPlanning'","import {pendingCutPlan} from '../lib/cutPlanning'\nimport {advanceOperationalJourney,effectiveJourneyEvent,finalActionLabel,journeyIsFinal,journeyStageLabel,markJourneyFinal} from '../lib/customerJourneyOperational'\nimport {JOURNEY_EVENTS} from '../lib/customerJourney'",'imports Customer Journey en Centro operativo')
  src=mustReplace(src,'export default function OperationsHub({db,go}){','export default function OperationsHub({db,onSave,go}){','onSave en Centro operativo')

  const anchor=`  const upcomingByDate=useMemo(()=>{
    const map=new Map()
    upcoming.forEach(o=>{
      if(!map.has(o.delivery))map.set(o.delivery,[])
      map.get(o.delivery).push(o)
    })
    return [...map.entries()].map(([date,orders])=>({date,orders,pieces:orders.reduce((s,o)=>s+orderPieces(o),0),ready:orders.filter(o=>String(o.status||'').toLowerCase().includes('listo')).length}))
  },[upcoming])
`
  const addition=anchor+`
  useEffect(()=>{
    let alive=true,busy=false
    async function syncJourney(){
      if(busy)return
      const result=advanceOperationalJourney(db,new Date().toISOString())
      if(!alive||!result.changed)return
      busy=true
      try{await onSave?.({...db,orders:result.orders})}finally{busy=false}
    }
    syncJourney()
    const timer=setInterval(syncJourney,60000)
    return()=>{alive=false;clearInterval(timer)}
  },[db.orders,db.movements,db.cutBatches,onSave])

  async function confirmFinalAction(order){
    const label=finalActionLabel(order)
    if(!confirm(\`¿Confirmar \${label.toLowerCase()} para el pedido #\${order.number}?\`))return
    const now=new Date().toISOString()
    const orders=(db.orders||[]).map(row=>row.id===order.id?markJourneyFinal(row,now):row)
    await onSave?.({...db,orders})
  }
`
  src=mustReplace(src,anchor,addition,'sincronización de etapas en Centro operativo')

  const start='      <div className="dispatch-grid">'
  const end='    </section>\n\n    <section className="panel">\n      <div className="panel-heading"><div><h3>Próximos 7 días</h3>'
  const i=src.indexOf(start),j=src.indexOf(end,i)
  if(i<0||j<0)throw new Error('journey lab: no se encontró bloque Despachos de hoy')
  const dispatch=`      <div className="dispatch-grid">{Object.entries(dispatch).map(([type,orders])=><div className="dispatch-card" key={type}><h4>{type}</h4><b>{orders.length} pedido{orders.length===1?'':'s'}</b>{orders.map(o=>{const stage=effectiveJourneyEvent(o);const final=journeyIsFinal(o);const ready=stage===JOURNEY_EVENTS.PACKING;return <div className="dispatch-order" key={o.id} style={{display:'block'}}><div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center'}}><span><b>#{o.number} · {o.client}</b><small>{orderPieces(o)} piezas · {o.locality||o.province||''}</small><small className="block">Seguimiento: <b>{journeyStageLabel(stage)}</b></small></span><Badge status={o.status}/></div><button className={final?'ghost':'primary'} disabled={!ready&& !final} style={{width:'100%',marginTop:10,padding:'14px 16px',fontSize:16,fontWeight:900}} onClick={()=>!final&&confirmFinalAction(o)}>{final?'✓ '+finalActionLabel(o)+' CONFIRMADO':ready?finalActionLabel(o):'AÚN NO LISTO PARA DESPACHAR'}</button></div>})}</div>)}{!Object.keys(dispatch).length&&<div className="dash-empty"><b>No hay despachos para hoy.</b></div>}</div>
`
  src=src.slice(0,i)+dispatch+src.slice(j)
  fs.writeFileSync(file,src)
}

console.log('CUSTOMER JOURNEY LAB V2 OK · 4 pasos · WhatsApp sólo inicio/final · corte manual · embalaje +3 h · despacho desde Centro operativo · modificación de placa reconciliada en vista, pendientes, inventario y Journey')