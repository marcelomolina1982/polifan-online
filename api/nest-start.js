export const config={maxDuration:60}

const BASE='https://polifan-cnc-solver-test.onrender.com'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))

async function fetchTimed(url,options={},timeoutMs=12000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
  finally{clearTimeout(timer)}
}

async function wake(){
  try{
    const r=await fetchTimed(BASE+'/nest-sparrow/health',{headers:{accept:'application/json'}},30000)
    return {ok:r.ok,status:r.status}
  }catch(e){return {ok:false,error:e?.name==='AbortError'?'timeout':(e?.message||String(e))}}
}
function send(res,r,text){
  const ct=r.headers.get('content-type')||'application/json'
  res.status(r.status);res.setHeader('content-type',ct);res.setHeader('cache-control','no-store');res.setHeader('x-solver-backend','test')
  if(r.status===202&&ct.includes('application/json')){
    try{const body=JSON.parse(text);if(body?.jobId&&!String(body.jobId).includes(':'))body.jobId='test:'+body.jobId;body.backend='test';return res.send(JSON.stringify(body))}catch(_e){}
  }
  return res.send(text)
}
async function startJob(payload,timeoutMs=18000){return await fetchTimed(BASE+'/nest-jobs',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)},timeoutMs)}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'})
  const incoming=req.body||{}
  const payload={...incoming,gapCm:.3,widthCm:122,heightCm:58,clientEngineVersion:'Sparrow AREA-FIRST CERTIFICADO',clientBuild:'area-first-main-2026-08-23',requiredGapMm:3,edgeMarginMm:3,maxGrowthTarget:16}
  delete payload.targetDensity
  const failures=[]
  const w=await wake();if(!w.ok)failures.push({phase:'wake',...w});await sleep(500)
  for(let attempt=1;attempt<=2;attempt++){
    try{const r=await startJob(payload,18000);const text=await r.text();if(r.status===202||(r.status>=200&&r.status<500))return send(res,r,text);failures.push({phase:'start-'+attempt,status:r.status,response:text.slice(0,300)})}
    catch(e){failures.push({phase:'start-'+attempt,error:e?.name==='AbortError'?'timeout':(e?.message||String(e))})}
    if(attempt===1){await wake();await sleep(700)}
  }
  res.setHeader('cache-control','no-store');res.setHeader('x-solver-backend','test')
  return res.status(503).json({ok:false,backend:'test',error:'El motor certificado no respondió al iniciar el trabajo. No se generó ninguna placa ni se modificó el inventario.',failures,retryable:true})
}