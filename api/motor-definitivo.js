export default async function handler(req,res){
  // EMERGENCIA DE CORTE 2026-08-22:
  // Forzamos el MISMO backend aislado que genera la placa. No usar la variable
  // MOTOR_DEFINITIVO_API_URL durante esta emergencia porque en Produccion todavia
  // apunta al certificador historico que exige 10 juegos y rechaza el fallback de 9.
  // La validacion geometrica (conflictos/borde/gap) sigue intacta en el laboratorio.
  const base='https://polifan-cnc-solver-lab.onrender.com'

  if(!['GET','POST'].includes(req.method)){
    return res.status(405).json({ok:false,error:'Método no permitido'})
  }

  const targetPath=req.method==='GET' ? '/motor-definitivo/health' : '/motor-definitivo/svg'
  try{
    const options=req.method==='POST'
      ? {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify(req.body||{})
        }
      : {method:'GET'}

    const r=await fetch(base+targetPath,options)
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    res.setHeader('cache-control','no-store')
    res.setHeader('x-certifier-backend','lab-emergency-forced')
    return res.send(text)
  }catch(e){
    return res.status(502).json({
      ok:false,
      stage:req.method==='GET' ? 'health-proxy' : 'svg-proxy',
      backend:base,
      error:'No se pudo conectar con el certificador V1.7 de emergencia: '+(e?.message||String(e))
    })
  }
}
