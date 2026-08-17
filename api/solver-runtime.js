export const config={maxDuration:30}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido'})
  const base='https://polifan-cnc-solver-lab.onrender.com'
  try{
    const r=await fetch(base+'/runtime-info',{headers:{accept:'application/json'},cache:'no-store'})
    const text=await r.text()
    res.status(r.status);res.setHeader('content-type',r.headers.get('content-type')||'application/json');res.setHeader('cache-control','no-store');return res.send(text)
  }catch(e){return res.status(502).json({ok:false,error:'No se pudo consultar runtime de Render Lab: '+(e?.message||String(e)),renderBase:base})}
}