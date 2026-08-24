export const config={maxDuration:30}

const BASE='https://polifan-sparrow-clean-docker.onrender.com'

async function fetchTimed(url,options={},timeoutMs=12000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
  finally{clearTimeout(timer)}
}

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido'})
  const id=String(req.query?.id||'').trim()
  if(!id)return res.status(400).json({ok:false,error:'Falta id'})
  try{
    const r=await fetchTimed(`${BASE}/solve-status?id=${encodeURIComponent(id)}`,{headers:{accept:'application/json'}},12000)
    const text=await r.text()
    res.setHeader('cache-control','no-store')
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    return res.status(r.status).send(text)
  }catch(e){
    return res.status(503).json({ok:false,error:e?.name==='AbortError'?'Render no respondió al consultar el cálculo':(e?.message||String(e)),proxy:'vercel-sparrow-status'})
  }
}
