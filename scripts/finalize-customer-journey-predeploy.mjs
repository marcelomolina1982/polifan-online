import fs from 'node:fs'

const sourceFile='scripts/finalize-customer-journey-lab.mjs'
const runtimeFile='scripts/.customer-journey-lab-runtime.mjs'
let lab=fs.readFileSync(sourceFile,'utf8')

// Reparaciones privadas del finalizer del laboratorio para que sobreviva a la
// cadena real de prepare/finalize sin depender de imports textualmente idénticos.
const broken="{(b.items||[]).map(i=>`${i.figure}${(i.component&&i.component!=='complete')?` · ${i.component}`:''} × ${Number(i.qty)*(Number(b.multiplier)||1)}`).join(' · ')}"
const fixed="{(b.items||[]).map(i=>String(i.figure)+(i.component&&i.component!=='complete'?' · '+i.component:'')+' × '+(Number(i.qty)*(Number(b.multiplier)||1))).join(' · ')}"
if(!lab.includes(broken))throw new Error('journey predeploy: no se encontró expresión de piezas a reparar')
lab=lab.replace(broken,fixed)

const oldMotorImport=`  src=mustReplace(src,"import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'","import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'\\nimport {advanceOperationalJourney} from '../lib/customerJourneyOperational'",'import operativo en MotorDefinitivo')`
const newMotorImport=`  src=mustReplace(src,/^(import React[^\\n]*\\n)/m,match=>match+"import {advanceOperationalJourney} from '../lib/customerJourneyOperational'\\n",'import operativo en MotorDefinitivo')`
if(!lab.includes(oldMotorImport))throw new Error('journey predeploy: no se encontró parche de import del Motor')
lab=lab.replace(oldMotorImport,newMotorImport)

const oldCutImport=`  src=mustReplace(src,"import {today} from '../lib/format'","import {today} from '../lib/format'\\nimport {advanceOperationalJourney} from '../lib/customerJourneyOperational'",'import operativo en CutBatches')`
const newCutImport=`  src=mustReplace(src,/^(import React[^\\n]*\\n)/m,match=>match+"import {advanceOperationalJourney} from '../lib/customerJourneyOperational'\\n",'import operativo en CutBatches')`
if(!lab.includes(oldCutImport))throw new Error('journey predeploy: no se encontró parche de import de En corte')
lab=lab.replace(oldCutImport,newCutImport)

fs.writeFileSync(runtimeFile,lab)
try{await import('./.customer-journey-lab-runtime.mjs')}finally{try{fs.unlinkSync(runtimeFile)}catch{}}

// Generar placas calcula pendientes con stock físico. Por eso necesita movements
// además de orders/cutBatches. Y estas tres secciones deben refrescarse al entrar:
// no alcanza con conservarlas desde cache porque cambian durante la producción.
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
console.log('CUSTOMER JOURNEY PREDEPLOY OK · pedidos nuevos aislados · pendientes de placas con orders/movements/cutBatches frescos')
