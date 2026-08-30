import React,{useState} from 'react'
import {Title} from '../components/UI'
import {resolveLogisticsZone} from '../lib/logisticsZones'

const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(value||0))
const API='https://viacargo-quote-probe2.onrender.com'
const clean=value=>String(value||'').trim()

function localCandidate(text){
  return clean(text).replace(/^cp\s*\d{4}\s*[-·,]?\s*/i,'').split(',')[0].trim()
}
function extractCp(text){return (clean(text).match(/\b\d{4}\b/)||[])[0]||''}

export default function ChatGPTAssist(){
  const [query,setQuery]=useState('')
  const [quantity,setQuantity]=useState(1)
  const [loading,setLoading]=useState(false)
  const [result,setResult]=useState(null)
  const [error,setError]=useState('')

  async function resolveOfficial(q){
    const response=await fetch(API+'/api/destino',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({query:q})})
    const payload=await response.json().catch(()=>({}))
    if(!response.ok||!payload?.ok)throw new Error(payload?.error||('No pude identificar el destino (HTTP '+response.status+')'))
    return payload
  }

  async function quoteViaCargo(official){
    const response=await fetch(API+'/api/cotizar',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({destinationCp:official.cp,locality:official.locality,province:official.province,quantity:Number(quantity||1)})})
    const payload=await response.json().catch(()=>({}))
    if(!response.ok||!payload?.ok)throw new Error(payload?.error||('No pude obtener la tarifa de Vía Cargo (HTTP '+response.status+')'))
    return payload
  }

  async function run(){
    const raw=clean(query)
    if(!raw)return setError('Escribí un código postal o una localidad.')
    setLoading(true);setError('');setResult(null)
    try{
      const cp=extractCp(raw)
      const locality=localCandidate(raw)
      if(!cp&&locality){
        const direct=resolveLogisticsZone({locality})
        if(direct){setResult({kind:'logistics',zone:direct,locality,source:'localidad'});return}
      }
      const official=await resolveOfficial(cp||raw)
      const local=resolveLogisticsZone({locality:official.locality,province:official.province,postalCode:official.cp})
      if(local){setResult({kind:'logistics',zone:local,official,source:cp?'código postal':'destino oficial'});return}
      const quote=await quoteViaCargo(official)
      setResult({kind:'viacargo',official,quote})
    }catch(e){setError(e?.message||String(e))}finally{setLoading(false)}
  }

  return <>
    <Title title="Asistente de ventas" sub="Pasale un código postal o una localidad: identifica el tipo de envío y calcula el importe correspondiente."/>
    <div className="panel" style={{maxWidth:920}}>
      <div className="notice" style={{marginBottom:16}}><b>Una sola consulta</b><span>Ejemplos: “1609”, “José León Suárez”, “2000 Rosario” o “3700”. Si está dentro de Logística GBA/CABA aplica la tarifa fija de zona; si está afuera consulta Vía Cargo.</span></div>
      <div className="form-grid two">
        <label>Código postal o localidad<input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')run()}} placeholder="Ej.: 2000 o Rosario"/></label>
        <label>Cantidad de piezas<input value={quantity} inputMode="numeric" onChange={e=>setQuantity(Math.max(1,Number(e.target.value)||1))}/></label>
      </div>
      <div className="actions" style={{marginTop:14}}><button className="primary" type="button" disabled={loading} onClick={run}>{loading?'Buscando destino y tarifa…':'Calcular envío'}</button></div>
      {error&&<div className="notice" style={{marginTop:16,borderColor:'#ef4444'}}><b>No pude cerrar la cotización</b><span>{error}</span></div>}
      {result?.kind==='logistics'&&<div className="panel" style={{marginTop:16,boxShadow:'none',background:'#fbfdff'}}>
        <small style={{fontWeight:850,letterSpacing:'.08em',color:'#1596a8'}}>LOGÍSTICA GBA/CABA</small>
        <h2 style={{margin:'8px 0 4px',fontSize:30}}>{money(result.zone.price)}</h2>
        <p style={{margin:'4px 0'}}><b>Zona:</b> {result.zone.id}</p>
        <p style={{margin:'4px 0'}}><b>Destino:</b> {result.official?`${result.official.locality} (${result.official.cp}) - ${result.official.province}`:result.locality}</p>
        <p style={{margin:'8px 0 0',color:'#687386'}}>La tarifa de logística es por pedido y no cambia por la cantidad de piezas.</p>
      </div>}
      {result?.kind==='viacargo'&&<div className="panel" style={{marginTop:16,boxShadow:'none',background:'#fbfdff'}}>
        <small style={{fontWeight:850,letterSpacing:'.08em',color:'#d82a74'}}>VÍA CARGO · AGENCIA → AGENCIA</small>
        <h2 style={{margin:'8px 0 4px',fontSize:30}}>{money(result.quote.price)}</h2>
        <p style={{margin:'4px 0'}}><b>Destino identificado:</b> {result.official.locality} ({result.official.cp}) - {result.official.province}</p>
        <p style={{margin:'4px 0'}}><b>Origen:</b> Boulogne (1609) - Buenos Aires</p>
        <p style={{margin:'4px 0'}}><b>Cantidad:</b> {Number(quantity||1)} piezas</p>
        <p style={{margin:'4px 0'}}><b>Modalidad:</b> Agencia → Agencia · pago en destino</p>
        {result.quote.package&&<p style={{margin:'4px 0'}}><b>Bulto:</b> {result.quote.package.kg||1} kg · {result.quote.package.width||40}×{result.quote.package.height||30}×{result.quote.package.length||30} cm</p>}
      </div>}
    </div>
  </>
}
