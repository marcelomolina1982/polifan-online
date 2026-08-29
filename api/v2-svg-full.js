export const config={maxDuration:20}

const SUPABASE_URL=process.env.VITE_SUPABASE_URL||'https://eftksimpkkvmyfurwqii.supabase.co'
const SUPABASE_KEY=process.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_RJheqVJ6VdJC7291e2z7WQ_0vsBsDWN'

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'})
  const id=String(req.query?.id||'').trim()
  if(!id)return res.status(400).json({error:'Falta id SVG'})
  const auth=String(req.headers?.authorization||'').trim()
  if(!/^Bearer\s+\S+/i.test(auth))return res.status(401).json({error:'Sesión requerida para cargar SVG'})
  try{
    const controller=new AbortController()
    const timer=setTimeout(()=>controller.abort(),12000)
    let response
    try{
      response=await fetch(SUPABASE_URL+'/rest/v1/rpc/get_v2_svg_full',{
        method:'POST',
        headers:{
          apikey:SUPABASE_KEY,
          authorization:auth,
          'content-type':'application/json',
          accept:'application/json'
        },
        body:JSON.stringify({p_id:id}),
        signal:controller.signal,
        cache:'no-store'
      })
    }finally{clearTimeout(timer)}
    const text=await response.text()
    let payload=null
    try{payload=text?JSON.parse(text):null}catch{}
    if(!response.ok)return res.status(response.status).json({error:payload?.message||payload?.error||('Supabase HTTP '+response.status)})
    const row=Array.isArray(payload)?payload[0]:payload
    return res.status(200).json({data:row?.data||null,updatedAt:row?.updated_at||''})
  }catch(error){
    const timeout=error?.name==='AbortError'
    return res.status(timeout?504:502).json({error:timeout?'Timeout cargando SVG desde Supabase':(error?.message||String(error))})
  }
}
