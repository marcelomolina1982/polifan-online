export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido'})
  const raw=String(req.query?.id||'').trim()
  if(!raw)return res.status(400).json({ok:false,error:'Falta id del trabajo'})
  let id=raw
  const sep=raw.indexOf(':')
  if(sep>0)id=raw.slice(sep+1)
  const base='https://polifan-motor-1230-bench-v5.onrender.com'
  try{
    const r=await fetch(base+'/solve-status?id='+encodeURIComponent(id),{headers:{accept:'application/json'},cache:'no-store'})
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    res.setHeader('cache-control','no-store')
    res.setHeader('x-solver-backend','motor-1230-v5')
    return res.send(text)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo consultar Sparrow 1230 V5 en Render: '+(e?.message||String(e)),renderBase:base})
  }
}
