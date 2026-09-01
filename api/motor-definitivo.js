export const config={maxDuration:60}
const BASE='https://polifan-hard-cert-v4.onrender.com'

function normalize1230Svg(svgText){
  if(!svgText)return svgText
  return String(svgText)
    .replace(/width="1220mm"/i,'width="1230mm"')
    .replace(/viewBox="0 0 1220 580"/i,'viewBox="0 0 1230 580"')
}

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Método no permitido'})
  const path=req.method==='GET'?'/health':'/certify'
  try{
    let payload=req.body||{}
    if(req.method==='POST'&&payload.svgText)payload={...payload,svgText:normalize1230Svg(payload.svgText)}
    const options=req.method==='POST'?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}:{method:'GET'}
    const r=await fetch(BASE+path,options)
    const text=await r.text()
    let outgoing=text
    if(req.method==='POST'){
      try{
        const body=JSON.parse(text||'{}')
        if(body.svgText)body.svgText=normalize1230Svg(body.svgText)
        outgoing=JSON.stringify(body)
      }catch{}
    }
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    res.setHeader('cache-control','no-store')
    res.setHeader('x-certifier-backend','hard-cert-v4-1230')
    return res.send(outgoing)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo conectar con el certificador geométrico: '+(e?.message||String(e)),backend:BASE})
  }
}
