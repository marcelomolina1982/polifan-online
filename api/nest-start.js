export const config={maxDuration:60}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  const labBase='https://polifan-cnc-solver-lab.onrender.com'
  const envBase=String(process.env.MOTOR_DEFINITIVO_API_URL||'').replace(/\/$/,'')
  const base=envBase||labBase
  try{
    const incoming=req.body||{}
    // LAB: reservar 3 mm reales a izquierda y derecha. Sparrow diseña dentro
    // de 1214 mm; al devolver el resultado nest-status desplaza todo +3 mm.
    // También bajamos el objetivo productivo del laboratorio a 75%.
    const payload={...incoming,widthCm:121.4,heightCm:58,targetDensity:75}
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
    return res.status(502).json({ok:false,error:'No se pudo iniciar Sparrow LAB en Render: '+(e?.message||String(e))})
  }
}
