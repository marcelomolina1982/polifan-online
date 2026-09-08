import fs from 'node:fs'
const opsPath='src/pages/OperationsHub.jsx'
let ops=fs.readFileSync(opsPath,'utf8')
const stateAnchor="  const [journeyPreview,setJourneyPreview]=useState(null)\n"
const syncBlock=`  const journeySyncRef=React.useRef(false)\n  useEffect(()=>{\n    if(journeySyncRef.current)return\n    const result=advanceOperationalJourney(db,new Date().toISOString())\n    if(!result.changed)return\n    journeySyncRef.current=true\n    Promise.resolve(onSave({...db,orders:result.orders})).finally(()=>{journeySyncRef.current=false})\n  },[db.orders,db.movements,db.cutBatches,onSave])\n`
if(!ops.includes('journeySyncRef=React.useRef(false)')){if(!ops.includes(stateAnchor))throw new Error('journey-v2: no se encontró estado de seguimiento');ops=ops.replace(stateAnchor,stateAnchor+syncBlock)}
ops=ops.replace('CONTROL CUSTOMER JOURNEY','SEGUIMIENTO OPERATIVO').replace('>Ver seguimiento</button>','>Ver avance</button>')
fs.writeFileSync(opsPath,ops)
if(!ops.includes('journeySyncRef=React.useRef(false)')||!ops.includes('SEGUIMIENTO OPERATIVO')||!ops.includes('Ver avance</button>'))throw new Error('journey-v2: validación incompleta')
const appPath='src/AppV2.jsx'
let app=fs.readFileSync(appPath,'utf8')
const operationsBranch="target==='operations'?new Set(['orders','movements','cutBatches']):"
if(!app.includes(operationsBranch)){
  const cutAnchor="target==='cut'?new Set(['orders','movements','stockMin','figures','cutBatches']):"
  const sheetAnchor="const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):"
  if(app.includes(cutAnchor))app=app.replace(cutAnchor,operationsBranch+cutAnchor)
  else if(app.includes(sheetAnchor))app=app.replace(sheetAnchor,sheetAnchor+operationsBranch)
  else throw new Error('journey-v2: no se encontró política live actual de producción')
}
app=app.replace(/v25\.0\.81/g,'v25.0.82').replace(/25\/08\/2026/g,'04/09/2026')
fs.writeFileSync(appPath,app)
if(!app.includes(operationsBranch))throw new Error('journey-v2: Centro operativo no quedó con producción fresca')
console.log('✓ Customer Journey V2: seguimiento automático con producción fresca; política idempotente.')
