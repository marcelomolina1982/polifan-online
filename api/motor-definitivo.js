function rewriteCertifiedSvgMetadata(svgText,data){
  if(!svgText||typeof svgText!=='string')return svgText
  const minGap=Number(data?.validation?.min_gap_mm??data?.min_gap_mm)
  return svgText.replace(/<metadata>([\s\S]*?)<\/metadata>/i,(full,raw)=>{
    try{
      const meta=JSON.parse(raw)
      delete meta.target_gap_used_mm
      meta.requested_internal_gap_mm=3.1
      meta.required_gap_mm=3.0
      if(Number.isFinite(minGap))meta.certified_min_gap_mm=Number(minGap.toFixed(3))
      meta.certification_status=String(data?.status||'')
      meta.certification_conflicts=Number(data?.validation?.conflicts??data?.conflicts??0)
      meta.certification_border_conflicts=Number(data?.validation?.border_conflicts??data?.border_conflicts??0)
      return `<metadata>${JSON.stringify(meta)}</metadata>`
    }catch{
      return full
    }
  })
}

const REQUIRED_GAP_MM=3.0
const PREFERRED_GAP_MM=3.1

function enforceResponseContract(data){
  if(!data||typeof data!=='object')return data
  const minGap=Number(data?.validation?.min_gap_mm??data?.min_gap_mm)
  const conflicts=Number(data?.validation?.conflicts??data?.conflicts??0)
  const border=Number(data?.validation?.border_conflicts??data?.border_conflicts??0)
  const geometryOk=Number.isFinite(minGap)&&minGap>=REQUIRED_GAP_MM&&conflicts===0&&border===0
  data.proxyRequiredGapMm=REQUIRED_GAP_MM
  data.proxyPreferredGapMm=PREFERRED_GAP_MM
  data.proxyGeometryAccepted=geometryOk
  if(Number.isFinite(minGap)&&minGap<REQUIRED_GAP_MM){
    data.ok=false
    data.status='RECHAZADO_GAP_MENOR_3MM'
    data.error=`Separación real ${minGap.toFixed(3)} mm: se requieren al menos ${REQUIRED_GAP_MM.toFixed(3)} mm.`
  }
  return data
}

export default async function handler(req,res){
  // Certificador geometrico aislado: valida GAP real, conflictos y borde.
  const base='https://polifan-cnc-solver-lab.onrender.com'

  if(!['GET','POST'].includes(req.method)){
    return res.status(405).json({ok:false,error:'Método no permitido'})
  }

  const targetPath=req.method==='GET' ? '/emergency-certify/health' : '/emergency-certify/svg'
  try{
    const requestBody=req.method==='POST'
      ? {
          ...(req.body||{}),
          requiredGapMm:REQUIRED_GAP_MM,
          finalRequiredGapMm:REQUIRED_GAP_MM,
          preferredGapMm:PREFERRED_GAP_MM,
          minimumGapMm:REQUIRED_GAP_MM,
          absoluteMinGapMm:REQUIRED_GAP_MM
        }
      : null

    const options=req.method==='POST'
      ? {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify(requestBody)
        }
      : {method:'GET'}

    const r=await fetch(base+targetPath,options)
    const text=await r.text()
    res.status(r.status)
    res.setHeader('content-type',r.headers.get('content-type')||'application/json')
    res.setHeader('cache-control','no-store')
    res.setHeader('x-certifier-backend','lab-emergency-unique-geometry-only')
    res.setHeader('x-required-gap-mm',String(REQUIRED_GAP_MM))
    res.setHeader('x-preferred-gap-mm',String(PREFERRED_GAP_MM))

    if(req.method==='GET'){
      try{
        const data=JSON.parse(text)
        if(data&&typeof data==='object'){
          data.backendAbsoluteMinGapMm=Number(data.absoluteMinGapMm)
          data.backendPreferredGapMm=Number(data.preferredGapMm)
          data.proxyRequiredGapMm=REQUIRED_GAP_MM
          data.proxyPreferredGapMm=PREFERRED_GAP_MM
          data.proxyRejectsBelowRequired=true
        }
        return res.send(JSON.stringify(data))
      }catch{
        return res.send(text)
      }
    }

    if(req.method==='POST'){
      try{
        let data=JSON.parse(text)
        data=enforceResponseContract(data)
        if(data&&typeof data==='object'&&typeof data.svgText==='string'){
          data.svgText=rewriteCertifiedSvgMetadata(data.svgText,data)
          data.exportMetadata={
            requestedInternalGapMm:PREFERRED_GAP_MM,
            requiredGapMm:REQUIRED_GAP_MM,
            certifiedMinGapMm:Number(data?.validation?.min_gap_mm??data?.min_gap_mm)
          }
        }
        return res.send(JSON.stringify(data))
      }catch{}
    }

    return res.send(text)
  }catch(e){
    return res.status(502).json({
      ok:false,
      stage:req.method==='GET' ? 'health-proxy' : 'svg-proxy',
      backend:base,
      error:'No se pudo conectar con el certificador geometrico de emergencia: '+(e?.message||String(e))
    })
  }
}
