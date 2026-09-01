import './prepare-v25.0.49.mjs'
import fs from 'node:fs'

// v25.0.50: candidata integral para prueba real.
// Protege concurrencia/borrados, corrige pendientes en corte, sanea cortes históricos,
// carga SVG pesada sólo cuando el motor realmente la necesita y usa 1230×580 nativo.

const v2DataFile='src/lib/v2Data.js'
let v2=fs.readFileSync(v2DataFile,'utf8')
if(!v2.includes('loadV2PageSections'))v2+=`
export async function loadV2PageSections(keys,{fullCatalog=false,metadataSvg=false}={}){
  const wanted=uniq(keys)
  if(!metadataSvg||!wanted.includes('svgLibrary'))return loadV2Sections(wanted,{fullCatalog})
  const rest=wanted.filter(k=>k!=='svgLibrary')
  const [base,meta]=await Promise.all([
    rest.length?loadV2Sections(rest,{fullCatalog}):Promise.resolve({data:{},updatedAt:''}),
    loadV2SvgMetadata()
  ])
  return{data:{...(base.data||{}),svgLibrary:meta.data||[]},updatedAt:meta.updatedAt||base.updatedAt||''}
}
`
fs.writeFileSync(v2DataFile,v2)

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')
app=app.replace("import {loadV2Sections,loadV2SectionsWithRevisions,patchV2SectionsChecked,pageSections,pageNeedsFullCatalog} from './lib/v2Data'","import {loadV2Sections,loadV2PageSections,loadV2SectionsWithRevisions,patchV2SectionsChecked,pageSections,pageNeedsFullCatalog} from './lib/v2Data'")
app=app.replace("const result=await loadV2Sections(missing,{fullCatalog:full})","const result=await loadV2PageSections(missing,{fullCatalog:full,metadataSvg:target==='sheetplanner'})")
app=app.replace("if(w===undefined){out.delete(id);continue}\n    if(b!==undefined&&r!==undefined&&stable(r)!==stable(b)&&stable(r)!==stable(w)){conflicts.push(id);continue}","if(w===undefined){if(b!==undefined&&r!==undefined&&stable(r)!==stable(b)){conflicts.push(id);continue}out.delete(id);continue}\n    if(b!==undefined&&r===undefined){conflicts.push(id);continue}\n    if(b!==undefined&&r!==undefined&&stable(r)!==stable(b)&&stable(r)!==stable(w)){conflicts.push(id);continue}")
fs.writeFileSync(appFile,app)

const cutListFile='src/pages/CutList.jsx'
let cutList=fs.readFileSync(cutListFile,'utf8')
cutList=cutList.replace("available[key]=(available[key]||0)+Math.max(0,Number(r.cut||0))","available[key]=(available[key]||0)+Math.max(0,Number(r.cut||0))+Math.max(0,Number(r.inCut||0))+Math.max(0,Number(r.futurePairs||0))")
cutList=cutList.replace("Se parte de Cortadas ahora y se reserva por fecha desde hoy hacia adelante.","Se parte de Cortadas ahora + lo que ya está En corte y se reserva por fecha desde hoy hacia adelante.")
fs.writeFileSync(cutListFile,cutList)

const cutBatchesFile='src/pages/CutBatches.jsx'
let cutBatches=fs.readFileSync(cutBatchesFile,'utf8')
if(!cutBatches.includes('recordedInventoryReversals')){
  const marker='\n\n  useEffect(()=>{'
  const helper=`

  function recordedInventoryReversals(batch,detailPrefix='Corrección de corte'){
    const number=String(batch?.number||'').trim()
    const rows=new Map()
    ;(db.movements||[]).forEach(m=>{
      const belongs=String(m?.batchId||'')===String(batch?.id||'') || Boolean(number&&String(m?.detail||'').includes('Placa #'+number))
      if(!belongs||!m?.figure)return
      const component=m.component||'complete'
      if(!['complete','tapa','base'].includes(component))return
      const positive=component==='complete'
        ?['Entrada extra','Ajuste positivo','Entrada de corte'].includes(m.type)
        :['Entrada extra','Ajuste positivo','Entrada de corte','Ajuste componente positivo'].includes(m.type)
      const negative=component==='complete'
        ?['Salida manual','Ajuste negativo'].includes(m.type)
        :['Salida manual','Ajuste negativo','Ajuste componente negativo'].includes(m.type)
      if(!positive&&!negative)return
      const key=component+'|'+String(m.figure).trim().toLocaleLowerCase('es')
      const row=rows.get(key)||{figure:String(m.figure).trim(),component,qty:0}
      row.qty+=(positive?1:-1)*Math.max(0,Number(m.qty||0))
      rows.set(key,row)
    })
    return [...rows.values()].filter(row=>row.qty>0).map(row=>({
      id:crypto.randomUUID(),batchId:batch.id,date:today(),figure:row.figure,
      ...(row.component==='complete'?{}:{component:row.component}),
      type:row.component==='complete'?'Ajuste negativo':'Ajuste componente negativo',qty:row.qty,
      detail:detailPrefix+' · Placa #'+batch.number+' '+batch.name+' · sólo producción realmente registrada',
      createdAt:new Date().toISOString()
    }))
  }`
  cutBatches=cutBatches.replace(marker,helper+marker)
}
cutBatches=cutBatches.replace("movements.push(...inventoryMovements(editing,-1,'Corrección: retirar contenido anterior'))","movements.push(...recordedInventoryReversals(editing,'Corrección: retirar contenido anterior'))")
cutBatches=cutBatches.replace("const reversals=wasFinished?inventoryMovements(batch,-1,'Corte anulado: retirar del inventario'):[]","const reversals=wasFinished?recordedInventoryReversals(batch,'Corte anulado: retirar del inventario'):[]")
fs.writeFileSync(cutBatchesFile,cutBatches)

const ordersFile='src/pages/OrdersV2.jsx'
const fallbackOrdersFile='src/pages/Orders.jsx'
const actualOrdersFile=fs.existsSync(ordersFile)&&fs.statSync(ordersFile).size>0?ordersFile:fallbackOrdersFile
let orders=fs.readFileSync(actualOrdersFile,'utf8')
orders=orders.replace("async function remove(id){\n    if(confirm('¿Eliminar este pedido?')){\n      setSelected(prev=>prev.filter(x=>x!==id))\n      await onSave({...db,orders:db.orders.filter(o=>o.id!==id)})\n    }\n  }","async function remove(id){\n    const order=db.orders.find(o=>o.id===id)\n    const affectsPhysicalHistory=order&&(order.status==='Entregado'||(order.status!=='Cancelado'&&order.delivery&&String(order.delivery)<todayKey))\n    if(affectsPhysicalHistory)return alert('Este pedido ya forma parte del historial físico de inventario. Para conservar el stock correcto no se puede eliminar; podés consultarlo o corregir su estado.')\n    if(confirm('¿Eliminar este pedido?')){\n      setSelected(prev=>prev.filter(x=>x!==id))\n      await onSave({...db,orders:db.orders.filter(o=>o.id!==id)})\n    }\n  }")
fs.writeFileSync(actualOrdersFile,orders)

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
if(!motor.includes("loadV2SvgFull"))motor=motor.replace("import {today} from '../lib/format'","import {today} from '../lib/format'\nimport {loadV2SvgFull} from '../lib/v2Data'")
motor=motor.replace("const simple=items.find(x=>(x.role||'simple')==='simple'&&x.svgText)","const simple=items.find(x=>(x.role||'simple')==='simple')")
motor=motor.replace("const base=items.find(x=>x.role==='base'&&x.svgText)\n  const tapa=items.find(x=>x.role==='tapa'&&x.svgText)","const base=items.find(x=>x.role==='base')\n  const tapa=items.find(x=>x.role==='tapa')")
if(!motor.includes('async function hydrateUnits')){
  motor=motor.replace("function summarizeUnits(units){",`async function hydrateUnits(units){
  const components=[...new Map((units||[]).flatMap(u=>u.components||[]).map(c=>[String(c?.id||''),c])).values()].filter(c=>c?.id&&!c.svgText)
  if(!components.length)return units
  const loaded=await Promise.all(components.map(async c=>{const row=await loadV2SvgFull(c.id);return row?.data||null}))
  const byId=new Map(loaded.filter(Boolean).map(x=>[String(x.id),x]))
  return (units||[]).map(u=>({...u,components:(u.components||[]).map(c=>byId.get(String(c.id))||c)}))
}
function summarizeUnits(units){`)
}
motor=motor.replace("    const multiplier=Number(active.multiplier||1)\n    const designUnits=unitsForMultiplier(pending.units,multiplier)\n    const industrial=buildIndustrialKits(designUnits)\n    setBusy(true);setElapsed", "    const multiplier=Number(active.multiplier||1)\n    let industrial=null\n    setBusy(true);setElapsed")
motor=motor.replace("    try{\n      const data=await waitJob(active.jobId,active.startedAt)\n      await finishResult(data,multiplier,industrial)","    try{\n      const designUnits=await hydrateUnits(unitsForMultiplier(pending.units,multiplier))\n      industrial=buildIndustrialKits(designUnits)\n      const data=await waitJob(active.jobId,active.startedAt)\n      await finishResult(data,multiplier,industrial)")
motor=motor.replace("    const designUnits=unitsForMultiplier(pending.units,multiplier)\n    const industrial=buildIndustrialKits(designUnits)\n    const payload={widthCm:121.4,heightCm:58,gapCm:.3,targetDensity:75,kits:industrial.kits}\n    setBusy(true);setPlans([]);setElapsed(0);setProgress(`Modo ${multiplier===2?'PLACA DOBLE':'PLACA SIMPLE'} · iniciando Sparrow…`)\n    try{\n      const data=await runPayload(payload,multiplier)\n      await finishResult(data,multiplier,industrial)","    setBusy(true);setPlans([]);setElapsed(0);setProgress(`Modo ${multiplier===2?'PLACA DOBLE':'PLACA SIMPLE'} · cargando SVG necesarios…`)\n    try{\n      const designUnits=await hydrateUnits(unitsForMultiplier(pending.units,multiplier))\n      const invalid=designUnits.flatMap(u=>u.components||[]).filter(c=>!c.svgText)\n      if(invalid.length)throw new Error('No se pudo cargar uno de los SVG necesarios. Volvé a intentar una vez.')\n      const industrial=buildIndustrialKits(designUnits)\n      const payload={widthCm:122.4,heightCm:58,gapCm:.3,targetDensity:75,kits:industrial.kits}\n      setProgress(`Modo ${multiplier===2?'PLACA DOBLE':'PLACA SIMPLE'} · iniciando Sparrow…`)\n      const data=await runPayload(payload,multiplier)\n      await finishResult(data,multiplier,industrial)")
motor=motor.replaceAll('1220mm','1230mm').replaceAll('0 0 1220 580','0 0 1230 580').replaceAll('1220 × 580','1230 × 580').replaceAll('1214 mm útiles','1224 mm útiles').replaceAll('/ 1220 mm','/ 1230 mm')
fs.writeFileSync(motorFile,motor)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.50'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.50'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · candidata integral V2 para prueba real'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.50'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.50'")
fs.writeFileSync(indexFile,index)

console.log('v25.0.50: concurrencia fuerte · historial físico protegido · En corte reservado · SVG bajo demanda · placa nativa 1230×580')
