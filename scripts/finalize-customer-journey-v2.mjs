import fs from 'node:fs'

const opsPath='src/pages/OperationsHub.jsx'
let ops=fs.readFileSync(opsPath,'utf8')

// El Centro Operativo deja de ser un visor pasivo: al entrar reconcilia el Journey
// con el stock, las placas y los movimientos reales. Sólo persiste orders si hubo
// una transición efectiva; no toca inventario, movimientos ni placas.
const stateAnchor="  const [journeyPreview,setJourneyPreview]=useState(null)\n"
const syncBlock=`  const journeySyncRef=React.useRef(false)\n  useEffect(()=>{\n    if(journeySyncRef.current)return\n    const result=advanceOperationalJourney(db,new Date().toISOString())\n    if(!result.changed)return\n    journeySyncRef.current=true\n    Promise.resolve(onSave({...db,orders:result.orders})).finally(()=>{journeySyncRef.current=false})\n  },[db.orders,db.movements,db.cutBatches,onSave])\n`
if(!ops.includes('journeySyncRef=React.useRef(false)')){
  if(!ops.includes(stateAnchor))throw new Error('journey-v2: no se encontró estado de seguimiento')
  ops=ops.replace(stateAnchor,stateAnchor+syncBlock)
}

ops=ops.replace('CONTROL CUSTOMER JOURNEY','SEGUIMIENTO OPERATIVO')
ops=ops.replace("<span className=\"block\">Estado actual: <b>{enabled?journeyStageLabel(current):'Seguimiento no activado para este pedido'}</b></span>","<span className=\"block\">Estado actual: <b>{enabled?journeyStageLabel(current):'Pedido anterior al seguimiento automático'}</b></span>{enabled&&<small className=\"block\" style={{marginTop:6}}>Este seguimiento avanza solo según el corte y el despacho real. No tenés que actualizarlo manualmente.</small>}")
ops=ops.replace('<b>Pedido anterior al Customer Journey</b><span>Por seguridad, los pedidos históricos no se activan automáticamente.</span>','<b>Pedido anterior al seguimiento automático</b><span>Este pedido se creó antes de activar la mejora. Los pedidos nuevos se siguen automáticamente desde que ingresan.</span>')
ops=ops.replace('>Ver seguimiento</button>','>Ver avance</button>')

fs.writeFileSync(opsPath,ops)
if(!ops.includes('journeySyncRef=React.useRef(false)')||!ops.includes('SEGUIMIENTO OPERATIVO')||!ops.includes('Ver avance</button>'))throw new Error('journey-v2: validación incompleta')

// Hacer el refresco de producción en la misma etapa que conoce la forma final de AppV2.
const appPath='src/AppV2.jsx'
let app=fs.readFileSync(appPath,'utf8')
if(!app.includes("liveProductionKeys=(target==='sheetplanner'||target==='operations')")){
  app=app.replace("const liveProductionKeys=target==='sheetplanner'?new Set(['orders','movements','cutBatches']):null","const liveProductionKeys=(target==='sheetplanner'||target==='operations')?new Set(['orders','movements','cutBatches']):null")
}
app=app.replace(/v25\.0\.81/g,'v25.0.82').replace(/25\/08\/2026/g,'04/09/2026')
fs.writeFileSync(appPath,app)
if(!app.includes("liveProductionKeys=(target==='sheetplanner'||target==='operations')"))throw new Error('journey-v2: Centro operativo no quedó con producción fresca')

console.log('✓ Customer Journey V2: seguimiento automático con producción fresca; UI operativa; versión 25.0.82.')
