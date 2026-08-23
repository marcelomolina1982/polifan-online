export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Método no permitido'})
  const raw=String(req.query?.id||'').trim()
  if(!raw)return res.status(400).json({ok:false,error:'Falta id del trabajo'})

  let key='prod'
  let id=raw
  const sep=raw.indexOf(':')
  if(sep>0){
    key=raw.slice(0,sep)
    id=raw.slice(sep+1)
  }
  const bases={
    test:'https://polifan-cnc-solver-test.onrender.com',
    lab:'https://polifan-cnc-solver-lab.onrender.com',
    prod:'https://polifan-cnc-solver.onrender.com',
  }
  const base=bases[key]||bases.prod

  try{
    const r=await fetch(base+'/nest-jobs/'+encodeURIComponent(id),{headers:{accept:'application/json'},cache:'no-store'})
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    res.setHeader('cache-control','no-store')
    res.setHeader('x-solver-backend',key in bases?key:'prod')
    return res.send(text)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo consultar Sparrow en Render: '+(e?.message||String(e)),renderBase:base})
  }
}
