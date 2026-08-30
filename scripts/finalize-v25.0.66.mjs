import fs from 'node:fs'

function one(text,before,after,label){
  const count=text.split(before).length-1
  if(count!==1)throw new Error(`finalize-v25.0.66: ${label} aparece ${count} veces`)
  return text.replace(before,after)
}

const file='src/pages/CustomerOrderBase.jsx'
let customer=fs.readFileSync(file,'utf8')

customer=one(
  customer,
  "if(['locality','district','province','postalCode','address'].includes(field)){",
  "if(['locality','district','province','postalCode','address','method'].includes(field)){",
  'invalidar cotización al cambiar método'
)

customer=one(
  customer,
  "      const direct=resolveLogisticsZone({locality:data.locality,district:data.district,province:data.province,postalCode:data.postalCode})",
  "      const hasPostal=Boolean(String(data.postalCode||'').trim())\n      const direct=!hasPostal?resolveLogisticsZone({locality:data.locality,district:data.district,province:data.province,postalCode:data.postalCode}):null",
  'validación oficial cuando hay CP'
)

customer=one(
  customer,
  "  function changeQty(id, delta) {const product=products.find(item=>item.id===id);const nextQty=Math.max(0,(cart[id]||0)+delta);setCart(previous=>({...previous,[id]:nextQty}));if(product)trackCatalogEvent(delta>0?'cart_add':'cart_remove',{productId:product.id,productName:product.name,category:product.category,quantity:1})}",
  "  function changeQty(id, delta) {const product=products.find(item=>item.id===id);const nextQty=Math.max(0,(cart[id]||0)+delta);setCart(previous=>({...previous,[id]:nextQty}));setShippingQuote(null);setShippingStatus({state:'idle',remaining:0,message:''});if(product)trackCatalogEvent(delta>0?'cart_add':'cart_remove',{productId:product.id,productName:product.name,category:product.category,quantity:1})}",
  'invalidar cotización al cambiar cantidad'
)

customer=one(
  customer,
  "onChange={e=>setSpecialFigure(v=>({...v,enabled:e.target.checked}))}",
  "onChange={e=>{setSpecialFigure(v=>({...v,enabled:e.target.checked}));setShippingQuote(null);setShippingStatus({state:'idle',remaining:0,message:''})}}",
  'invalidar cotización figura especial toggle'
)
customer=one(
  customer,
  "onChange={e=>setSpecialFigure(v=>({...v,description:e.target.value}))}",
  "onChange={e=>{setSpecialFigure(v=>({...v,description:e.target.value}));setShippingQuote(null);setShippingStatus({state:'idle',remaining:0,message:''})}}",
  'invalidar cotización figura especial texto'
)

const oldCustomer=`customer:{...data,source:customerSource,name:[data.firstName,data.lastName].filter(Boolean).join(' '),delivery:'',estimatedDeliveryStart:productionDate,estimatedDeliveryEnd:productionDate,productionDateStatus:productionDate?'estimada':'pendiente de confirmar'}`
const newCustomer=`customer:{...data,source:customerSource,name:[data.firstName,data.lastName].filter(Boolean).join(' '),delivery:'',estimatedDeliveryStart:productionDate,estimatedDeliveryEnd:productionDate,productionDateStatus:productionDate?'estimada':'pendiente de confirmar',shippingQuote:shippingQuote?{kind:shippingQuote.kind,label:shippingQuote.label||'',zone:shippingQuote.zone||'',price:Number.isFinite(Number(shippingQuote.price))?Number(shippingQuote.price):null,destination:shippingQuote.destination||'',service:shippingQuote.service||''}:null,shippingPrice:Number.isFinite(Number(shippingQuote?.price))?Number(shippingQuote.price):0,shippingPending:shippingQuote?.kind==='manual'}`
customer=one(customer,oldCustomer,newCustomer,'guardar cotización estructurada')

customer=one(
  customer,
  "metadata:{method:data.method,estimatedTotal,source:customerSource,specialFigure:specialQty?specialFigure.description.trim():null}",
  "metadata:{method:data.method,estimatedTotal,source:customerSource,specialFigure:specialQty?specialFigure.description.trim():null,shippingKind:shippingQuote?.kind||null,shippingPrice:Number.isFinite(Number(shippingQuote?.price))?Number(shippingQuote.price):null,shippingPending:shippingQuote?.kind==='manual'}",
  'analytics de envío'
)

if(!customer.includes("const direct=!hasPostal?resolveLogisticsZone"))throw new Error('No quedó validación oficial por CP')
if(!customer.includes('shippingPending:shippingQuote?.kind===\'manual\''))throw new Error('No quedó persistencia de shippingPending')
if(!customer.includes("['locality','district','province','postalCode','address','method']"))throw new Error('No quedó invalidación al cambiar método')

fs.writeFileSync(file,customer)
console.log('v25.0.66 FINALIZE OK · CP verificado · cotización invalidable · envío persistido')
