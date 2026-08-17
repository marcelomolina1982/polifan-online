export const config={maxDuration:60}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  const productionBase='https://polifan-cnc-solver.onrender.com'
  const envBase=String(process.env.MOTOR_DEFINITIVO_API_URL||'').replace(/\/$/,'')
  const base=envBase||productionBase
  try{
    const incoming=req.body||{}
    // Sparrow V1.8 productivo: la API es la fuente de verdad aunque una UI vieja
    // conserve valores anteriores en caché o hardcodeados.
    const payload={...incoming,gapCm:.25,targetDensity:70,widthCm:121.4,heightCm:57.4,
      clientEngineVersion:'Sparrow V1.8',requiredGapMm:2.5,edgeMarginMm:3}
    const r=await fetch(base+'/nest-jobs',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload)
    })
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    return res.send(text)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo iniciar Sparrow estable en Render: '+(e?.message||String(e))})
  }
}
