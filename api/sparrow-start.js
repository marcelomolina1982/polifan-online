export const config={maxDuration:60}

const BASE='https://polifan-sparrow-clean-docker.onrender.com'

async function fetchTimed(url,options={},timeoutMs=30000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
  finally{clearTimeout(timer)}
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'})
  try{
    // Despierta Render si la instancia free estaba dormida.
    try{await fetchTimed(BASE+'/async-health',{headers:{accept:'application/json'}},30000)}catch{}
    const r=await fetchTimed(BASE+'/solve-start',{
      method:'POST',
      headers:{'content-type':'application/json','accept':'application/json'},
      body:JSON.stringify(req.body||{})
    },30000)
    const text=await r.text()
    res.setHeader('cache-control','no-store')
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    return res.status(r.status).send(text)
  }catch(e){
    return res.status(503).json({ok:false,error:e?.name==='AbortError'?'Render no respondió a tiempo al iniciar el cálculo':(e?.message||String(e)),proxy:'vercel-sparrow-start'})
  }
}
