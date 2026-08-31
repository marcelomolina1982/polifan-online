export const config={maxDuration:30}

const BASE='https://polifan-motor-1230-bench-v5.onrender.com'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

async function fetchTimed(url,timeoutMs=7000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{headers:{accept:'application/json'},cache:'no-store',signal:controller.signal})}
  finally{clearTimeout(timer)}
}

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido'})
  const raw=String(req.query?.id||'').trim()
  if(!raw)return res.status(400).json({ok:false,error:'Falta id del trabajo'})
  const sep=raw.indexOf(':')
  const id=sep>0?raw.slice(sep+1):raw
  let lastError=null
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const r=await fetchTimed(BASE+'/solve-status?id='+encodeURIComponent(id),7000)
      const text=await r.text()
      res.setHeader('cache-control','no-store')
      res.setHeader('x-solver-backend','motor-1230-v5-status-v3')
      res.setHeader('x-solver-status-attempt',String(attempt))
      if(r.ok||![502,503,504].includes(r.status)){
        res.status(r.status)
        res.setHeader('content-type',r.headers.get('content-type')||'application/json')
        return res.send(text)
      }
      lastError=new Error('Render HTTP '+r.status)
    }catch(error){lastError=error}
    if(attempt<3)await sleep(500*attempt)
  }
  res.setHeader('cache-control','no-store')
  res.setHeader('x-solver-backend','motor-1230-v5-status-v3')
  return res.status(200).json({ok:true,status:'working',stage:'Sparrow se está despertando…',retryable:true,error:'Render todavía no respondió; la app seguirá consultando automáticamente.',detail:lastError?.name==='AbortError'?'timeout':(lastError?.message||String(lastError||'')),renderBase:BASE,backend:'motor-1230-v5-status-v3'})
}
