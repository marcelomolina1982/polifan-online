export const config={maxDuration:300}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  const base='https://polifan-cnc-solver-lab.onrender.com'
  try{
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),285000)
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
    res.setHeader('cache-control','no-store')
    return res.send(text)
  }catch(e){
    const reason=e?.name==='AbortError'?'El motor Lab superó el tiempo máximo total de cálculo.':e?.message||String(e)
    return res.status(502).json({ok:false,error:'No se pudo conectar con el motor Lab en Render: '+reason,renderBase:base})
  }
}