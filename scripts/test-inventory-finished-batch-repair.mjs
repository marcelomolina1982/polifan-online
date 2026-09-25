import { physicalStockBalance } from '../src/lib/inventory.js'

const must=(ok,message)=>{if(!ok)throw new Error('FINISHED BATCH REPAIR: '+message)}
const base={figures:['Arcoiris'],customerCatalog:[],stockMin:{},svgLibrary:[],orders:[]}

// Regresión tipo placa #107: la producción ya fue registrada. Una salida/ajuste
// posterior debe bajar el stock físico, pero NO hacer que la reparación automática
// vuelva a inventar la producción como si nunca se hubiera registrado.
let db={...base,movements:[
  {id:'in-107',batchId:'batch-107-ok',figure:'Arcoiris',component:'complete',type:'Entrada de corte',qty:2,detail:'Alta automática · Placa #107'},
  {id:'out-107',batchId:'batch-107-ok',figure:'Arcoiris',component:'complete',type:'Ajuste negativo',qty:2,detail:'Corte anulado · Placa #107'}
],cutBatches:[
  {id:'batch-107-ok',number:'107',status:'Terminada',finishedAt:'2026-09-23T12:00:00',multiplier:1,items:[{figure:'Arcoiris',component:'complete',qty:2}]}
]}
must((physicalStockBalance(db).Arcoiris||0)===0,'una entrada 2 seguida de ajuste negativo 2 debe dejar stock físico 0, sin reparación fantasma')

// Control tipo #120/#136: si realmente faltó registrar parte de una placa terminada,
// la reparación debe conservarse.
db={...base,movements:[
  {id:'in-120',batchId:'batch-120',figure:'Arcoiris',component:'complete',type:'Entrada de corte',qty:12,detail:'Alta automática · Placa #120'}
],cutBatches:[
  {id:'batch-120',number:'120',status:'Terminada',finishedAt:'2026-09-23T12:00:00',multiplier:1,items:[{figure:'Arcoiris',component:'complete',qty:14}]}
]}
must(physicalStockBalance(db).Arcoiris===14,'12 registradas de 14 esperadas deben reparar sólo las 2 realmente faltantes')

// La misma regla debe aplicarse a componentes tapa/base.
db={...base,movements:[
  {id:'part-in',batchId:'batch-part',figure:'Arcoiris',component:'base',type:'Entrada de corte',qty:2,detail:'Alta automática · Placa #076'},
  {id:'part-out',batchId:'batch-part',figure:'Arcoiris',component:'base',type:'Ajuste componente negativo',qty:2,detail:'Corte anulado · Placa #076'}
],cutBatches:[
  {id:'batch-part',number:'076',status:'Terminada',finishedAt:'2026-09-23T12:00:00',multiplier:1,items:[{figure:'Arcoiris',component:'base',qty:2}]}
]}
must((physicalStockBalance(db).Arcoiris||0)===0,'un ajuste negativo de componente no debe regenerar bases ya producidas')

// Preview validation trigger: no cambia la lógica del test.
console.log('FINISHED BATCH REPAIR OK')
