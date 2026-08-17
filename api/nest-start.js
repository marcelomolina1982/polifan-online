export const config={maxDuration:60}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  // Motor Lab v25.0.20: ruta fijada explícitamente al solver LAB actualizado en Render.
  // No usar variables heredadas para evitar volver al solver estable viejo sin -lab.
  const base='https://polifan-cnc-solver-lab.onrender.com'
  try{
    const incoming=req.body||{}
    const payload={...incoming,gapCm:.25,targetDensity:70,widthCm:122,heightCm:58,
      clientEngineVersion:'Sparrow V1.8 Final Growth',clientBuild:'v25.0.20-final-growth',
      requiredGapMm:2.5,edgeMarginMm:3,maxGrowthTarget:16}
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
    return res.status(502).json({ok:false,error:'No se pudo iniciar Sparrow Lab en Render: '+(e?.message||String(e)),renderBase:base})
  }
}