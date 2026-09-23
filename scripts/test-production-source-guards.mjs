import fs from 'node:fs'

const app=fs.readFileSync('src/AppV2.jsx','utf8')
const cut=fs.readFileSync('src/pages/CutBatches.jsx','utf8')
const motor=fs.readFileSync('src/pages/MotorDefinitivo.jsx','utf8')
const stock=fs.readFileSync('src/pages/Stock.jsx','utf8')
const stockBase=fs.readFileSync('src/pages/StockBase.jsx','utf8')
const orders=fs.readFileSync('src/pages/Orders.jsx','utf8')
const orderForm=fs.readFileSync('src/pages/OrderForm.jsx','utf8')

const must=(ok,message)=>{if(!ok)throw new Error('PRODUCTION SOURCE GUARD: '+message)}

must(app.includes("target==='sheetplanner'?new Set(['orders','movements','cutBatches'])"),'Generar placas perdió refresco vivo de producción')
must(app.includes("target==='cut'?new Set(['orders','movements','stockMin','figures','cutBatches'])"),'Para cortar perdió refresco vivo de producción')
must(!cut.includes("startsWith('Placa automática Sparrow')"),'reapareció auto-finalización Sparrow')
must(!cut.includes('autoFinishRef'), 'reapareció auto-escritura de cortes al montar la pantalla')
must(cut.includes('<option value="3">Triple · 3 placas iguales</option>'),'En corte perdió multiplicador ×3')
must(cut.includes('<option value="4">Cuádruple · 4 placas iguales</option>'),'En corte perdió multiplicador ×4')
must(motor.includes('generateAutomatic(3)')&&motor.includes('generateAutomatic(4)'),'Motor perdió ×3/×4')
must(!motor.includes("fetch('/api/nest-start'"),'Motor volvió al backend Sparrow')
must(!stock.includes('buildRecountCloseoutState(db)'),'reapareció cierre histórico automático de Inventario')
must(stockBase.includes('Reserva de inventario hasta la entrega'),'Inventario volvió a explicar salida automática por fecha')
must(orders.includes("const closed=['Entregado','Cancelado'].includes(o.status)"),'Pedidos volvió a archivar por fecha en vez de estado final')
must(orderForm.includes("filter(x=>x!=='Entregado')"),'Formulario volvió a permitir Entregado sin circuito de despacho')
must(orderForm.includes("disabled={['Entregado','Cancelado'].includes(form.status)}"),'Formulario permite reabrir estados finales')
must(orders.includes("disabled={['Entregado','Cancelado'].includes(o.status)}"),'Lista de pedidos permite reabrir estados finales')
must(orders.includes("if(newStatus==='Cancelado'&&!confirm("),'Cancelación volvió a liberar stock sin confirmación')
must(orders.includes("if(!['Entregado','Cancelado'].includes(order.status))return alert("),'Pedidos activos volvieron a poder eliminarse y liberar reserva por accidente')
console.log('PRODUCTION SOURCE GUARDS OK · build verifica, no reescribe')
