export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})

  // Rama de prueba del Motor Polifan Definitivo.
  // Apunta exclusivamente al backend aislado de Render para no tocar producción.
  const testBase='https://polifan-cnc-solver-test.onrender.com'
  const envBase=String(process.env.MOTOR_DEFINITIVO_TEST_API_URL||'').replace(/\/$/,'')
  const base=envBase||testBase

  try{
    const r=await fetch(base+'/motor-definitivo/svg',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(req.body||{})
    })
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    return res.send(text)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo conectar con el solver de prueba: '+e.message})
  }
}
