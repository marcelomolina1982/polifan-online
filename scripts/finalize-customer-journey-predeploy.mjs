import fs from 'node:fs'

const sourceFile='scripts/finalize-customer-journey-lab.mjs'
const runtimeFile='scripts/.customer-journey-lab-runtime.mjs'
let lab=fs.readFileSync(sourceFile,'utf8')

// Reparar sólo para el build del laboratorio dos fragilidades del finalizer V2:
// 1) el JSX compacto contenía un template literal anidado;
// 2) el import del Motor cambia durante la cadena prepare/finalize y no debe buscarse por texto exacto.
const broken="{(b.items||[]).map(i=>`${i.figure}${(i.component&&i.component!=='complete')?` · ${i.component}`:''} × ${Number(i.qty)*(Number(b.multiplier)||1)}`).join(' · ')}"
const fixed="{(b.items||[]).map(i=>String(i.figure)+(i.component&&i.component!=='complete'?' · '+i.component:'')+' × '+(Number(i.qty)*(Number(b.multiplier)||1))).join(' · ')}"
if(!lab.includes(broken))throw new Error('journey predeploy: no se encontró expresión de piezas a reparar')
lab=lab.replace(broken,fixed)

const oldMotorImport=`  src=mustReplace(src,"import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'","import {pendingCutByDelivery,normalizeFigureKey} from '../lib/inventory'\\nimport {advanceOperationalJourney} from '../lib/customerJourneyOperational'",'import operativo en MotorDefinitivo')`
const newMotorImport=`  src=mustReplace(src,/import\\s*\\{[^}]*pendingCutByDelivery[^}]*\\}\\s*from\\s*['\"]\\.\\.\\/lib\\/inventory['\"]/,match=>match+"\\nimport {advanceOperationalJourney} from '../lib/customerJourneyOperational'",'import operativo en MotorDefinitivo')`
if(!lab.includes(oldMotorImport))throw new Error('journey predeploy: no se encontró parche de import del Motor')
lab=lab.replace(oldMotorImport,newMotorImport)

fs.writeFileSync(runtimeFile,lab)
try{await import('./.customer-journey-lab-runtime.mjs')}finally{try{fs.unlinkSync(runtimeFile)}catch{}}

const file='src/AppV2.jsx'
let src=fs.readFileSync(file,'utf8')
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
if(!src.includes(before))throw new Error('journey predeploy: no se encontró saveData para habilitar pedidos nuevos')
src=src.replace(before,after)
fs.writeFileSync(file,src)
if(!src.includes("whatsappConfirmedStatus:'simulated-private'"))throw new Error('journey predeploy: no quedó activación segura de pedidos nuevos')
console.log('CUSTOMER JOURNEY PREDEPLOY OK · sólo pedidos nuevos habilitados · históricos aislados')
