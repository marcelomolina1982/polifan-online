const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))

const loaders=[
  ()=>import('./pages/OperationsHub'),
  ()=>import('./pages/OrderForm'),
  ()=>import('./pages/Orders'),
  ()=>import('./pages/ProductionCalendar'),
  ()=>import('./pages/CutList'),
  ()=>import('./pages/Stock'),
]

function networkAllowsPrefetch(){
  const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection
  if(c?.saveData)return false
  return !['slow-2g','2g'].includes(String(c?.effectiveType||''))
}

export function scheduleV2Prefetch(){
  if(!networkAllowsPrefetch()||document.visibilityState==='hidden')return
  const run=async()=>{
    for(const load of loaders){
      if(document.visibilityState==='hidden')break
      try{await load()}catch{}
      await wait(1200)
    }
  }
  if('requestIdleCallback'in window)window.requestIdleCallback(()=>run(),{timeout:5000})
  else setTimeout(run,3500)
}
