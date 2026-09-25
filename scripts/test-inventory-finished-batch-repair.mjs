import { physicalStockBalance } from '../src/lib/inventory.js'

const must=(ok,message)=>{if(!ok)throw new Error('FINISHED BATCH STOCK: '+message)}
const base={figures:['Arcoiris'],customerCatalog:[],stockMin:{},svgLibrary:[],orders:[]}

// Una placa terminada documenta lo producido, pero el stock físico sale de movimientos.
// Si luego se anula/ajusta esa producción, no debe reaparecer por reconstrucción histórica.
let db={...base,movements:[
  {id:'in-107',batchId:'batch-107-ok',figure:'Arcoiris',component:'complete',type:'Entrada de corte',qty:2,detail:'Alta automática · Placa #107'},
  {id:'out-107',batchId:'batch-107-ok',figure:'Arcoiris',component:'complete',type:'Ajuste negativo',qty:2,detail:'Corte anulado · Placa #107'}
],cutBatches:[
  {id:'batch-107-ok',number:'107',status:'Terminada',finishedAt:'2026-09-23T12:00:00',multiplier:1,items:[{figure:'Arcoiris',component:'complete',qty:2}]}
]}
let physical=physicalStockBalance(db).Arcoiris||0
must(physical===0,`entrada 2 + ajuste -2 debe dar 0; dio ${physical}`)

// Si una placa dice 14 pero sólo existen movimientos reales por 12, inventario debe mostrar 12.
// Las 2 faltantes no se inventan como stock: quedan como diferencia a resolver/cortar.
db={...base,movements:[
  {id:'in-120',batchId:'batch-120',figure:'Arcoiris',component:'complete',type:'Entrada de corte',qty:12,detail:'Alta automática · Placa #120'}
],cutBatches:[
  {id:'batch-120',number:'120',status:'Terminada',finishedAt:'2026-09-23T12:00:00',multiplier:1,items:[{figure:'Arcoiris',component:'complete',qty:14}]}
]}
physical=physicalStockBalance(db).Arcoiris||0
must(physical===12,`12 movimientos reales deben dar stock 12 aunque la placa diga 14; dio ${physical}`)

// Igual para componentes: un ajuste negativo no debe regenerar piezas desde la placa.
db={...base,movements:[
  {id:'part-in',batchId:'batch-part',figure:'Arcoiris',component:'base',type:'Entrada de corte',qty:2,detail:'Alta automática · Placa #076'},
  {id:'part-out',batchId:'batch-part',figure:'Arcoiris',component:'base',type:'Ajuste componente negativo',qty:2,detail:'Corte anulado · Placa #076'}
],cutBatches:[
  {id:'batch-part',number:'076',status:'Terminada',finishedAt:'2026-09-23T12:00:00',multiplier:1,items:[{figure:'Arcoiris',component:'base',qty:2}]}
]}
physical=physicalStockBalance(db).Arcoiris||0
must(physical===0,`ajuste negativo de componente debe dar 0; dio ${physical}`)

console.log('FINISHED BATCH STOCK OK · sólo movimientos reales; sin reconstrucción fantasma')
