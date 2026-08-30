import React,{useState} from 'react'
import {Title} from '../components/UI'

const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(value||0))
const ENDPOINT='https://viacargo-quote-probe2.onrender.com/api/cotizar'

export default function ShippingTest(){
  const [form,setForm]=useState({cp:'3700',locality:'Presidencia Roque Sáenz Peña',province:'Chaco',quantity:12})
  const [loading,setLoading]=useState(false),[result,setResult]=useState(null),[error,setError]=useState('')
  const patch=(key,value)=>setForm(current=>({...current,[key]:value}))
  async function run(){
    setLoading(true);setError('');setResult(null)
    try{
      const response=await fetch(ENDPOINT,{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({destinationCp:String(form.cp||'').trim(),locality:String(form.locality||'').trim(),province:String(form.province||'').trim(),quantity:Number(form.quantity||0)})})
      const payload=await response.json().catch(()=>({}))
      if(!response.ok||!payload?.ok)throw new Error(payload?.error||`HTTP ${response.status}`)
      setResult(payload)
    }catch(e){setError(e?.message||String(e))}finally{setLoading(false)}
  }
  return <>
    <Title title="Prueba de envíos" sub="Cotizá Vía Cargo sin crear pedidos ni guardar datos."/>
    <div className="panel" style={{maxWidth:900}}>
      <div className="notice" style={{marginBottom:16}}><b>Prueba recomendada</b><span>CP 3700 · Presidencia Roque Sáenz Peña · Chaco · 12 unidades. Debe validar el destino oficial y devolver una tarifa Agencia → Agencia positiva.</span></div>
      <div className="form-grid two">
        <label>Código postal<input value={form.cp} inputMode="numeric" onChange={e=>patch('cp',e.target.value)}/></label>
        <label>Cantidad<input value={form.quantity} inputMode="numeric" onChange={e=>patch('quantity',e.target.value)}/></label>
        <label>Localidad<input value={form.locality} onChange={e=>patch('locality',e.target.value)}/></label>
        <label>Provincia<input value={form.province} onChange={e=>patch('province',e.target.value)}/></label>
      </div>
      <div className="actions" style={{marginTop:14}}><button className="primary" type="button" disabled={loading} onClick={run}>{loading?'Cotizando…':'Probar Vía Cargo'}</button></div>
      {error&&<div className="notice" style={{marginTop:16,borderColor:'#ef4444'}}><b>Error de cotización</b><span>{error}</span></div>}
      {result&&<div className="panel" style={{marginTop:16,boxShadow:'none'}}>
        <small style={{fontWeight:800,letterSpacing:'.08em',color:'#2f8b63'}}>RESPUESTA OFICIAL VALIDADA</small>
        <h3 style={{margin:'8px 0'}}>{money(result.price)}</h3>
        <p style={{margin:'4px 0'}}><b>Destino:</b> {result.destination||`${form.locality} (${form.cp}) - ${form.province}`}</p>
        <p style={{margin:'4px 0'}}><b>Origen:</b> {result.origin||'Boulogne (1609) - Buenos Aires'}</p>
        <p style={{margin:'4px 0'}}><b>Modalidad:</b> Agencia → Agencia · pago en destino</p>
        {result.package&&<p style={{margin:'4px 0'}}><b>Bulto:</b> {result.package.weightKg||result.package.weight||1} kg · {result.package.lengthCm||result.package.alto||40}×{result.package.widthCm||result.package.ancho||30}×{result.package.heightCm||result.package.profundidad||30} cm</p>}
        {result.cached&&<small>Respuesta obtenida desde caché corta del backend.</small>}
      </div>}
    </div>
  </>
}
