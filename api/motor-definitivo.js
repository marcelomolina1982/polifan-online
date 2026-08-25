export const config={maxDuration:60}
const BASE='https://polifan-hard-cert-v4.onrender.com'

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Método no permitido'})
  const path=req.method==='GET'?'/health':'/certify'
  try{
    const options=req.method==='POST'?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req.body||{})}:{method:'GET'}
    const r=await fetch(BASE+path,options)
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    res.setHeader('cache-control','no-store')
    res.setHeader('x-certifier-backend','hard-cert-v4')
    return res.send(text)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo conectar con el certificador geométrico: '+(e?.message||String(e)),backend:BASE})
  }
}
