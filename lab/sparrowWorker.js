const GLUE='https://cdn.jsdelivr.net/gh/JeroenGar/sparroWASM@c486d715b524cfe9bfbe0933c5fadb556e7ac476/assets/sparroWASM-WUwBRWrA.js'
const WASM='https://cdn.jsdelivr.net/gh/JeroenGar/sparroWASM@c486d715b524cfe9bfbe0933c5fadb556e7ac476/assets/sparroWASM_bg-BMD11AKQ.wasm'
let modPromise=null,initialized=false,poolReady=false
const phase=message=>self.postMessage({type:'phase',message})
const mod=()=>modPromise||(phase('import-glue'),modPromise=import(GLUE))
async function initMain(nWorkers=2){
  const m=await mod();phase('glue-imported')
  if(!initialized){phase('wasm-init');await m.default({module_or_path:WASM});initialized=true;phase('wasm-ready');try{m.init_logger(2,false)}catch{}}
  if(!poolReady){phase('pool-init');await m.initThreadPool(Math.max(1,Math.min(4,Number(nWorkers)||2)));poolReady=true;phase('pool-ready')}
  return m
}
self.addEventListener('message',async ev=>{
  const data=ev.data||{}
  if(data.type==='wasm_bindgen_worker_init'){
    try{const m=await mod();await m.default(data.init);self.postMessage({type:'wasm_bindgen_worker_ready'});m.wbg_rayon_start_worker(data.receiver)}
    catch(error){self.postMessage({type:'error',message:'rayon-child '+String(error?.message||error)})}
    return
  }
  if(data.type!=='run')return
  try{
    phase('run-received')
    if(!crossOriginIsolated)throw new Error('crossOriginIsolated=false')
    const m=await initMain(data.nWorkers||2)
    self.postMessage({type:'ready'})
    phase('solver-start')
    m.run_sparrow(JSON.stringify(data.instance),false,BigInt(data.timeLimit||6),BigInt(data.seed||7),true,data.nWorkers||2)
  }catch(error){self.postMessage({type:'error',message:String(error?.message||error)})}
})
