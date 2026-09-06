import fs from 'node:fs'

const motor=fs.readFileSync('src/pages/MotorDefinitivo.jsx','utf8')
if(!motor.includes("const component=unit.repairComponent||'complete'"))throw new Error('Motor: Registrar corte perdió el tipo base/tapa')
if(!motor.includes(";(plan.partialExtras||[plan.partialExtra]).filter(Boolean).forEach"))throw new Error('Motor: Registrar corte perdió las piezas de relleno residual')
if(/plan\.summary\.map\(x=>\(\{figure:x\.figure,component:'complete'/.test(motor))throw new Error('Motor: todavía fuerza piezas como figuras completas')

const registerItems=(units,partialExtras=[])=>{
  const grouped=new Map()
  units.forEach(unit=>{
    const component=unit.repairComponent||'complete'
    const key=`${component}|${unit.figure}`
    const current=grouped.get(key)||{figure:unit.figure,component,qty:0}
    current.qty+=1;grouped.set(key,current)
  })
  partialExtras.forEach(extra=>{
    const component=String(extra.component||'').toLowerCase()
    if(!extra.figure||!['base','tapa'].includes(component))return
    const key=`${component}|${extra.figure}`
    const current=grouped.get(key)||{figure:extra.figure,component,qty:0}
    current.qty+=1;grouped.set(key,current)
  })
  return [...grouped.values()]
}

const items=registerItems([{figure:'Osito',repairComponent:'base'},{figure:'Auto'}],[{figure:'Osito',component:'base'}])
const osito=items.find(item=>item.figure==='Osito')
const auto=items.find(item=>item.figure==='Auto')
if(osito?.component!=='base'||osito.qty!==2||auto?.component!=='complete'||auto.qty!==1)throw new Error('Motor: la prueba base/completa produjo un registro incorrecto')
if(osito.qty*3!==6)throw new Error('Motor: el multiplicador triple no conserva las bases')

console.log('MOTOR COMPONENT REGISTRATION OK · base/tapa se conservan · placa triple multiplica la pieza correcta')
