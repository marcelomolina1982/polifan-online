export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  const base=String(process.env.VITE_NEST_API_URL||'').replace(/\/$/,'')
  if(!base) return res.status(500).json({ok:false,error:'VITE_NEST_API_URL no configurada en Vercel'})
  try{
    const r=await fetch(base+'/motor-definitivo/svg',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req.body||{})})
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    return res.send(text)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo conectar con el solver: '+e.message})
  }
}
