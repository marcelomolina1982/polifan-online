import fs from 'node:fs'
function mustReplace(text,pattern,replacement,label){const next=typeof pattern==='string'?text.replace(pattern,replacement):text.replace(pattern,replacement);if(next===text)throw new Error(`journey integration: no se encontró ${label}`);return next}
{
 const file='src/pages/MotorDefinitivo.jsx';let src=fs.readFileSync(file,'utf8');if(!src.includes("import {advanceOperationalJourney} from '../lib/customerJourneyOperational'"))src=src.replace(/^(import React[^\n]*\n)/m,m=>m+"import {advanceOperationalJourney} from '../lib/customerJourneyOperational'\n");const replacement=`  async function registerPlan(plan){
    if(!okStatus(plan.status)||!plan.svgText||plan.registered)return
    const multiplier=Number(plan.multiplier||1),number=String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0'),itemMap=new Map()
    ;(plan.units||[]).forEach(unit=>{const component=unit.repairComponent||'complete',key=normalizeFigureKey(unit.figure)+'|'+component,current=itemMap.get(key)||{figure:unit.figure,component,qty:0};current.qty+=1;itemMap.set(key,current)})
    ;(plan.partialExtras||[plan.partialExtra]).filter(Boolean).forEach(extra=>{const component=String(extra.component||'').toLowerCase();if(!extra.figure||!['base','tapa'].includes(component))return;const key=normalizeFigureKey(extra.figure)+'|'+component,current=itemMap.get(key)||{figure:extra.figure,component,qty:0};current.qty+=1;itemMap.set(key,current)})
    const items=[...itemMap.values()],now=new Date().toISOString(),deliveryDates=[...new Set((plan.units||[]).map(u=>String(u.date||'').slice(0,10)).filter(Boolean))],batch={id:crypto.randomUUID(),number,date:plan.date||today(),deliveryDates,name:\`Placa automática Sparrow \${plan.date||today()}\`,status:'En corte',sentToCutAt:now,journeyManaged:true,notes:\`Sparrow · \${plan.units.length} diseños · ocupación \${Number(plan.density||0).toFixed(1)}%\`,multiplier,items,createdAt:now},cutBatches=[...(db.cutBatches||[]),batch],journey=advanceOperationalJourney({...db,cutBatches},now),result=await onSave({...db,orders:journey.orders,cutBatches})
    if(result?.ok!==false)setPlans(list=>list.map(x=>x.id===plan.id?{...x,registered:true,batchNumber:number}:x))
  }

  return <>`;src=mustReplace(src,/  async function registerPlan\(plan\)\{[\s\S]*?\n  \}\n\n  return <>/,replacement,'registerPlan');fs.writeFileSync(file,src)
}
{
 const file='src/pages/CutBatches.jsx';let src=fs.readFileSync(file,'utf8');if(!src.includes("import {advanceOperationalJourney} from '../lib/customerJourneyOperational'"))src=src.replace(/^(import React[^\n]*\n)/m,m=>m+"import {advanceOperationalJourney} from '../lib/customerJourneyOperational'\n");src=src.replace("const pending=(db.cutBatches||[]).filter(b=>b.status==='En corte' && String(b.name||'').startsWith('Placa automática Sparrow'))","const pending=[]");src=src.replace(/  async function finish\(batch\)\{[\s\S]*?\n  \}\n\n  async function cancel\(batch\)\{/,`  async function finish(batch){
    if(!confirm('¿Confirmar que esta placa terminó de cortarse y sumar sus piezas al inventario?'))return
    const now=new Date().toISOString(),movements=inventoryMovements(batch,1,'Placa terminada'),cutBatches=(db.cutBatches||[]).map(b=>b.id===batch.id?{...b,status:'Terminada',finishedAt:now}:b),next={...db,movements:[...(db.movements||[]),...movements],cutBatches},journey=advanceOperationalJourney(next,now)
    await onSave({...next,orders:journey.orders})
  }

  async function cancel(batch){`);fs.writeFileSync(file,src)
}
{
 const file='src/pages/OperationsHub.jsx';let src=fs.readFileSync(file,'utf8');src=src.replace("import React,{useMemo} from 'react'","import React,{useEffect,useMemo,useState} from 'react'");if(!src.includes("from '../lib/customerJourneyOperational'"))src=src.replace("import {pendingCutPlan} from '../lib/cutPlanning'","import {pendingCutPlan} from '../lib/cutPlanning'\nimport {advanceOperationalJourney,effectiveJourneyEvent,finalActionLabel,journeyIsFinal,journeyStageLabel,markJourneyFinal} from '../lib/customerJourneyOperational'\nimport {JOURNEY_EVENTS} from '../lib/customerJourney'");src=src.replace('export default function OperationsHub({db,go}){','export default function OperationsHub({db,onSave,go}){');const anchor="  const today=todayArgentinaISO(),end=addDaysIso(today,7)";if(!src.includes('advanceOperationalJourney(db,new Date().toISOString())'))src=src.replace(anchor,"  useEffect(()=>{const result=advanceOperationalJourney(db,new Date().toISOString());if(result.changed)Promise.resolve(onSave?.({...db,orders:result.orders})).catch(console.error)},[db.orders,db.movements,db.cutBatches,onSave])\n"+anchor);fs.writeFileSync(file,src)
}
console.log('CUSTOMER JOURNEY INTEGRATION OK · Motor + En corte + Centro operativo')
