export default async function handler(req,res){
  // EMERGENCIA DE CORTE 2026-08-22:
  // Usamos una ruta UNICA del backend aislado. No reutiliza /motor-definitivo/svg,
  // porque ese path tuvo variantes historicas con la regla de minimo 10 juegos.
  // Esta ruta certifica solamente geometria: gap, conflictos y borde.
  const base='https://polifan-cnc-solver-lab.onrender.com'

  if(!['GET','POST'].includes(req.method)){
    return res.status(405).json({ok:false,error:'Método no permitido'})
  }

  const targetPath=req.method==='GET' ? '/emergency-certify/health' : '/emergency-certify/svg'
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
    res.setHeader('x-certifier-backend','lab-emergency-unique-geometry-only')
    return res.send(text)
  }catch(e){
    return res.status(502).json({
      ok:false,
      stage:req.method==='GET' ? 'health-proxy' : 'svg-proxy',
      backend:base,
      error:'No se pudo conectar con el certificador geometrico de emergencia: '+(e?.message||String(e))
    })
  }
}
