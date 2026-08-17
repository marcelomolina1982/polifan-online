export const config={maxDuration:60}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  const productionBase='https://polifan-cnc-solver.onrender.com'
  const envBase=String(process.env.MOTOR_DEFINITIVO_API_URL||'').replace(/\/$/,'')
  const base=envBase||productionBase
  try{
    const incoming=req.body||{}
    // Fuente de verdad de v25.0.19: enviamos la placa física completa.
    // Sparrow V1.8 reserva internamente 3 mm en cada borde (1214 x 574 útiles).
    const payload={...incoming,gapCm:.25,targetDensity:70,widthCm:122,heightCm:58,
      clientEngineVersion:'Sparrow V1.8 Growth Fix',clientBuild:'v25.0.19-diagnostic',
      requiredGapMm:2.5,edgeMarginMm:3}
    const r=await fetch(base+'/nest-jobs',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload)
    })
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    res.setHeader('cache-control','no-store')
    return res.send(text)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo iniciar Sparrow estable en Render: '+(e?.message||String(e))})
  }
}
