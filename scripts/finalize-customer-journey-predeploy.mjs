import fs from 'node:fs'
import './finalize-customer-journey-lab.mjs'

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
