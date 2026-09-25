import {orderDemand,physicalStockBalance,activeCutQty,pendingCutByDelivery,stockRows} from '../src/lib/inventory.js'
import {productionStockSnapshot} from '../src/lib/cutPlanning.js'

const must=(ok,message)=>{if(!ok)throw new Error('INVENTORY FLOW: '+message)}
const qty=(groups,figure,component='complete')=>groups.flatMap(g=>g.rows).filter(r=>r.figure===figure&&r.component===component).reduce((n,r)=>n+Number(r.qty||0),0)
const base={figures:['Arcoiris'],customerCatalog:[],stockMin:{},svgLibrary:[],movements:[{id:'m1',figure:'Arcoiris',type:'Entrada de corte',qty:5}],cutBatches:[],orders:[]}

let db={...base,orders:[{id:'legacy',number:0,status:'Ingresado',delivery:'2026-09-02',items:[{figure:'Arcoiris',qty:99,inventoryTracked:true}]}]}
must((orderDemand(db).Arcoiris||0)===0,'pedido histórico vencido no debe volver a reservar stock')
must(qty(pendingCutByDelivery(db),'Arcoiris')===0,'pedido histórico vencido no debe reaparecer en Para cortar')
must(physicalStockBalance(db).Arcoiris===5,'ignorar demanda histórica no debe modificar stock físico')

db={...base,orders:[{id:'o1',number:1,status:'Ingresado',delivery:'2026-09-25',items:[{figure:'Arcoiris',qty:3,inventoryTracked:true}]}]}
must(orderDemand(db).Arcoiris===3,'pedido de hoy debe reservar 3')
must(physicalStockBalance(db).Arcoiris===5,'reservar pedido no debe consumir stock físico')
must(qty(pendingCutByDelivery(db),'Arcoiris')===0,'stock disponible no debe volver a corte')

db={...base,orders:[{id:'o2',number:2,status:'Ingresado',delivery:'2026-09-25',items:[{figure:'Arcoiris',qty:8,inventoryTracked:true}]}]}
must(qty(pendingCutByDelivery(db),'Arcoiris')===3,'faltante 8-5 debe ser 3')
db={...db,cutBatches:[{id:'b1',number:'001',status:'En corte',multiplier:3,items:[{figure:'Arcoiris',component:'complete',qty:1}]}]}
must(activeCutQty(db).Arcoiris===3,'placa ×3 En corte debe representar 3 piezas')
must(qty(pendingCutByDelivery(db),'Arcoiris')===0,'piezas En corte deben cubrir el faltante sin duplicarlo')

db={...base,orders:[{id:'o3',number:3,status:'Entregado',delivery:'2026-09-25',items:[{figure:'Arcoiris',qty:3,inventoryTracked:true}]}]}
must((orderDemand(db).Arcoiris||0)===0,'Entregado no debe seguir reservado')
must(physicalStockBalance(db).Arcoiris===2,'Entregado debe consumir 3 de las 5 físicas')
must(productionStockSnapshot(db).find(r=>r.figure==='Arcoiris')?.physical===2,'snapshot de producción debe usar stock físico neto después de Entregado')

db={...base,movements:[{id:'t1',figure:'Arcoiris',component:'tapa',type:'Ajuste componente positivo',qty:2}],orders:[{id:'o4',number:4,status:'Ingresado',delivery:'2026-09-25',items:[{figure:'Arcoiris',qty:2,inventoryTracked:true}]}]}
must(qty(pendingCutByDelivery(db),'Arcoiris','base')===2,'2 tapas sueltas deben pedir 2 bases, no 2 figuras completas')
must(qty(pendingCutByDelivery(db),'Arcoiris','complete')===0,'reparación por componente no debe convertirse en figura completa')

db={...base,orders:[{id:'o5',number:5,status:'Cancelado',delivery:'2026-09-25',items:[{figure:'Arcoiris',qty:99,inventoryTracked:true}]}]}
must((stockRows(db).find(r=>r.figure==='Arcoiris')?.ordered||0)===0,'Cancelado no debe reservar stock')

db={...base,movements:[{id:'wrong-batch',batchId:'batch-old',figure:'Arcoiris',component:'complete',type:'Entrada de corte',qty:1,detail:'Alta automática · Placa #007'}],cutBatches:[{id:'batch-new',number:'007',status:'Terminada',finishedAt:'2026-09-23T12:00:00',multiplier:1,items:[{figure:'Arcoiris',component:'complete',qty:1}]}],orders:[]}
must(physicalStockBalance(db).Arcoiris===2,'un movimiento con batchId ajeno no debe atribuirse a otra placa sólo porque comparte número')

db={...base,movements:[{id:'neutral',figure:'Arcoiris',type:'Nota de auditoría',qty:4}],orders:[]}
must((physicalStockBalance(db).Arcoiris||0)===0,'un tipo de movimiento desconocido no debe descontar stock como si fuera una salida')
console.log('INVENTORY FLOW OK · históricos vencidos fuera, reserva actual, entrega, en corte, multiplicador y reparación por componente')
