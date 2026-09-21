import React,{useEffect,useMemo,useState} from 'react'
import {Title} from '../components/UI'
import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'
import {today} from '../lib/format'
import {solveCompleteKitsWithIronNestLab,resumeIronNestLabJob} from '../lib/ironnestLab'

const LAB_STORAGE='polifan-motor-lab-last-plan-v4'
const ACTIVE_JOB_STORAGE='polifan-ironnest-active-job-v2'

function loadSavedPlans(){
  try{return JSON.parse(localStorage.getItem(LAB_STORAGE)||'[]')||[]}
  catch{return []}
}
function savePlans(plans){
  try{
    const compact=plans.map(p=>({...p,units:(p.units||[]).map(u=>({figure:u.figure,date:u.date||'',repairComponent:u.repairComponent||'complete'}))}))
    localStorage.setItem(LAB_STORAGE,JSON.stringify(compact))
  }catch{}
}
function loadActiveJob(){
  try{return JSON.parse(localStorage.getItem(ACTIVE_JOB_STORAGE)||'null')}
  catch{return null}
}
function saveActiveJob(job){try{localStorage.setItem(ACTIVE_JOB_STORAGE,JSON.stringify(job))}catch{}}
function clearActiveJob(){try{localStorage.removeItem(ACTIVE_JOB_STORAGE)}catch{}}
function planStamp(plan){return String(plan?.jobId||plan?.id||'').slice(0,8)||'sin-id'}
function downloadSvg(name,text){
  if(!text)return
  const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}))
  const a=document.createElement('a')
  a.href=url
  a.download=String(name||'placa.svg').replace(/\.svg$/i,'')+'__IRONNEST_CERTIFICADO.svg'
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
}
function parseSvg(svg){
  try{
    const doc=new DOMParser().parseFromString(svg,'image/svg+xml')
    const root=doc.documentElement
    const raw=root.getAttribute('viewBox')||`0 0 ${parseFloat(root.getAttribute('width'))||100} ${parseFloat(root.getAttribute('height'))||100}`
    const nums=String(raw).trim().split(/[ ,]+/).map(Number)
    const viewBox=nums.length===4&&nums.every(Number.isFinite)?nums:[0,0,100,100]
    return {root,viewBox}
  }catch{return null}
}
function cleanInner(root){return [...root.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('')}
function svgPhysicalCm(svgText){
  try{
    const root=new DOMParser().parseFromString(svgText,'image/svg+xml').documentElement
    const toCm=value=>{const m=String(value||'').trim().match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/i);if(!m)return 0;const k={mm:.1,cm:1,in:2.54,pt:2.54/72,pc:2.54/6,px:2.54/96};return Number(m[1])*(k[(m[2]||'px').toLowerCase()]||0)}
    return {widthCm:toCm(root.getAttribute('width')),heightCm:toCm(root.getAttribute('height'))}
  }catch{return {widthCm:0,heightCm:0}}
}

function cleanAlias(value){return String(value||'').replace(/\.svg$/i,'').replace(/\s*[·_–—-]\s*(tapa|base|figura|simple|capa.*)$/i,'').trim()}
function aliasesForItem(item){return [...new Set([item?.productName,item?.modelName,item?.name].map(cleanAlias).map(normalizeFigureKey).filter(Boolean))]}
function completeComponents(items){
  const simple=items.find(x=>(x.role||'simple')==='simple'&&x.svgText)
  if(simple)return [simple]
  const base=items.find(x=>x.role==='base'&&x.svgText)
  const tapa=items.find(x=>x.role==='tapa'&&x.svgText)
  return base&&tapa?[base,tapa]:null
}
function libraryIndex(db){
  const groups=new Map()
  ;(db.svgLibrary||[]).forEach(item=>{
    const aliases=aliasesForItem(item)
    const key=String(item?.modelId||item?.productId||aliases[0]||item?.id||'')
    if(!key)return
    if(!groups.has(key))groups.set(key,{key,items:[],aliases:new Set()})
    const group=groups.get(key)
    group.items.push(item);aliases.forEach(a=>group.aliases.add(a))
  })
  const list=[...groups.values()].map(g=>({...g,aliases:[...g.aliases]}))
  const exact=new Map()
  list.forEach(group=>group.aliases.forEach(alias=>{
    if(!exact.has(alias))exact.set(alias,[])
    exact.get(alias).push(group)
  }))
  return {groups:list,exact}
}
function uniqueComplete(groups){
  const rows=[]
  groups.forEach(group=>{const comps=completeComponents(group.items);if(comps)rows.push({key:group.key,comps})})
  const unique=[...new Map(rows.map(x=>[x.key,x])).values()]
  return unique.length===1?unique[0].comps:null
}
function componentsForFigure(index,figure){
  const target=normalizeFigureKey(figure)
  if(!target)return null
  const exact=uniqueComplete(index.exact.get(target)||[])
  if(exact)return exact
  const flexible=index.groups.filter(group=>group.aliases.some(alias=>alias===target||alias.includes(target)||target.includes(alias)))
  return uniqueComplete(flexible)
}
function pendingUnits(db,index){
  const units=[],missing=new Map()
  pendingCutByDelivery(db).forEach(group=>group.rows.forEach(row=>{
    const allComps=componentsForFigure(index,row.figure)
    const component=row.component||'complete'
    const comps=component==='complete'?allComps:(allComps||[]).filter(comp=>(comp.role||'simple')===component)
    if(!comps?.length){const missingKey=component==='complete'?row.figure:`${row.figure} · ${component}`;missing.set(missingKey,(missing.get(missingKey)||0)+Number(row.qty||0));return}
    for(let i=0;i<Number(row.qty||0);i++)units.push({figure:row.figure,date:group.date||'',orders:group.orders||[],components:comps,repairComponent:component})
  }))
  return {units,missing:[...missing.entries()].map(([figure,qty])=>({figure,qty}))}
}
function unitsForMultiplier(units,multiplier){
  const m=Math.max(1,Number(multiplier)||1)
  if(m<=1)return units.slice()
  const seen=new Map()
  return units.filter(unit=>{
    const key=normalizeFigureKey(unit.figure)
    const n=seen.get(key)||0
    seen.set(key,n+1)
    return n%m===0
  })
}
function summarizeUnits(units){
  const m=new Map();units.forEach(u=>m.set(u.figure,(m.get(u.figure)||0)+1))
  return [...m.entries()].map(([figure,qty])=>({figure,qty}))
}
function buildIndustrialKits(units){
  const kits=[],partMap=new Map(),unitMap=new Map()
  units.slice(0,32).forEach((unit,kitIndex)=>{
    const kitId=`auto-${kitIndex}-${normalizeFigureKey(unit.figure)}`
    unitMap.set(kitId,unit)
    const parts=unit.components.map((comp,partIndex)=>{
      const instanceId=`${kitId}-p${partIndex}`
      const physical=svgPhysicalCm(comp.svgText),parsed=parseSvg(comp.svgText),vb=parsed?.viewBox||[0,0,0,0],ratio=Number(vb[2])>0&&Number(vb[3])>0?Number(vb[2])/Number(vb[3]):0
      let widthCm=Number(comp.sourceWidthCm||comp.widthCm||comp.svgMeta?.widthCm||physical.widthCm),heightCm=Number(comp.sourceHeightCm||comp.heightCm||comp.svgMeta?.heightCm||physical.heightCm)
      if(!(widthCm>0&&heightCm>0)&&ratio>0){const knownW=Number(comp.originalWidthCm||comp.svgMeta?.originalWidthCm||0),knownH=Number(comp.originalHeightCm||comp.svgMeta?.originalHeightCm||0);if(knownW>0){widthCm=knownW;heightCm=knownW/ratio}else if(knownH>0){heightCm=knownH;widthCm=knownH*ratio}}
      if(!(widthCm>0&&heightCm>0))throw new Error(`La Biblioteca SVG no tiene medidas físicas recuperables para ${unit.figure} (${comp.role||'pieza'}).`)
      const row={instanceId,kitId,figure:unit.figure,name:comp.name||`${unit.figure} ${comp.role||'pieza'}`,role:comp.role||'simple',svgText:comp.svgText,sourceWidthCm:widthCm,sourceHeightCm:heightCm,widthCm,heightCm,allowRotate:true}
      partMap.set(instanceId,{...row,original:comp});return row
    })
    kits.push({kitId,figure:unit.figure,date:unit.date||'',priority:kitIndex,parts})
  })
  return {kits,partMap,unitMap}
}
function composeIndustrialSvg(placements,partMap){
  const pieces=[]
  placements.forEach((p,n)=>{
    const meta=partMap.get(String(p.instanceId||''));if(!meta)return
    const parsed=parseSvg(meta.svgText);if(!parsed)return
    const [vx,vy,vw0,vh0]=parsed.viewBox
    const vw=Math.max(1e-9,Number(vw0)||1),vh=Math.max(1e-9,Number(vh0)||1)
    const wmm=Math.max(1,Number(meta.sourceWidthCm||meta.widthCm||1)*10),hmm=Math.max(1,Number(meta.sourceHeightCm||meta.heightCm||1)*10)
    const sx=wmm/vw,sy=hmm/vh
    const x=Number(p.xCm||0)*10,y=Number(p.yCm||0)*10,angle=Number(p.angle||0)
    const trimX=Number(p.trimXCm||0)*10,trimY=Number(p.trimYCm||0)*10
    const transform=`translate(${x} ${y}) rotate(${angle}) translate(${-trimX} ${-trimY}) scale(${sx} ${sy}) translate(${-vx} ${-vy})`
    pieces.push(`<g data-industrial-piece="${n}" data-kit="${String(p.kitId||'')}" data-instance="${String(p.instanceId||'')}" data-partial-extra="${p.partialExtra?'1':'0'}" transform="${transform}">${cleanInner(parsed.root)}</g>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1230mm" height="580mm" viewBox="0 0 1230 580" overflow="hidden">${pieces.join('')}</svg>`
}

export default function MotorDefinitivo({db,onSave}){
  const index=useMemo(()=>libraryIndex(db),[db.svgLibrary])
  const pending=useMemo(()=>pendingUnits(db,index),[db,index])
  const [plans,setPlans]=useState(loadSavedPlans)
  const [busy,setBusy]=useState(false)
  const [progress,setProgress]=useState('')
  const [elapsed,setElapsed]=useState(0)
  const [choosingMode,setChoosingMode]=useState(false)
  const [activeJob,setActiveJob]=useState(()=>loadActiveJob())
  const [registeringId,setRegisteringId]=useState('')
  const [registerMessage,setRegisterMessage]=useState('')

  useEffect(()=>{if(plans.length)savePlans(plans)},[plans])
  useEffect(()=>{
    const active=loadActiveJob()
    if(active?.jobId){setActiveJob(active);resumeActiveJob(active)}
  },[])

  async function resumeActiveJob(active){
    if(!active?.jobId)return
    const multiplier=Math.max(1,Number(active.multiplier||1))
    const designUnits=unitsForMultiplier(pending.units,multiplier),industrial=buildIndustrialKits(designUnits)
    const selectedKits=(active.kitIds||[]).map(id=>industrial.kits.find(k=>String(k.kitId)===String(id))).filter(Boolean)
    if(!selectedKits.length){clearActiveJob();setActiveJob(null);return}
    const overallStartedAt=Number(active.overallStartedAt||active.startedAt||Date.now()),jobStartedAt=Number(active.jobStartedAt||active.startedAt||Date.now())
    setBusy(true);setElapsed(Math.max(0,Math.round((Date.now()-overallStartedAt)/1000)))
    setProgress(`Recuperando trabajo IronNest ${String(active.jobId).slice(0,8)}…`)
    try{
      const data=await resumeIronNestLabJob(active.jobId,{startedAt:jobStartedAt,onProgress:p=>{setElapsed(Math.round((Date.now()-overallStartedAt)/1000));setProgress(p?.stage||'Recuperando trabajo IronNest…')}})
      const validation=data?.layoutValidation||{},minGap=Number(validation.minimumMeasuredGapMm),conflicts=Number(validation.conflicts??validation.collisionCount??0),border=Number((validation.strictOutsidePlate||[]).length+(validation.outsidePlate||[]).length)
      if(!data?.ok||!validation.ok||!Number.isFinite(minGap)||minGap<3||conflicts!==0||border!==0)throw new Error(data?.error||'El trabajo recuperado no superó la certificación geométrica.')
      const selectedUnits=selectedKits.map(k=>industrial.unitMap.get(String(k.kitId))).filter(Boolean),composed=composeIndustrialSvg(data.placements||[],industrial.partMap),produced=Math.min(pending.units.length,selectedUnits.length*multiplier)
      const plan={id:crypto.randomUUID(),jobId:String(active.jobId),createdAt:new Date().toISOString(),number:1,units:selectedUnits,summary:summarizeUnits(selectedUnits),date:selectedUnits.map(u=>u.date).filter(Boolean).sort()[0]||today(),registered:false,deferred:Math.max(0,pending.units.length-produced),status:'CERTIFICADO',minGap:minGap.toFixed(4),conflicts:0,border:0,seconds:Number(data.elapsedSeconds||0).toFixed(2),svgText:composed,error:'',density:Number(data.geometricOccupancyPct??0),stripWidthMm:Number(data.usedWidthMm||0),industrialSeconds:Number(data.elapsedSeconds||0),rotationStep:'IronNest',reachedMinimum:selectedUnits.length>=10,candidatePool:industrial.kits.length,rejectedCount:Math.max(0,industrial.kits.length-selectedUnits.length),source:'IronNest producción · trabajo recuperado',partialExtra:null,targetDensityReached:null,fixedHoleFill:false,multiplier,produced}
      setPlans([plan]);savePlans([plan]);clearActiveJob();setActiveJob(null);setProgress(`IronNest recuperado · ${selectedUnits.length} figuras completas · gap ${minGap.toFixed(4)} mm`)
    }catch(error){clearActiveJob();setActiveJob(null);setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:error.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])}
    finally{setBusy(false)}
  }

 async function generateAutomatic(multiplier=1){
  setChoosingMode(false)
  if(!pending.units.length)return alert(pending.missing.length?'No hay piezas generables. Revisá los SVG faltantes en Biblioteca SVG.':'No hay piezas pendientes para cortar.')
  const designUnits=unitsForMultiplier(pending.units,multiplier),industrial=buildIndustrialKits(designUnits)
  setBusy(true);setPlans([]);setElapsed(0)
  const started=Date.now()
  setProgress(`Modo PLACA ×${multiplier} · IronNest · buscando 10 figuras completas…`)
  try{
    const data=await solveCompleteKitsWithIronNestLab(industrial.kits,{
      targetComplete:Math.min(10,industrial.kits.length),maxGrowth:16,optimizationMode:'fast',
      onProgress:p=>{setElapsed(Math.round((Date.now()-started)/1000));setProgress(p?.stage||'IronNest calculando…')},
      onJobStarted:j=>{const active={jobId:j.jobId,kitIds:j.kitIds||[],multiplier,startedAt:started,overallStartedAt:started,jobStartedAt:j.startedAt||Date.now()};saveActiveJob(active);setActiveJob(active)}
    })
    const validation=data?.layoutValidation||{}
    if(!data?.ok||!validation.ok)throw new Error(data?.error||'IronNest no devolvió una placa geométricamente válida.')
    const selectedKits=data.selectedKits||[]
    const selectedUnits=selectedKits.map(k=>industrial.unitMap.get(String(k.kitId))).filter(Boolean)
    if(!selectedUnits.length)throw new Error('IronNest no devolvió figuras completas de los pedidos pendientes.')
    const minGap=Number(validation.minimumMeasuredGapMm)
    const conflicts=Number(validation.conflicts??validation.collisionCount??0)
    const border=Number((validation.strictOutsidePlate||[]).length+(validation.outsidePlate||[]).length)
    if(!Number.isFinite(minGap)||minGap<3||conflicts!==0||border!==0)throw new Error(`La placa fue rechazada por el certificador geométrico: gap ${Number.isFinite(minGap)?minGap.toFixed(3):'-'} mm, conflictos ${conflicts}, borde ${border}.`)
    const composed=composeIndustrialSvg(data.placements||[],industrial.partMap)
    const produced=Math.min(pending.units.length,selectedUnits.length*multiplier)
    const plan={id:crypto.randomUUID(),jobId:String(data.jobId||''),createdAt:new Date().toISOString(),number:1,units:selectedUnits,summary:summarizeUnits(selectedUnits),date:selectedUnits.map(u=>u.date).filter(Boolean).sort()[0]||today(),registered:false,deferred:Math.max(0,pending.units.length-produced),status:'CERTIFICADO',minGap:minGap.toFixed(4),conflicts:0,border:0,seconds:Number(data.elapsedSeconds||((Date.now()-started)/1000)).toFixed(2),svgText:composed,error:'',density:Number(data.geometricOccupancyPct??data.density??0),stripWidthMm:Number(data.usedWidthMm||0),industrialSeconds:Number(data.elapsedSeconds||0),rotationStep:'IronNest',reachedMinimum:selectedUnits.length>=Math.min(10,industrial.kits.length),candidatePool:industrial.kits.length,rejectedCount:Math.max(0,industrial.kits.length-selectedUnits.length),source:'IronNest producción · crecimiento por kits completos',partialExtra:null,targetDensityReached:null,fixedHoleFill:false,multiplier,produced}
    setPlans([plan]);savePlans([plan]);clearActiveJob();setActiveJob(null)
    setProgress(`IronNest finalizado · ${selectedUnits.length} figuras completas · gap ${minGap.toFixed(4)} mm`)
  }catch(error){
    clearActiveJob();setActiveJob(null);setPlans([{id:crypto.randomUUID(),number:1,units:[],summary:[],date:today(),registered:false,deferred:pending.units.length,status:'ERROR',error:error.message,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,multiplier}])
  }finally{setBusy(false)}
 }

  async function registerPlan(plan){
    if(registeringId)return
    if(!String(plan.status||'').startsWith('CERTIFICADO')||!plan.svgText||plan.registered){setRegisterMessage('Esta placa no está disponible para registrar.');return}
    if(activeJob?.jobId){setRegisterMessage('Hay un cálculo IronNest en curso. Esperá a que termine antes de registrar el corte.');return}
    if(!plan.jobId){setRegisterMessage('Esta placa es anterior al sistema de identificación de trabajos. No se puede registrar con seguridad. Generá una placa nueva.');return}
    setRegisteringId(plan.id);setRegisterMessage('Registrando corte terminado…')
    try{
      const multiplier=Number(plan.multiplier||1)
      const number=String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0')
      const items=[...(plan.units||[]).reduce((acc,unit)=>{const figure=unit.figure,component=unit.repairComponent||unit.component||'complete';const found=acc.find(x=>x.figure===figure&&x.component===component);if(found)found.qty+=1;else acc.push({figure,component,qty:1});return acc},[]),...(plan.partialExtras||[plan.partialExtra]).filter(Boolean)]
      if(!items.length)throw new Error('La placa no contiene figuras para registrar.')
      const now=new Date().toISOString()
      const batch={id:crypto.randomUUID(),number,date:plan.date||today(),name:`Placa automática IronNest ${plan.date||today()}`,status:'Terminada',finishedAt:now,autoFinished:true,sourceJobId:String(plan.jobId),notes:`IronNest trabajo ${planStamp(plan)} · ${plan.units.length} diseños · placa ×${multiplier} · ocupación ${Number(plan.density||0).toFixed(1)}% · ancho usado ${Number(plan.stripWidthMm||0).toFixed(0)} mm · separación ${plan.minGap} mm`,multiplier,items,createdAt:now}
      const movements=items.map(i=>{const component=i.component||'complete';const componentLabel=component==='tapa'?'tapa':component==='base'?'base':'figura completa';return {id:crypto.randomUUID(),batchId:batch.id,date:today(),figure:i.figure,component,type:'Entrada de corte',qty:Number(i.qty)*Math.max(1,multiplier),detail:`Alta automática desde SVG · Trabajo ${planStamp(plan)} · Placa #${number} · ${componentLabel} · corte ×${multiplier}`,createdAt:now}})
      const result=await onSave({...db,movements:[...(db.movements||[]),...movements],cutBatches:[...(db.cutBatches||[]),batch]})
      if(result?.ok===false)throw result.error||new Error('No se pudo guardar el corte en Supabase.')
      const nextPlans=plans.map(x=>x.id===plan.id?{...x,registered:true,batchNumber:number}:x)
      setPlans(nextPlans);savePlans(nextPlans)
      setRegisterMessage(`✅ Corte registrado · Trabajo ${planStamp(plan)} · Placa #${number} · ${movements.reduce((n,m)=>n+Number(m.qty||0),0)} piezas incorporadas.`)
    }catch(error){
      console.error('No se pudo registrar el corte terminado',error)
      setRegisterMessage('❌ No se pudo registrar. El Inventario no fue modificado. '+(error?.message||'Error desconocido.'))
    }finally{setRegisteringId('')}
  }

  return <>
    <Title title="Generar placas · Motor IronNest + Certificador" sub="IronNest prioriza figuras completas y después intenta agregar más mientras entren físicamente dentro de la placa." actions={<button className="primary" disabled={busy||!pending.units.length} onClick={()=>setChoosingMode(true)}>{busy?'Calculando…':'Generar una placa'}</button>}/>
    {choosingMode&&<div className="panel" style={{border:'2px solid #d92d8a'}}><b className="block big">¿Qué vas a cortar?</b><span className="block" style={{margin:'8px 0 14px'}}>Elegilo antes de diseñar para que IronNest calcule las cantidades correctas.</span><div className="row-actions"><button className="ghost" onClick={()=>generateAutomatic(1)}>Placa simple · ×1</button><button className="primary" onClick={()=>generateAutomatic(2)}>Placa doble · ×2</button><button className="primary" onClick={()=>generateAutomatic(3)}>Placa triple · ×3</button><button className="primary" onClick={()=>generateAutomatic(4)}>Placa cuádruple · ×4</button><button className="ghost" onClick={()=>setChoosingMode(false)}>Cancelar</button></div><small className="block" style={{marginTop:10}}>Elegí ×1, ×2, ×3 o ×4 según cuántas copias vas a cortar físicamente de la misma placa.</small></div>}
    <div className="notice"><b>Motor IronNest de producción</b><span>La placa real es 1230 × 580 mm. IronNest sólo acepta placas que superan la validación geométrica y conservan figuras completas.</span></div>
    <div className="panel"><div className="form-grid">
      <div><small>Figuras pendientes con SVG</small><b className="block big">{pending.units.length}</b></div>
      <div><small>Figuras sin SVG completo</small><b className={'block big '+(pending.missing.length?'red-text':'green-text')}>{pending.missing.reduce((a,x)=>a+x.qty,0)}</b></div>
      <div><small>Criterio productivo</small><b className="block big">10 base · crecer mientras entre</b><small className="block">objetivo ≥75%, sin descartar 11/12 válidas</small></div>
      <div><small>Arquitectura</small><b className="block big">IronNest · certificación geométrica</b></div>
    </div>
    {pending.missing.length>0&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>Faltan SVG en Biblioteca</b><span>{pending.missing.map(x=>`${x.figure} × ${x.qty}`).join(' · ')}</span></div>}
    {progress&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>{progress}</b><span>{activeJob?.jobId?`Trabajo ${String(activeJob.jobId).slice(0,8)} · modo ×${Number(activeJob.multiplier||1)} · iniciado ${new Date(Number(activeJob.overallStartedAt||activeJob.startedAt||Date.now())).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} · transcurrido ${Math.max(0,Math.round((Date.now()-Number(activeJob.overallStartedAt||activeJob.startedAt||Date.now()))/1000))}s`:`Tiempo total: ${elapsed}s`}</span></div>}
    {registerMessage&&<div className="notice" style={{marginTop:12,marginBottom:0}}><b>{registerMessage}</b></div>}
    </div>
    <div className="panel table-wrap"><table><thead><tr><th>Placa</th><th>Contenido</th><th>Estado</th><th>Gap certificado</th><th>Conflictos</th><th>Borde</th><th>Ocupación</th><th>Acciones</th></tr></thead><tbody>
      {plans.map(plan=>{const ok=String(plan.status||'').startsWith('CERTIFICADO'),stale=Boolean(activeJob?.jobId);return <tr key={plan.id}>
        <td><b>{stale?'Resultado anterior · ':''}Placa {plan.number}</b>{plan.jobId?<small className="block">Trabajo: {planStamp(plan)}</small>:<small className="block red-text"><b>Resultado legado · no registrar</b></small>}{stale&&<small className="block red-text"><b>NO corresponde al cálculo en curso</b></small>}<small className="block">Modo: {`×${Number(plan.multiplier||1)}`}</small><small className="block">Entrega prioritaria: {plan.date}</small><small className="block"><b>{plan.units.length} figuras completas</b> · {plan.units.length*Number(plan.multiplier||1)} cortes reales</small><small className="block">{plan.deferred} quedan pendientes</small></td>
        <td>{plan.summary.map(x=>`${x.figure} × ${x.qty}${Number(plan.multiplier||1)>1?' (sale ×'+(x.qty*Number(plan.multiplier||1))+')':''}`).join(', ')||'-'}</td>
        <td><b className={ok?'green-text':'red-text'}>{plan.status}</b>{plan.error&&<small className="block red-text">{plan.error}</small>}</td>
        <td><b>{plan.minGap} mm</b>{Number(plan.industrialSeconds)>0&&<small className="block">cálculo: {Number(plan.industrialSeconds).toFixed(1)} s</small>}</td><td className={Number(plan.conflicts)===0?'green-text':'red-text'}>{plan.conflicts}</td><td className={Number(plan.border)===0?'green-text':'red-text'}>{plan.border}</td>
        <td>{Number.isFinite(plan.density)?`${plan.density.toFixed(1)}%`:'-'}{Number(plan.stripWidthMm)>0&&<small className="block">ancho usado: {plan.stripWidthMm.toFixed(0)} / 1230 mm</small>}{Number.isFinite(plan.density)&&<small className={'block '+(plan.density>=75?'green-text':'')}>{plan.density>=75?'Objetivo ≥75% alcanzado':'Mejor placa válida encontrada'}</small>}</td>
        <td className="row-actions">{ok&&!stale&&plan.svgText&&<button className="ghost" onClick={()=>downloadSvg(`pedido-${today()}-placa-${plan.number}-${planStamp(plan)}`,plan.svgText)}>Descargar SVG</button>}{ok&&!stale&&!plan.registered&&<button className="primary" disabled={registeringId===plan.id} onClick={()=>registerPlan(plan)}>{registeringId===plan.id?'Guardando…':'Registrar corte terminado'}</button>}{plan.registered&&<span className="green-text"><b>Terminada #{plan.batchNumber}</b></span>}</td>
      </tr>})}
      {!plans.length&&<tr><td colSpan="8">Tocá “Generar una placa”. Elegí ×1, ×2, ×3 o ×4. Si recargás o salís mientras calcula, IronNest retoma automáticamente el trabajo activo.</td></tr>}
    </tbody></table></div>
  </>
}