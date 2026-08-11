const TRACE_PX_PER_CM = 20 // 2 px/mm: geometría de búsqueda; validación final usa SVG original
const WORKER_URL = '/sparroWASM/algorithmWorker.js'

const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const svgDataUrl=text=>`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
const loadImage=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('No se pudo rasterizar el SVG para Sparrow'));im.src=src})

function fillClosedHoles(mask,w,h){
  const outside=new Uint8Array(mask.length),qx=new Int32Array(mask.length),qy=new Int32Array(mask.length)
  let head=0,tail=0
  const push=(x,y)=>{if(x<0||y<0||x>=w||y>=h)return;const i=y*w+x;if(mask[i]||outside[i])return;outside[i]=1;qx[tail]=x;qy[tail]=y;tail++}
  for(let x=0;x<w;x++){push(x,0);push(x,h-1)}
  for(let y=0;y<h;y++){push(0,y);push(w-1,y)}
  while(head<tail){const x=qx[head],y=qy[head];head++;push(x-1,y);push(x+1,y);push(x,y-1);push(x,y+1)}
  const out=mask.slice();for(let i=0;i<out.length;i++)if(!mask[i]&&!outside[i])out[i]=1
  return out
}

function dilate(mask,w,h,r){
  if(r<=0)return mask
  const out=new Uint8Array(mask.length),rr=r*r
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      if(dx*dx+dy*dy>rr)continue
      const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h)out[yy*w+xx]=1
    }
  }
  return out
}

function largestComponent(mask,w,h){
  const seen=new Uint8Array(mask.length),qx=new Int32Array(mask.length),qy=new Int32Array(mask.length)
  let best=[]
  for(let sy=0;sy<h;sy++)for(let sx=0;sx<w;sx++){
    const si=sy*w+sx;if(!mask[si]||seen[si])continue
    let head=0,tail=0,pts=[];seen[si]=1;qx[tail]=sx;qy[tail]=sy;tail++
    while(head<tail){const x=qx[head],y=qy[head];head++;pts.push([x,y]);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const i=yy*w+xx;if(mask[i]&&!seen[i]){seen[i]=1;qx[tail]=xx;qy[tail]=yy;tail++}}}
    if(pts.length>best.length)best=pts
  }
  const out=new Uint8Array(mask.length);for(const [x,y] of best)out[y*w+x]=1
  return out
}

function traceBoundary(mask,w,h){
  let sx=-1,sy=-1
  outer:for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){sx=x;sy=y;break outer}
  if(sx<0)return []
  const dirs=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]
  const isOn=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&mask[y*w+x]
  let x=sx,y=sy,backDir=4,first=true,guard=0,pts=[]
  do{
    pts.push([x,y])
    let found=false
    for(let k=1;k<=8;k++){
      const di=(backDir+k)%8,dx=dirs[di][0],dy=dirs[di][1],nx=x+dx,ny=y+dy
      if(isOn(nx,ny)){x=nx;y=ny;backDir=(di+4)%8;found=true;break}
    }
    if(!found)break
    first=false;guard++
  }while((x!==sx||y!==sy||first)&&guard<w*h*4)
  return pts
}

function perpendicularDistance(p,a,b){
  const [x,y]=p,[x1,y1]=a,[x2,y2]=b,dx=x2-x1,dy=y2-y1
  if(dx===0&&dy===0)return Math.hypot(x-x1,y-y1)
  const t=Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy)))
  return Math.hypot(x-(x1+t*dx),y-(y1+t*dy))
}
function simplifyOpen(points,tol){
  if(points.length<=2)return points
  let max=0,idx=0
  for(let i=1;i<points.length-1;i++){const d=perpendicularDistance(points[i],points[0],points[points.length-1]);if(d>max){max=d;idx=i}}
  if(max>tol){const a=simplifyOpen(points.slice(0,idx+1),tol),b=simplifyOpen(points.slice(idx),tol);return a.slice(0,-1).concat(b)}
  return [points[0],points[points.length-1]]
}
function simplifyClosed(points,tol){
  if(points.length<8)return points
  let far=1,best=0;for(let i=1;i<points.length;i++){const d=Math.hypot(points[i][0]-points[0][0],points[i][1]-points[0][1]);if(d>best){best=d;far=i}}
  const a=simplifyOpen(points.slice(0,far+1),tol),b=simplifyOpen(points.slice(far).concat([points[0]]),tol)
  return a.slice(0,-1).concat(b.slice(0,-1))
}

async function partToPolygon(part,gapCm){
  const widthCm=Math.max(.1,num(part.sourceWidth||part.width)),heightCm=Math.max(.1,num(part.sourceHeight||part.height))
  const pad=Math.ceil(Math.max(0,num(gapCm))*TRACE_PX_PER_CM/2)+3
  const w=Math.ceil(widthCm*TRACE_PX_PER_CM)+pad*2,h=Math.ceil(heightCm*TRACE_PX_PER_CM)+pad*2
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h
  const ctx=canvas.getContext('2d',{willReadFrequently:true})
  if(part.svgText){
    const doc=new DOMParser().parseFromString(part.svgText,'image/svg+xml'),svg=doc.documentElement
    if(!svg||doc.querySelector('parsererror'))throw new Error(`SVG inválido: ${part.name||part.figure||'pieza'}`)
    svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n=>n.remove())
    if(part.blockInterior!==false)svg.querySelectorAll('path,polygon,polyline,circle,ellipse,rect').forEach(el=>{el.setAttribute('fill','#000');el.setAttribute('stroke','#000')})
    const im=await loadImage(svgDataUrl(new XMLSerializer().serializeToString(svg)))
    ctx.drawImage(im,pad,pad,widthCm*TRACE_PX_PER_CM,heightCm*TRACE_PX_PER_CM)
  }else{ctx.fillStyle='#000';ctx.fillRect(pad,pad,widthCm*TRACE_PX_PER_CM,heightCm*TRACE_PX_PER_CM)}
  const rgba=ctx.getImageData(0,0,w,h).data;let mask=new Uint8Array(w*h)
  for(let i=0;i<mask.length;i++)if(rgba[i*4+3]>18)mask[i]=1
  if(part.blockInterior!==false)mask=fillClosedHoles(mask,w,h)
  mask=largestComponent(mask,w,h)
  const radius=Math.max(0,Math.round(Math.max(0,num(gapCm))*TRACE_PX_PER_CM/2))
  mask=dilate(mask,w,h,radius)
  let pts=traceBoundary(mask,w,h)
  if(pts.length<3)throw new Error(`Sparrow no pudo extraer contorno: ${part.name||part.figure||'pieza'}`)
  pts=simplifyClosed(pts,Math.max(1,TRACE_PX_PER_CM*.04))
  const mmPerPx=10/TRACE_PX_PER_CM
  const polygon=pts.map(([x,y])=>[x*mmPerPx,y*mmPerPx])
  return {polygon,padMm:pad*mmPerPx,widthCm,heightCm}
}

function workerAvailable(){return typeof Worker!=='undefined'&&typeof SharedArrayBuffer!=='undefined'&&globalThis.crossOriginIsolated===true}

function parseTransform(s=''){
  let tx=0,ty=0,angle=0
  const tm=String(s).match(/translate\(\s*([-+\d.eE]+)[ ,]+([-+\d.eE]+)\s*\)/i)
  if(tm){tx=num(tm[1]);ty=num(tm[2])}
  const rm=String(s).match(/rotate\(\s*([-+\d.eE]+)/i);if(rm)angle=num(rm[1])
  return {tx,ty,angle:((angle%360)+360)%360}
}

function parseResultSvg(svgText,itemMap){
  const doc=new DOMParser().parseFromString(svgText,'image/svg+xml')
  if(doc.querySelector('parsererror'))throw new Error('Sparrow devolvió un SVG inválido')
  const placements=[]
  doc.querySelectorAll('#items use, use').forEach(use=>{
    const href=use.getAttribute('href')||use.getAttribute('xlink:href')||''
    const m=href.match(/#item_(\d+)/i);if(!m)return
    const idx=Number(m[1]),meta=itemMap.get(idx);if(!meta)return
    const {tx,ty,angle}=parseTransform(use.getAttribute('transform')||'')
    const rad=angle*Math.PI/180,c=Math.cos(rad),sn=Math.sin(rad),w=meta.widthCm*10,h=meta.heightCm*10,pad=meta.padMm
    const rawOriginX=tx+pad*c-pad*sn,rawOriginY=ty+pad*sn+pad*c
    const corners=[[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>[x*c-y*sn,x*sn+y*c])
    const minX=Math.min(...corners.map(q=>q[0])),minY=Math.min(...corners.map(q=>q[1]))
    placements.push({...meta,xCm:(rawOriginX+minX)/10,yCm:(rawOriginY+minY)/10,angle})
  })
  if(!placements.length)throw new Error('Sparrow terminó sin transformaciones de piezas')
  return placements
}

async function buildInstance(kits,gapCm,stripHeightMm,angleStep=10){
  const items=[],itemMap=new Map();let id=0
  for(const kit of kits){
    for(const part of kit.parts){
      const geo=await partToPolygon(part,gapCm)
      const allowed=part.allowRotate===false?[0]:Array.from({length:Math.floor(360/angleStep)},(_,i)=>i*angleStep)
      items.push({id,demand:1,allowed_orientations:allowed,shape:{type:'simple_polygon',data:geo.polygon}})
      itemMap.set(id,{...part,padMm:geo.padMm,widthCm:geo.widthCm,heightCm:geo.heightCm});id++
    }
  }
  return {json:JSON.stringify({name:'polifan',items,strip_height:stripHeightMm}),itemMap}
}

function runWorker(input,{timeLimit=12,nWorkers=2,seed=17,onProgress=null}={}){
  return new Promise((resolve,reject)=>{
    if(!workerAvailable())return reject(new Error('Sparrow WASM requiere COOP/COEP + SharedArrayBuffer'))
    const worker=new Worker(WORKER_URL,{type:'module'});let finished=false
    const stop=()=>{if(!finished){finished=true;worker.terminate()}}
    const fail=e=>{stop();reject(e instanceof Error?e:new Error(String(e)))}
    worker.onerror=e=>fail(new Error(`Worker Sparrow: ${e.message||'error'}`))
    worker.onmessage=e=>{
      const d=e.data||{}
      if(Array.isArray(d)){onProgress?.(d.map(x=>x?.message||String(x)).join('\n'));return}
      if(d.type==='processing'||d.type==='intermediate')onProgress?.(d.message||d.type)
      if(d.type==='error')return fail(new Error(d.message||'Error Sparrow'))
      if(d.type==='finished'){const result=d.result;stop();resolve(result);return}
      if(d.type==='init_shared_memory'){
        worker.postMessage({type:'start',payload:{input,optimizationAlgo:'sparrow',showLogsInstant:false,showPreviewSvg:false,timeLimit,seed:BigInt(seed),useEarlyTermination:true,nWorkers}})
      }
    }
    worker.postMessage({type:'init',payload:{nWorkers,showLogsInstant:false}})
  })
}

export async function solveWithSparrow(kits,wCm,hCm,gapCm,{target=10,timeLimit=12,angleStep=10,nWorkers=2,seed=17,onProgress=null,shouldStop=null}={}){
  if(!workerAvailable())throw new Error('Sparrow WASM no está disponible: faltan headers COOP/COEP o SharedArrayBuffer')
  const subset=kits.slice(0,Math.min(target,kits.length)),stripHeightMm=num(hCm,58)*10
  const built=await buildInstance(subset,Math.max(.3,num(gapCm,.3)),stripHeightMm,angleStep)
  if(shouldStop?.())throw new Error('Cálculo cancelado')
  const svg=await runWorker(built.json,{timeLimit,nWorkers,seed,onProgress})
  const placements=parseResultSvg(svg,built.itemMap)
  const extents=placements.map(p=>{
    const rad=p.angle*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),w=p.widthCm*10,h=p.heightCm*10
    const pts=[[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>[x*c-y*s,x*s+y*c])
    return {right:p.xCm*10+(Math.max(...pts.map(q=>q[0]))-Math.min(...pts.map(q=>q[0]))),bottom:p.yCm*10+(Math.max(...pts.map(q=>q[1]))-Math.min(...pts.map(q=>q[1])))}
  })
  const usedRight=Math.max(...extents.map(x=>x.right),0),usedBottom=Math.max(...extents.map(x=>x.bottom),0)
  if(usedRight>num(wCm,122)*10+.05||usedBottom>num(hCm,58)*10+.05)throw new Error(`Sparrow excedió la placa: ${usedRight.toFixed(1)} × ${usedBottom.toFixed(1)} mm`)
  return {placements,svg,completeFigures:new Set(placements.map(p=>p.kitId)).size,usedWidthMm:usedRight,engine:'Sparrow WASM + jagua-rs'}
}
