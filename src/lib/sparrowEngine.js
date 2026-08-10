const SPARROW_WORKER='/sparroWASM/assets/algorithmWorker-BE3dlI69.js'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f

function rdp(points,eps){
  if(points.length<3)return points
  const a=points[0],b=points[points.length-1],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy||1
  let best=0,idx=-1
  for(let i=1;i<points.length-1;i++){
    const p=points[i],t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den
    const x=a[0]+t*dx,y=a[1]+t*dy,d=Math.hypot(p[0]-x,p[1]-y)
    if(d>best){best=d;idx=i}
  }
  if(best<=eps)return [a,b]
  const l=rdp(points.slice(0,idx+1),eps),r=rdp(points.slice(idx),eps)
  return l.slice(0,-1).concat(r)
}

export function maskOuterPolygon(mask,w,h,scale,pad=0){
  const isOn=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&mask[y*w+x]
  let sx=-1,sy=-1
  for(let y=0;y<h&&sy<0;y++)for(let x=0;x<w;x++)if(isOn(x,y)&&(!isOn(x-1,y)||!isOn(x,y-1)||!isOn(x+1,y)||!isOn(x,y+1))){sx=x;sy=y;break}
  if(sx<0)return []
  const dirs=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]
  let x=sx,y=sy,back=4,first=true,guard=0;const pts=[]
  do{
    pts.push([(x-pad)/scale,(y-pad)/scale])
    let found=-1
    for(let k=1;k<=8;k++){const d=(back+k)%8,nx=x+dirs[d][0],ny=y+dirs[d][1];if(isOn(nx,ny)){found=d;x=nx;y=ny;back=(d+4)%8;break}}
    if(found<0)break
    first=false
  }while((x!==sx||y!==sy||first)&&++guard<w*h*4)
  if(pts.length<3)return []
  let far=1,farD=0
  for(let i=1;i<pts.length;i++){const d=Math.hypot(pts[i][0]-pts[0][0],pts[i][1]-pts[0][1]);if(d>farD){farD=d;far=i}}
  const a=rdp(pts.slice(0,far+1),0.05),b=rdp(pts.slice(far).concat([pts[0]]),0.05)
  const simp=a.slice(0,-1).concat(b.slice(0,-1))
  const out=simp.length>=3?simp:pts
  return out.concat([out[0]])
}

export function buildSparrowInput(items,heightCm=58,angleStep=10){
  return JSON.stringify({name:'polifan',strip_height:num(heightCm)*10,items:items.map((it,id)=>({
    id,demand:1,dxf:`polifan/${it.instanceId||id}.dxf`,
    allowed_orientations:it.allowRotate===false?[0]:Array.from({length:Math.max(1,Math.round(360/angleStep))},(_,i)=>i*angleStep),
    shape:{type:'simple_polygon',data:it.polygonMm}
  }))})
}

export function parseSparrowSvg(svgText){
  const doc=new DOMParser().parseFromString(svgText,'image/svg+xml')
  const out=[]
  doc.querySelectorAll('#items use').forEach(el=>{
    const href=el.getAttribute('href')||el.getAttribute('xlink:href')||''
    const m=href.match(/#item_(\d+)/),t=el.getAttribute('transform')||''
    const tr=t.match(/translate\(\s*([-+\d.eE]+)[ ,]+([-+\d.eE]+)\s*\)/)
    const rr=t.match(/rotate\(\s*([-+\d.eE]+)\s*\)/)
    if(m&&tr)out.push({itemId:Number(m[1]),xMm:Number(tr[1]),yMm:Number(tr[2]),angle:Number(rr?.[1]||0)})
  })
  return out
}

export function runSparrow(input,{timeLimit=45,nWorkers=2,onProgress}={}){
  return new Promise((resolve,reject)=>{
    if(!globalThis.crossOriginIsolated||typeof SharedArrayBuffer==='undefined')return reject(new Error('Sparrow requiere COOP/COEP y SharedArrayBuffer.'))
    const worker=new Worker(SPARROW_WORKER,{type:'module'})
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('Sparrow excedió el tiempo máximo.'))},(timeLimit+20)*1000)
    worker.onmessage=e=>{
      const d=e.data||{};onProgress?.(d)
      if(d.type==='finished'){clearTimeout(timer);worker.terminate();resolve({svg:d.result,placements:parseSparrowSvg(d.result)})}
      else if(d.type==='error'){clearTimeout(timer);worker.terminate();reject(new Error(d.message||'Error Sparrow'))}
    }
    worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message||'No se pudo iniciar Sparrow WASM'))}
    worker.postMessage({type:'start',payload:{input,showPreviewSvg:false,showLogsInstant:false,timeLimit,nWorkers,useEarlyTermination:true,optimizationAlgo:'sparrow'}})
  })
}
