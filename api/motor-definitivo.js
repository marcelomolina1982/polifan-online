function addLeftSafetyMargin(svgText,marginMm=3){
  if(!svgText)return svgText
  return String(svgText).replace(/(<g\s+id="pieza_\d+"[^>]*transform="matrix\()([^\"]+)("[^>]*data-polifan-piece="1"[^>]*>)/g,(full,prefix,matrix,suffix)=>{
    const nums=matrix.trim().split(/\s+/).map(Number)
    if(nums.length!==6||nums.some(n=>!Number.isFinite(n)))return full
    nums[4]=Number((nums[4]+marginMm).toFixed(6))
    return prefix+nums.join(' ')+suffix
  }).replace(/(<g\s+id="pieza_\d+"[^>]*data-polifan-piece="1"[^>]*transform="matrix\()([^\"]+)("[^>]*>)/g,(full,prefix,matrix,suffix)=>{
    const nums=matrix.trim().split(/\s+/).map(Number)
    if(nums.length!==6||nums.some(n=>!Number.isFinite(n)))return full
    nums[4]=Number((nums[4]+marginMm).toFixed(6))
    return prefix+nums.join(' ')+suffix
  })
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido'})
  const labBase='https://polifan-cnc-solver-lab.onrender.com'
  const envBase=String(process.env.MOTOR_DEFINITIVO_API_URL||'').replace(/\/$/,'')
  const base=envBase||labBase
  try{
    const r=await fetch(base+'/motor-definitivo/svg',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(req.body||{})
    })
    const text=await r.text()
    let payload=null
    try{payload=JSON.parse(text)}catch{}
    if(payload&&String(payload.status||'').startsWith('CERTIFICADO')&&payload.svgText){
      payload.svgText=addLeftSafetyMargin(payload.svgText,3)
      payload.labLeftSafetyMarginMm=3
      payload.labMarginNote='Traslación global +3 mm a la derecha después del certificado; no cambia separación entre piezas.'
      return res.status(r.status).json(payload)
    }
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    return res.send(text)
  }catch(e){
    return res.status(502).json({ok:false,error:'No se pudo conectar con el certificador V1.7 LAB: '+(e?.message||String(e))})
  }
}
