export const config={maxDuration:300}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  const testBase='https://polifan-cnc-solver-test.onrender.com'
  const envBase=String(process.env.MOTOR_DEFINITIVO_TEST_API_URL||'').replace(/\/$/,'')
  const base=envBase||testBase
  try{
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),285000)
    const r=await fetch(base+'/nest-v4',{
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
    const reason=e?.name==='AbortError'?'El Motor V4 superó el tiempo máximo de cálculo.':e?.message||String(e)
    return res.status(502).json({ok:false,error:'No se pudo conectar con el Motor V4 en Render: '+reason})
  }
}
