import fs from 'node:fs'

const sourceFile='scripts/finalize-customer-journey-lab.mjs'
const runtimeFile='scripts/.customer-journey-lab-runtime.mjs'
let lab=fs.readFileSync(sourceFile,'utf8')

// Reparaciones privadas del finalizer del laboratorio para que sobreviva a la
// cadena real de prepare/finalize sin depender de imports o saves idénticos.
const broken="{(b.items||[]).map(i=>`${i.figure}${(i.component&&i.component!=='complete')?` · ${i.component}`:''} × ${Number(i.qty)*(Number(b.multiplier)||1)}`).join(' · ')}"
const fixed="{(b.items||[]).map(i=>String(i.figure)+(i.component&&i.component!=='complete'?' · '+i.component:'')+' × '+(Number(i.qty)*(Number(b.multiplier)||1))).join(' · ')}"
if(lab.includes(broken))lab=lab.replace(broken,fixed)

const oldMotorImport=`  src=mustReplace(src,"import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'","import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'\\nimport {advanceOperationalJourney} from '../lib/customerJourneyOperational'",'import operativo en MotorDefinitivo')`
const newMotorImport=`  src=mustReplace(src,/^(import React[^\\n]*\\n)/m,match=>match+"import {advanceOperationalJourney} from '../lib/customerJourneyOperational'\\n",'import operativo en MotorDefinitivo')`
if(!lab.includes(oldMotorImport))throw new Error('journey predeploy: no se encontró parche de import del Motor')
lab=lab.replace(oldMotorImport,newMotorImport)

const oldCutImport=`  src=mustReplace(src,"import {today} from '../lib/format'","import {today} from '../lib/format'\\nimport {advanceOperationalJourney} from '../lib/customerJourneyOperational'",'import operativo en CutBatches')`
const newCutImport=`  src=mustReplace(src,/^(import React[^\\n]*\\n)/m,match=>match+"import {advanceOperationalJourney} from '../lib/customerJourneyOperational'\\n",'import operativo en CutBatches')`
if(!lab.includes(oldCutImport))throw new Error('journey predeploy: no se encontró parche de import de En corte')
lab=lab.replace(oldCutImport,newCutImport)

const oldCancel=`  src=mustReplace(src,"await onSave({...db,movements:[...(db.movements||[]),...reversals],cutBatches})","const next={...db,movements:[...(db.movements||[]),...reversals],cutBatches}\\n    const journey=advanceOperationalJourney(next,new Date().toISOString())\\n    await onSave({...next,orders:journey.orders})",'reconciliación al cancelar corte')`
const newCancel=`  src=src.replace(/(async function cancel\\(batch\\)\\{[\\s\\S]*?const cutBatches=[^\\n]+\\n)\\s*await onSave\\([^\\n]+\\)/,(full,prefix)=>prefix+"    const next={...db,movements:[...(db.movements||[]),...reversals],cutBatches}\\n    const journey=advanceOperationalJourney(next,new Date().toISOString())\\n    await onSave({...next,orders:journey.orders})")`
if(lab.includes(oldCancel))lab=lab.replace(oldCancel,newCancel)

fs.writeFileSync(runtimeFile,lab)
try{await import('./.customer-journey-lab-runtime.mjs')}finally{try{fs.unlinkSync(runtimeFile)}catch{}}

const dataFile='src/lib/v2Data.js'
let data=fs.readFileSync(dataFile,'utf8')
const sheetOld="  sheetplanner:['orders','figures','svgLibrary','generatedSheets','cutBatches'],"
const sheetNew="  sheetplanner:['orders','movements','figures','svgLibrary','generatedSheets','cutBatches'],"
if(!data.includes(sheetOld)&&!data.includes(sheetNew))throw new Error('journey predeploy: no se encontró PAGE_SECTIONS.sheetplanner')
if(data.includes(sheetOld))data=data.replace(sheetOld,sheetNew)
fs.writeFileSync(dataFile,data)

const file='src/AppV2.jsx'
let src=fs.readFileSync(file,'utf8')
const liveOld="const liveOrderPages=new Set(['orders','new','sheetplanner']);const missing=full?keys:keys.filter(k=>(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
const liveNew="const liveOrderPages=new Set(['orders','new','sheetplanner']);const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):null;const missing=full?keys:keys.filter(k=>Boolean(liveProductionKeys?.has(k))||(k==='orders'&&liveOrderPages.has(target))||!loadedRef.current.has(k))"
if(!src.includes(liveOld)&&!src.includes(liveNew))throw new Error('journey predeploy: no se encontró política live de Generar placas')
if(src.includes(liveOld))src=src.replace(liveOld,liveNew)

const before=`  async function saveData(next){
    const keys=changedKeys(db,next)`
const after=`  async function saveData(next){
    if(Array.isArray(next?.orders)){
      const existingIds=new Set((db.orders||[]).map(o=>String(o?.id||'')))
      const now=new Date().toISOString()
      next={...next,orders:next.orders.map(order=>{
        const id=String(order?.id||'')
        if(!order||existingIds.has(id)||order?.journey?.enabled===true)return order
        return {...order,journey:{enabled:true,stage:'confirmed',confirmedAt:now,whatsappConfirmedStatus:'simulated-private'}}
      })}
    }
    const keys=changedKeys(db,next)`
if(src.includes(before))src=src.replace(before,after)
else if(!src.includes("whatsappConfirmedStatus:'simulated-private'"))throw new Error('journey predeploy: no se encontró saveData para habilitar pedidos nuevos')

fs.writeFileSync(file,src)
if(!src.includes("whatsappConfirmedStatus:'simulated-private'"))throw new Error('journey predeploy: no quedó activación segura de pedidos nuevos')
if(!data.includes("sheetplanner:['orders','movements'"))throw new Error('journey predeploy: Generar placas sigue sin movements')
if(!src.includes("liveProductionKeys=target==='sheetplanner'"))throw new Error('journey predeploy: Generar placas no refresca producción real')

const opsFile='src/pages/OperationsHub.jsx'
let ops=fs.readFileSync(opsFile,'utf8')
const reactOld="import React,{useEffect,useMemo} from 'react'"
const reactNew="import React,{useEffect,useMemo,useState} from 'react'"
if(!ops.includes(reactOld)&&!ops.includes(reactNew))throw new Error('journey control: no se encontró import React de Centro operativo')
if(ops.includes(reactOld))ops=ops.replace(reactOld,reactNew)
const journeyImportOld="import {JOURNEY_EVENTS} from '../lib/customerJourney'"
const journeyImportNew="import {JOURNEY_EVENTS,eventForFinalAction,journeyMessage,trackingUrl} from '../lib/customerJourney'"
if(!ops.includes(journeyImportOld)&&!ops.includes(journeyImportNew))throw new Error('journey control: no se encontró import de Customer Journey')
if(ops.includes(journeyImportOld))ops=ops.replace(journeyImportOld,journeyImportNew)

const exportOld='export default function OperationsHub({db,onSave,go}){'
const helper=`const JOURNEY_REVIEW_URL='https://tu-vida-en-tinta-catalogo-v2.vercel.app/opiniones'
function journeyTime(value){
  if(!value)return 'Pendiente'
  const date=new Date(value)
  return Number.isNaN(date.getTime())?'Pendiente':date.toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'})
}
function messageWithLinks(text){
  return String(text||'').split(/(https?:\\/\\/[^\\s]+)/g).map((part,index)=>/^https?:\\/\\//.test(part)?<a key={index} href={part} target="_blank" rel="noopener noreferrer" style={{fontWeight:800,textDecoration:'underline'}}>{part}</a>:<React.Fragment key={index}>{part}</React.Fragment>)
}
function JourneyControl({order,onClose}){
  if(!order)return null
  const journey=order.journey||{},enabled=journey.enabled===true,current=effectiveJourneyEvent(order),finalEvent=eventForFinalAction(order)
  const currentIndex=current===JOURNEY_EVENTS.PACKING?2:[JOURNEY_EVENTS.DISPATCHED,JOURNEY_EVENTS.READY_PICKUP].includes(current)?3:current===JOURNEY_EVENTS.PRODUCTION_CUT?1:0
  const steps=[
    {label:'Pedido agendado',at:journey.confirmedAt},
    {label:'En producción / corte',at:journey.productionAt,detail:journey.cutCompletedAt?'Corte confirmado '+journeyTime(journey.cutCompletedAt):''},
    {label:'Para embalar',at:journey.packingAt},
    {label:finalEvent===JOURNEY_EVENTS.READY_PICKUP?'Listo para retirar':'Despachado',at:journey.finalAt}
  ]
  const firstMessage=enabled?journeyMessage(order,JOURNEY_EVENTS.CONFIRMED):''
  const finalMessage=enabled?journeyMessage(order,finalEvent,{reviewUrl:JOURNEY_REVIEW_URL}):''
  const publicTracking=enabled?trackingUrl(order):''
  return <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(15,23,42,.58)',display:'grid',placeItems:'center',padding:18}} onMouseDown={e=>{if(e.target===e.currentTarget)onClose?.()}}>
    <div style={{width:'min(760px,96vw)',maxHeight:'90vh',overflow:'auto',background:'#fff',borderRadius:18,padding:18,boxShadow:'0 24px 70px rgba(0,0,0,.3)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}><div><small>CONTROL CUSTOMER JOURNEY</small><h3 style={{margin:'3px 0'}}>Pedido #{order.number} · {order.client}</h3><span className="block">Estado actual: <b>{enabled?journeyStageLabel(current):'Seguimiento no activado para este pedido'}</b></span></div><button className="ghost" onClick={onClose}>Cerrar ×</button></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8,margin:'16px 0'}}>{steps.map((step,index)=><div key={step.label} style={{border:index<=currentIndex&&enabled?'2px solid #7c3aed':'1px solid #e5e7eb',borderRadius:12,padding:10,background:index<currentIndex&&enabled?'#f5f3ff':'#fff'}}><small>PASO {index+1}</small><b className="block" style={{marginTop:3}}>{index<currentIndex&&enabled?'✓ ':''}{step.label}</b><small className="block">{enabled?journeyTime(step.at):'—'}</small>{step.detail&&<small className="block">{step.detail}</small>}</div>)}</div>
      {enabled&&<><div className="notice" style={{marginBottom:12}}><b>Enlaces de control</b><span>{publicTracking?<><a href={publicTracking} target="_blank" rel="noopener noreferrer">Abrir seguimiento del cliente ↗</a><br/></>:<>El pedido todavía no tiene enlace público de seguimiento generado.<br/></>}<a href={JOURNEY_REVIEW_URL} target="_blank" rel="noopener noreferrer">Abrir Opiniones del catálogo ↗</a></span></div>
      <div style={{display:'grid',gap:12}}><div style={{border:'1px solid #e5e7eb',borderRadius:14,padding:14}}><div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><b>WhatsApp 1 · Confirmación</b><span className="status-text ok">SIMULADO · NO ENVIADO</span></div><small className="block" style={{margin:'5px 0 10px'}}>Adjunto previsto: <b>pedido.jpg</b></small><div style={{whiteSpace:'pre-wrap',lineHeight:1.5,background:'#f8fafc',borderRadius:10,padding:12}}>{messageWithLinks(firstMessage)}</div></div>
      <div style={{border:'1px solid #e5e7eb',borderRadius:14,padding:14}}><div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><b>WhatsApp 2 · {finalEvent===JOURNEY_EVENTS.READY_PICKUP?'Listo para retirar':'Despacho'}</b><span className="status-text ok">{journeyIsFinal(order)?'SIMULADO FINAL · NO ENVIADO':'VISTA PREVIA · NO ENVIADO'}</span></div><div style={{whiteSpace:'pre-wrap',lineHeight:1.5,background:'#f8fafc',borderRadius:10,padding:12,marginTop:10}}>{messageWithLinks(finalMessage)}</div></div></div></>}
      {!enabled&&<div className="notice"><b>Pedido anterior al Customer Journey</b><span>Por seguridad, los pedidos históricos no se activan automáticamente.</span></div>}
    </div>
  </div>
}

${exportOld}`
if(!ops.includes('function JourneyControl({order,onClose})')){
  if(!ops.includes(exportOld))throw new Error('journey control: no se encontró OperationsHub')
  ops=ops.replace(exportOld,helper)
}
const stateAnchor="  const today=todayArgentinaISO(),end=addDaysIso(today,7)"
if(!ops.includes("const [journeyPreview,setJourneyPreview]=useState(null)")){
  if(!ops.includes(stateAnchor))throw new Error('journey control: no se encontró estado inicial de Centro operativo')
  ops=ops.replace(stateAnchor,"  const [journeyPreview,setJourneyPreview]=useState(null)\n"+stateAnchor)
}
const actionNeedle="</button></div>})}</div>)}{!Object.keys(dispatch).length"
const actionReplacement="</button><button className=\"ghost\" style={{width:'100%',marginTop:8}} onClick={()=>setJourneyPreview(o)}>Ver seguimiento</button></div>})}</div>)}{!Object.keys(dispatch).length"
if(!ops.includes('onClick={()=>setJourneyPreview(o)}>Ver seguimiento</button>')){
  if(!ops.includes(actionNeedle))throw new Error('journey control: no se encontró acción de despacho')
  ops=ops.replace(actionNeedle,actionReplacement)
}
const closeAnchor='  </>\n}'
if(!ops.includes('<JourneyControl order={journeyPreview}')){
  if(!ops.includes(closeAnchor))throw new Error('journey control: no se encontró cierre de Centro operativo')
  ops=ops.replace(closeAnchor,"    {journeyPreview&&<JourneyControl order={journeyPreview} onClose={()=>setJourneyPreview(null)}/>}\n"+closeAnchor)
}
fs.writeFileSync(opsFile,ops)
if(!ops.includes('Ver seguimiento</button>')||!ops.includes('WhatsApp 1 · Confirmación')||!ops.includes('WhatsApp 2 ·'))throw new Error('journey control: validación visual incompleta')

console.log('CUSTOMER JOURNEY PREDEPLOY OK · pedidos nuevos aislados · pendientes frescos · control visual + WhatsApp simulado')
