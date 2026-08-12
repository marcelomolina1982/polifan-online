export const config={maxDuration:300}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  // Producción: usar el servicio definido por render.yaml. La URL de test anterior
  // podía quedar dormida, inexistente o desconectada y terminaba como Failed to fetch.
  const productionBase='https://polifan-cnc-solver.onrender.com'
  const envBase=String(process.env.MOTOR_DEFINITIVO_API_URL||process.env.MOTOR_DEFINITIVO_TEST_API_URL||'').replace(/\/$/,'')
  const base=envBase||productionBase
  try{
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),285000)
    const r=await fetch(base+'/nest-sparrow',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(req.body||{}),
      signal:controller.signal
    })
    clearTimeout(timeout)
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    return res.send(text)
  }catch(e){
    const reason=e?.name==='AbortError'?'Sparrow superó el tiempo máximo total de cálculo.':e?.message||String(e)
    return res.status(502).json({ok:false,error:'No se pudo conectar con Sparrow en Render: '+reason,renderBase:base})
  }
}
