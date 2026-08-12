export const config={maxDuration:300}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  const productionBase='https://polifan-cnc-solver.onrender.com'
  const envBase=String(process.env.MOTOR_DEFINITIVO_API_URL||process.env.MOTOR_DEFINITIVO_TEST_API_URL||'').replace(/\/$/,'')
  const base=envBase||productionBase
  try{
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),285000)
    // El servicio estable en main expone POST /nest. /nest-sparrow pertenecía
    // a la rama experimental y por eso producción respondía HTTP 404.
    const r=await fetch(base+'/nest',{
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
    const reason=e?.name==='AbortError'?'El motor estable superó el tiempo máximo total de cálculo.':e?.message||String(e)
    return res.status(502).json({ok:false,error:'No se pudo conectar con el motor estable en Render: '+reason,renderBase:base})
  }
}
