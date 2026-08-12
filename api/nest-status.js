export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Método no permitido'})
  const id=String(req.query?.id||'').trim()
  if(!id)return res.status(400).json({ok:false,error:'Falta id del trabajo'})
  const productionBase='https://polifan-cnc-solver.onrender.com'
  const envBase=String(process.env.MOTOR_DEFINITIVO_API_URL||'').replace(/\/$/,'')
  const base=envBase||productionBase
  try{
    const r=await fetch(base+'/nest-jobs/'+encodeURIComponent(id),{headers:{accept:'application/json'}})
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    res.setHeader('cache-control','no-store')
    return res.send(text)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo consultar Sparrow estable en Render: '+(e?.message||String(e))})
  }
}
