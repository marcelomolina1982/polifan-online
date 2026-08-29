export const config={maxDuration:60}

const BASE='https://viacargo-quote-probe2.onrender.com'

async function fetchTimed(url,options={},timeoutMs=55000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
  finally{clearTimeout(timer)}
}

function numericPrice(value){
  const raw=String(value||'').replace(/[^0-9.,]/g,'')
  if(!raw)return 0
  if(raw.includes(',')&&raw.includes('.'))return Number(raw.replace(/\./g,'').replace(',','.'))||0
  if(raw.includes(','))return Number(raw.replace(',','.'))||0
  return Number(raw)||0
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'})
  const destinationCp=String(req.body?.destinationCp||'').trim()
  const quantity=Math.max(1,Math.floor(Number(req.body?.quantity||1)))
  if(!/^\d{4}$/.test(destinationCp))return res.status(400).json({ok:false,error:'Ingresá un código postal de 4 dígitos.'})
  try{
    try{await fetchTimed(BASE+'/health',{headers:{accept:'application/json'}},25000)}catch{}
    const r=await fetchTimed(BASE+'/quote',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({destinationCp,quantity})},55000)
    const text=await r.text();let body={};try{body=JSON.parse(text||'{}')}catch{}
    const agency=Array.isArray(body.agencyToAgency)?body.agencyToAgency.find(x=>/agencia/i.test(String(x?.name||''))&&!/domicilio/i.test(String(x?.name||''))):null
    if(!r.ok||!body.ok||!agency)return res.status(r.status===400?400:422).json({ok:false,available:false,error:body.error||'Vía Cargo no devolvió una tarifa Agencia → Agencia para ese código postal.',destinationCp,quantity})
    const price=numericPrice(agency.price)
    return res.status(200).json({ok:true,available:true,carrier:'Vía Cargo',service:'Agencia → Agencia',origin:body.origin||'BOULOGNE (1609) - BUENOS AIRES',destination:body.destination||'',destinationCp,quantity,price,priceText:agency.price||'',payment:'destino',package:{kg:Number(body.kg||0),dimensions:body.dimensions||[]},declaredValue:Number(body.declaredValue||100000),quotedAt:new Date().toISOString(),informative:true})
  }catch(e){
    return res.status(503).json({ok:false,available:false,retryable:true,error:'No se pudo consultar Vía Cargo en este momento. '+(e?.name==='AbortError'?'Tiempo de espera agotado.':(e?.message||String(e)))})
  }
}
