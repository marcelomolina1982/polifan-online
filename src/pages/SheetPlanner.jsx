import React, { useEffect, useMemo, useRef, useState } from 'react'
import { pendingCutByDelivery, pendingCutRows } from '../lib/inventory'
import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'
import { solveWithSparrow } from '../lib/sparrowEngine'

const COLORS=['#ec2c7c','#14b8b8','#087fc4','#7b3dbb','#f59e0b','#16a34a','#ef4444','#6366f1']
const PX_PER_CM=10
const VERIFY_PX_PER_CM=14
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f
const sameSize=(a,b,t=.0005)=>Math.abs(num(a)-num(b))<=t
const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)
const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const svgDataUrl=text=>`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
const loadImage=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('No se pudo leer el SVG'));im.src=src})

function modelSlug(value){return String(value||'modelo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'modelo'}
function componentModelId(item){return item.modelId||(item.productId?`producto:${item.productId}`:`modelo:${modelSlug(item.modelName||item.productName||String(item.name||'').replace(/\s*[·-]\s*(tapa|base|figura|capa.*)$/i,''))}`)}
function componentModelName(item){return item.modelName||item.productName||String(item.name||'Modelo').replace(/\s*[·-]\s*(tapa|base|figura|capa.*)$/i,'')}
function normalizedName(value){return modelSlug(String(value||'').replace(/\b(tapa|base|figura|capa)\b/gi,''))}

function parseSvg(text){
  const doc=new DOMParser().parseFromString(text,'image/svg+xml'),svg=doc.documentElement
  if(!svg||svg.nodeName.toLowerCase()!=='svg'||doc.querySelector('parsererror'))throw new Error('SVG inválido')
  svg.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n=>n.remove())
  let vb=svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number)
  if(!vb||vb.length!==4||!vb.every(Number.isFinite))vb=[0,0,parseFloat(svg.getAttribute('width'))||100,parseFloat(svg.getAttribute('height'))||100]
  return {viewBox:vb.join(' '),vbW:vb[2],vbH:vb[3],inner:[...svg.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('')}
}
async function makeMask(item,rotated=false,gapCm=0){
  const bw=Math.max(.1,num(item.width)),bh=Math.max(.1,num(item.height)),ow=rotated?bh:bw,oh=rotated?bw:bh
  const pad=Math.ceil(Math.max(0,num(gapCm))*PX_PER_CM/2),w=Math.max(1,Math.ceil(ow*PX_PER_CM)),h=Math.max(1,Math.ceil(oh*PX_PER_CM))
  const canvas=document.createElement('canvas');canvas.width=w+pad*2;canvas.height=h+pad*2
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#000'
  if(item.svgText){
    const doc=new DOMParser().parseFromString(item.svgText,'image/svg+xml'),svg=doc.documentElement
    if(item.blockInterior!==false)svg.querySelectorAll('path,polygon,polyline,circle,ellipse,rect').forEach(el=>{el.setAttribute('fill','#000');el.setAttribute('stroke','#000')})
    const im=await loadImage(svgDataUrl(new XMLSerializer().serializeToString(svg)))
    ctx.save();ctx.translate(pad,pad);if(rotated){ctx.translate(w,0);ctx.rotate(Math.PI/2);ctx.drawImage(im,0,0,h,w)}else ctx.drawImage(im,0,0,w,h);ctx.restore()
  }else ctx.fillRect(pad,pad,w,h)
  const alpha=ctx.getImageData(0,0,canvas.width,canvas.height).data;let mask=new Uint8Array(canvas.width*canvas.height)
  for(let i=0;i<mask.length;i++)if(alpha[i*4+3]>20)mask[i]=1
  if(item.blockInterior!==false)mask=fillClosedHoles(mask,canvas.width,canvas.height)
  if(pad){const d=new Uint8Array(mask.length);for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(mask[y*canvas.width+x])for(let dy=-pad;dy<=pad;dy++)for(let dx=-pad;dx<=pad;dx++)if(dx*dx+dy*dy<=pad*pad){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<canvas.width&&yy>=0&&yy<canvas.height)d[yy*canvas.width+xx]=1}mask=d}
  return {mask,pw:canvas.width,ph:canvas.height,w:ow,h:oh,pad}
}
function fillClosedHoles(mask,w,h){
  const outside=new Uint8Array(mask.length),queueX=new Int32Array(mask.length),queueY=new Int32Array(mask.length)
  let head=0,tail=0
  const push=(x,y)=>{const i=y*w+x;if(x<0||y<0||x>=w||y>=h||mask[i]||outside[i])return;outside[i]=1;queueX[tail]=x;queueY[tail]=y;tail++}
  for(let x=0;x<w;x++){push(x,0);push(x,h-1)}
  for(let y=0;y<h;y++){push(0,y);push(w-1,y)}
  while(head<tail){
    const x=queueX[head],y=queueY[head];head++
    if(x>0)push(x-1,y);if(x+1<w)push(x+1,y);if(y>0)push(x,y-1);if(y+1<h)push(x,y+1)
  }
  const filled=mask.slice()
  for(let i=0;i<filled.length;i++)if(!mask[i]&&!outside[i])filled[i]=1
  return filled
}
function collides(occ,sw,m,x,y){if(x<0||y<0||x+m.pw>sw)return true;for(let my=0;my<m.ph;my++)for(let mx=0;mx<m.pw;mx++)if(m.mask[my*m.pw+mx]&&occ[(y+my)*sw+x+mx])return true;return false}
function stamp(occ,sw,m,x,y){for(let my=0;my<m.ph;my++)for(let mx=0;mx<m.pw;mx++)if(m.mask[my*m.pw+mx])occ[(y+my)*sw+x+mx]=1}
async function validateNoOverlap(sheets,wCm,hCm,gap){
  const sw=Math.floor(wCm*PX_PER_CM),sh=Math.floor(hCm*PX_PER_CM)
  const problems=[]
  for(const sheet of sheets){
    const occ=new Uint8Array(sw*sh)
    for(const p of sheet.placed||[]){
      const mask=await makeMask(p,!!p.rotated,gap)
      const x=Math.round(num(p.x)*PX_PER_CM-mask.pad),y=Math.round(num(p.y)*PX_PER_CM-mask.pad)
      if(y<0||y+mask.ph>sh||collides(occ,sw,mask,x,y)){
        problems.push(`${p.name||p.figure||'pieza'} · placa ${sheet.number||'?'}`)
        continue
      }
      stamp(occ,sw,mask,x,y)
    }
  }
  return problems
}

function rectCollides(rects,x,y,w,h,gapPx=0){
  const ax1=x-gapPx,ay1=y-gapPx,ax2=x+w+gapPx,ay2=y+h+gapPx
  return rects.some(r=>{
    const bx1=r.x-gapPx,by1=r.y-gapPx,bx2=r.x+r.w+gapPx,by2=r.y+r.h+gapPx
    return ax1<bx2 && ax2>bx1 && ay1<by2 && ay2>by1
  })
}

function nextFrame(){return new Promise(resolve=>setTimeout(resolve,0))}

async function pack(items,wCm,hCm,gap,{maxSheets=Infinity,strictRects=false}={}){
  const sw=Math.floor(wCm*PX_PER_CM),sh=Math.floor(hCm*PX_PER_CM),pieces=[]
  for(const it of items){
    const q=Math.max(0,Math.floor(num(it.qty)))
    if(!q||!num(it.width)||!num(it.height))continue
    const normal=await makeMask(it,false,gap)
    const rotated=it.allowRotate!==false&&num(it.width)!==num(it.height)?await makeMask(it,true,gap):null
    for(let i=0;i<q;i++)pieces.push({...it,instanceId:`${it.id}-${i}`,normal,rotated})
  }

  pieces.sort((a,b)=>num(a.priority,999999)-num(b.priority,999999)||b.normal.pw*b.normal.ph-a.normal.pw*a.normal.ph)
  const sheets=[],rejected=[]

  function candidatePoints(sheet){
    const points=[[0,0]]
    for(const r of sheet.rects){
      points.push([r.x+r.w,r.y],[r.x,r.y+r.h])
    }
    const seen=new Set()
    return points
      .filter(([x,y])=>x>=0&&y>=0&&x<=sw&&y<=sh)
      .filter(([x,y])=>{const k=`${x}|${y}`;if(seen.has(k))return false;seen.add(k);return true})
      .sort((a,b)=>a[1]-b[1]||a[0]-b[0])
  }

  function fitsRects(sheet,x,y,w,h){
    if(x<0||y<0||x+w>sw||y+h>sh)return false
    return !sheet.rects.some(r=>x<r.x+r.w&&x+w>r.x&&y<r.y+r.h&&y+h>r.y)
  }

  function trySheetFast(sheet,p){
    const variants=[{m:p.normal,rotated:false},...(p.rotated?[{m:p.rotated,rotated:true}]:[])]
    const points=candidatePoints(sheet)
    let best=null
    for(const v of variants){
      for(const [x,y] of points){
        if(!fitsRects(sheet,x,y,v.m.pw,v.m.ph))continue
        const score=y*sw+x
        if(!best||score<best.score)best={...v,x,y,score}
        break
      }
    }
    if(!best)return false
    sheet.rects.push({x:best.x,y:best.y,w:best.m.pw,h:best.m.ph})
    sheet.placed.push({...p,x:(best.x+best.m.pad)/PX_PER_CM,y:(best.y+best.m.pad)/PX_PER_CM,w:best.m.w,h:best.m.h,rotated:best.rotated})
    return true
  }

  function trySheetMask(sheet,p){
    const variants=[{m:p.normal,rotated:false},...(p.rotated?[{m:p.rotated,rotated:true}]:[])]
    const points=candidatePoints(sheet)
    let best=null
    for(const v of variants){
      for(const [x,y] of points){
        if(x+v.m.pw>sw||y+v.m.ph>sh)continue
        if(collides(sheet.occ,sw,v.m,x,y))continue
        const score=y*sw+x
        if(!best||score<best.score)best={...v,x,y,score}
        break
      }
    }
    if(!best)return false
    stamp(sheet.occ,sw,best.m,best.x,best.y)
    sheet.rects.push({x:best.x,y:best.y,w:best.m.pw,h:best.m.ph})
    sheet.placed.push({...p,x:(best.x+best.m.pad)/PX_PER_CM,y:(best.y+best.m.pad)/PX_PER_CM,w:best.m.w,h:best.m.h,rotated:best.rotated})
    return true
  }

  const trySheet=(sheet,p)=>strictRects?trySheetFast(sheet,p):trySheetMask(sheet,p)

  for(let index=0;index<pieces.length;index++){
    const piece=pieces[index]
    let placed=false
    for(const sheet of sheets){
      if(trySheet(sheet,piece)){placed=true;break}
    }
    if(!placed&&sheets.length<maxSheets){
      const sheet={occ:new Uint8Array(sw*sh),rects:[],placed:[]}
      if(trySheet(sheet,piece)){sheets.push(sheet);placed=true}
    }
    if(!placed)rejected.push(piece)
    if(index>0&&index%10===0)await nextFrame()
  }

  const area=wCm*hCm
  sheets.forEach((s,i)=>{
    s.number=i+1
    s.used=s.placed.reduce((a,p)=>a+p.w*p.h,0)
    s.efficiency=area?100*s.used/area:0
    delete s.occ
    delete s.rects
  })
  return {sheets,rejected,total:pieces.length,sheetArea:area,used:sheets.reduce((a,s)=>a+s.used,0)}
}


function kitCountOnSheet(sheet){
  const ids=new Set()
  ;(sheet?.placed||[]).forEach(p=>p.kitId&&ids.add(p.kitId))
  return ids.size
}

function kitSummaryOnSheet(sheet){
  const byFigure={}
  const seen=new Set()
  ;(sheet?.placed||[]).forEach(p=>{
    if(!p.kitId||seen.has(p.kitId))return
    seen.add(p.kitId)
    byFigure[p.figure]=(byFigure[p.figure]||0)+1
  })
  return Object.entries(byFigure).map(([figure,qty])=>({figure,qty})).sort((a,b)=>a.figure.localeCompare(b.figure,'es',{sensitivity:'base'}))
}

function buildCompleteKits(rows,priority,date,source,modelResolver){
  const kits=[],missing=[]
  rows.forEach(row=>{
    const {product,model}=modelResolver(row.figure)
    const checked=usableModelComponents(model)
    const components=checked.components.filter(c=>['tapa','base','simple','capa'].includes(c.role||'simple'))
    if(!components.length){missing.push(`${row.figure}${checked.reason?` (${checked.reason})`:''}`);return}
    const roles=new Set(components.map(c=>c.role||'simple'))
    if(roles.has('tapa')!==roles.has('base')){
      missing.push(`${row.figure} (falta ${roles.has('tapa')?'base':'tapa'})`)
      return
    }
    const qty=Math.max(0,Math.floor(num(row.qty)))
    for(let unit=0;unit<qty;unit++){
      const kitId=`kit-${uid()}`
      const parts=[]
      components.forEach((c,i)=>{
        const copies=Math.max(1,Math.floor(num(c.qtyPerUnit,1)))
        for(let n=0;n<copies;n++){
          const width=num(c.sourceWidthCm||c.widthCm),height=num(c.sourceHeightCm||c.heightCm)
          if(!width||!height)continue
          parts.push({
            id:uid(),instanceId:`${kitId}-${c.id}-${n}`,kitId,kitIndex:unit,
            svgId:c.id,productId:product?.id||c.productId,figure:row.figure,
            name:`${row.figure} · ${c.role||'pieza'}`,role:c.role||'simple',
            width,height,sourceWidth:width,sourceHeight:height,sizeLocked:true,qty:1,
            unitWeight:1/components.reduce((a,x)=>a+Math.max(1,Math.floor(num(x.qtyPerUnit,1))),0),
            svgText:c.svgText,svgMeta:parseSvg(c.svgText),allowRotate:c.allowRotate!==false,
            blockInterior:c.blockInterior!==false,color:COLORS[i%COLORS.length],
            priority,dueDate:date||'',source
          })
        }
      })
      if(parts.length)kits.push({kitId,figure:row.figure,priority,date:date||'',source,parts})
    }
  })
  return {kits,missing}
}



function solidifyConnectedComponents(mask,w,h){
  const seen=new Uint8Array(mask.length)
  const out=mask.slice()
  const qx=new Int32Array(mask.length),qy=new Int32Array(mask.length)

  for(let sy=0;sy<h;sy++)for(let sx=0;sx<w;sx++){
    const start=sy*w+sx
    if(!mask[start]||seen[start])continue

    let head=0,tail=0
    qx[tail]=sx;qy[tail]=sy;tail++;seen[start]=1
    const rows=new Map()

    while(head<tail){
      const x=qx[head],y=qy[head];head++
      const prev=rows.get(y)
      if(!prev)rows.set(y,[x,x])
      else{if(x<prev[0])prev[0]=x;if(x>prev[1])prev[1]=x}

      const neighbors=[[x-1,y],[x+1,y],[x,y-1],[x,y+1],[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]]
      for(const [nx,ny] of neighbors){
        if(nx<0||ny<0||nx>=w||ny>=h)continue
        const ni=ny*w+nx
        if(mask[ni]&&!seen[ni]){
          seen[ni]=1
          qx[tail]=nx;qy[tail]=ny;tail++
        }
      }
    }

    // Solidifica cada componente por filas. Esto cierra la silueta exterior de
    // personajes/figuras aunque el SVG tenga pequeños huecos en el trazo, sin
    // unir componentes independientes como letras separadas.
    for(const [y,[minX,maxX]] of rows){
      for(let x=minX;x<=maxX;x++)out[y*w+x]=1
    }
  }
  return out
}


function convexHullMask(mask,w,h){
  // Extrae puntos del borde de toda la silueta y crea una envolvente convexa.
  // Es conservadora: jamás permite que otra pieza atraviese una zona ocupada
  // entre trazos separados del mismo componente.
  const pts=[]
  const step=Math.max(1,Math.floor(Math.min(w,h)/80))
  for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){
    if(!mask[y*w+x])continue
    const edge=x===0||y===0||x===w-1||y===h-1||
      !mask[y*w+x-1]||!mask[y*w+x+1]||!mask[(y-1)*w+x]||!mask[(y+1)*w+x]
    if(edge)pts.push([x,y])
  }
  if(pts.length<3)return mask
  pts.sort((a,b)=>a[0]-b[0]||a[1]-b[1])
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
  const lower=[]
  for(const pt of pts){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],pt)<=0)lower.pop();lower.push(pt)}
  const upper=[]
  for(let i=pts.length-1;i>=0;i--){const pt=pts[i];while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],pt)<=0)upper.pop();upper.push(pt)}
  const hull=lower.slice(0,-1).concat(upper.slice(0,-1))
  if(hull.length<3)return mask

  const out=new Uint8Array(w*h)
  // Scanline polygon fill.
  for(let y=0;y<h;y++){
    const xs=[]
    for(let i=0,j=hull.length-1;i<hull.length;j=i++){
      const [xi,yi]=hull[i],[xj,yj]=hull[j]
      if((yi>y)!==(yj>y)){
        const x=xi+(y-yi)*(xj-xi)/(yj-yi)
        xs.push(x)
      }
    }
    xs.sort((a,b)=>a-b)
    for(let k=0;k+1<xs.length;k+=2){
      const a=Math.max(0,Math.floor(xs[k])),b=Math.min(w-1,Math.ceil(xs[k+1]))
      for(let x=a;x<=b;x++)out[y*w+x]=1
    }
  }
  return out
}

const angleMaskCache=new Map()
function cacheAngleMask(key,value){
  if(angleMaskCache.size>900){
    const first=angleMaskCache.keys().next().value
    if(first)angleMaskCache.delete(first)
  }
  return cacheAngleMask(key,value)
}
async function makeAngleMask(part,angle=0,gapCm=0){
  const normalized=((num(angle)%360)+360)%360
  const key=`${part.svgId||part.id}|${normalized}|${num(gapCm)}|${part.blockInterior!==false?'1':'0'}`
  if(angleMaskCache.has(key))return angleMaskCache.get(key)

  const srcW=Math.max(.1,num(part.width)),srcH=Math.max(.1,num(part.height))
  const rad=normalized*Math.PI/180,c=Math.cos(rad),sn=Math.sin(rad)
  const corners=[[0,0],[srcW,0],[0,srcH],[srcW,srcH]].map(([x,y])=>[x*c-y*sn,x*sn+y*c])
  const minX=Math.min(...corners.map(q=>q[0])),maxX=Math.max(...corners.map(q=>q[0]))
  const minY=Math.min(...corners.map(q=>q[1])),maxY=Math.max(...corners.map(q=>q[1]))
  const boxW=maxX-minX,boxH=maxY-minY
  const pad=Math.ceil(Math.max(0,num(gapCm))*PX_PER_CM/2)
  const pw=Math.max(1,Math.ceil(boxW*PX_PER_CM))+pad*2
  const ph=Math.max(1,Math.ceil(boxH*PX_PER_CM))+pad*2
  const canvas=document.createElement('canvas');canvas.width=pw;canvas.height=ph
  const ctx=canvas.getContext('2d',{willReadFrequently:true})
  ctx.fillStyle='#000'

  if(part.svgText){
    const doc=new DOMParser().parseFromString(part.svgText,'image/svg+xml'),svg=doc.documentElement
    if(part.blockInterior!==false){
      svg.querySelectorAll('path,polygon,polyline,circle,ellipse,rect').forEach(el=>{
        el.setAttribute('fill','#000');el.setAttribute('stroke','#000')
      })
    }
    const im=await loadImage(svgDataUrl(new XMLSerializer().serializeToString(svg)))
    ctx.save()
    ctx.translate(pad-minX*PX_PER_CM,pad-minY*PX_PER_CM)
    ctx.rotate(rad)
    ctx.drawImage(im,0,0,srcW*PX_PER_CM,srcH*PX_PER_CM)
    ctx.restore()
  }else{
    ctx.fillRect(pad,pad,Math.ceil(boxW*PX_PER_CM),Math.ceil(boxH*PX_PER_CM))
  }

  const alpha=ctx.getImageData(0,0,pw,ph).data
  let mask=new Uint8Array(pw*ph)
  for(let i=0;i<mask.length;i++)if(alpha[i*4+3]>20)mask[i]=1
  if(part.blockInterior!==false){
    mask=solidifyConnectedComponents(mask,pw,ph)
    mask=fillClosedHoles(mask,pw,ph)
  }

  // Dilatación de la separación mínima.
  if(pad){
    const d=new Uint8Array(mask.length)
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++)if(mask[y*pw+x]){
      for(let dy=-pad;dy<=pad;dy++)for(let dx=-pad;dx<=pad;dx++){
        if(dx*dx+dy*dy>pad*pad)continue
        const xx=x+dx,yy=y+dy
        if(xx>=0&&xx<pw&&yy>=0&&yy<ph)d[yy*pw+xx]=1
      }
    }
    mask=d
  }

  const value={mask,pw,ph,angle:normalized,boxW,boxH,pad,minX,minY,srcW,srcH}
  angleMaskCache.set(key,value)
  return value
}

const precisionMaskCache=new Map()
async function makePrecisionMask(part,angle=0,gapCm=0,scale=VERIFY_PX_PER_CM){
  const normalized=((num(angle)%360)+360)%360
  const key=`${part.svgId||part.id}|${normalized}|${num(gapCm)}|${scale}|precision`
  if(precisionMaskCache.has(key))return precisionMaskCache.get(key)
  const srcW=Math.max(.1,num(part.sourceWidth||part.width)),srcH=Math.max(.1,num(part.sourceHeight||part.height))
  const rad=normalized*Math.PI/180,c=Math.cos(rad),sn=Math.sin(rad)
  const corners=[[0,0],[srcW,0],[0,srcH],[srcW,srcH]].map(([x,y])=>[x*c-y*sn,x*sn+y*c])
  const minX=Math.min(...corners.map(q=>q[0])),maxX=Math.max(...corners.map(q=>q[0]))
  const minY=Math.min(...corners.map(q=>q[1])),maxY=Math.max(...corners.map(q=>q[1]))
  const boxW=maxX-minX,boxH=maxY-minY
  const pad=Math.ceil(Math.max(0,num(gapCm))*scale/2)
  const pw=Math.max(1,Math.ceil(boxW*scale))+pad*2,ph=Math.max(1,Math.ceil(boxH*scale))+pad*2
  const canvas=document.createElement('canvas');canvas.width=pw;canvas.height=ph
  const ctx=canvas.getContext('2d',{willReadFrequently:true})
  if(part.svgText){
    const doc=new DOMParser().parseFromString(part.svgText,'image/svg+xml'),svg=doc.documentElement
    if(part.blockInterior!==false)svg.querySelectorAll('path,polygon,polyline,circle,ellipse,rect').forEach(el=>{el.setAttribute('fill','#000');el.setAttribute('stroke','#000')})
    const im=await loadImage(svgDataUrl(new XMLSerializer().serializeToString(svg)))
    ctx.save();ctx.translate(pad-minX*scale,pad-minY*scale);ctx.rotate(rad);ctx.drawImage(im,0,0,srcW*scale,srcH*scale);ctx.restore()
  }else ctx.fillRect(pad,pad,Math.ceil(boxW*scale),Math.ceil(boxH*scale))
  const alpha=ctx.getImageData(0,0,pw,ph).data
  let mask=new Uint8Array(pw*ph)
  for(let i=0;i<mask.length;i++)if(alpha[i*4+3]>18)mask[i]=1
  if(part.blockInterior!==false){mask=solidifyConnectedComponents(mask,pw,ph);mask=fillClosedHoles(mask,pw,ph)}
  if(pad){
    const d=new Uint8Array(mask.length)
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++)if(mask[y*pw+x]){
      for(let dy=-pad;dy<=pad;dy++)for(let dx=-pad;dx<=pad;dx++){
        if(dx*dx+dy*dy>pad*pad)continue
        const xx=x+dx,yy=y+dy
        if(xx>=0&&xx<pw&&yy>=0&&yy<ph)d[yy*pw+xx]=1
      }
    }
    mask=d
  }
  const value={mask,pw,ph,pad,boxW,boxH,angle:normalized}
  if(precisionMaskCache.size>500)precisionMaskCache.clear()
  precisionMaskCache.set(key,value)
  return value
}

async function precisionValidateSheet(sheet,wCm,hCm,gapCm){
  const scale=VERIFY_PX_PER_CM,sw=Math.floor(wCm*scale),sh=Math.floor(hCm*scale)
  const occ=new Uint8Array(sw*sh),materialOcc=new Uint8Array(sw*sh)
  const collides=(grid,m,x,y)=>{
    if(x<0||y<0||x+m.pw>sw||y+m.ph>sh)return true
    for(let my=0;my<m.ph;my++){const mo=my*m.pw,go=(y+my)*sw+x;for(let mx=0;mx<m.pw;mx++)if(m.mask[mo+mx]&&grid[go+mx])return true}
    return false
  }
  const stamp=(grid,m,x,y)=>{for(let my=0;my<m.ph;my++){const mo=my*m.pw,go=(y+my)*sw+x;for(let mx=0;mx<m.pw;mx++)if(m.mask[mo+mx])grid[go+mx]=1}}
  for(const piece of sheet?.placed||[]){
    const angle=num(piece.angle,piece.rotated?90:0)
    const safe=await makePrecisionMask(piece,angle,Math.max(.20,num(gapCm)),scale)
    const x=Math.round(num(piece.x)*scale-safe.pad),y=Math.round(num(piece.y)*scale-safe.pad)
    if(collides(occ,safe,x,y))return {ok:false,collision:piece.name,usage:0,materialArea:0}
    stamp(occ,safe,x,y)
    const raw=await makePrecisionMask(piece,angle,0,scale)
    const rx=Math.round(num(piece.x)*scale),ry=Math.round(num(piece.y)*scale)
    if(rx>=0&&ry>=0&&rx+raw.pw<=sw&&ry+raw.ph<=sh)stamp(materialOcc,raw,rx,ry)
  }
  let pixels=0
  for(let i=0;i<materialOcc.length;i++)if(materialOcc[i])pixels++
  const materialArea=pixels/(scale*scale),usage=Math.min(100,100*materialArea/(wCm*hCm))
  return {ok:true,collision:null,usage,materialArea}
}

function seededShuffle(array,seed=1){
  const out=array.slice();let x=(seed|0)||1
  const rnd=()=>{x=(x*1664525+1013904223)|0;return (x>>>0)/4294967296}
  for(let i=out.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[out[i],out[j]]=[out[j],out[i]]}
  return out
}
async function packCompleteKits(kits,wCm,hCm,gap,{
  target=10,targetEfficiency=90,angleStep=15,deadline=Infinity,onProgress=null,shouldStop=null,
  orderMode='areaDesc',scoreMode='compact',scanStep=3,shuffleSeed=0
}={}){
  const requestedGap=Math.max(num(gap),.20)
  // Margen anti-redondeo: la búsqueda usa 0,4 mm extra porque trabaja a 10 px/cm
  // y la validación fina a 14 px/cm. El validador sigue exigiendo EXACTAMENTE
  // requestedGap; esto evita falsos rechazos por rasterización sin reducir seguridad.
  const safeGap=requestedGap+.04
  const sw=Math.floor(wCm*PX_PER_CM),sh=Math.floor(hCm*PX_PER_CM)
  const sheetArea=wCm*hCm

  function maskCollides(occ,m,x,y){
    if(x<0||y<0||x+m.pw>sw||y+m.ph>sh)return true
    for(let my=0;my<m.ph;my++){
      const mo=my*m.pw,oo=(y+my)*sw+x
      for(let mx=0;mx<m.pw;mx++)if(m.mask[mo+mx]&&occ[oo+mx])return true
    }
    return false
  }
  function maskStamp(occ,m,x,y){
    for(let my=0;my<m.ph;my++){
      const mo=my*m.pw,oo=(y+my)*sw+x
      for(let mx=0;mx<m.pw;mx++)if(m.mask[mo+mx])occ[oo+mx]=1
    }
  }
  function occupiedAreaCm2(occ){
    let pixels=0
    for(let i=0;i<occ.length;i++)if(occ[i])pixels++
    return pixels/(PX_PER_CM*PX_PER_CM)
  }
  function boxOverlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y}
  function collisionHybrid(state,m,x,y){
    if(x<0||y<0||x+m.pw>sw||y+m.ph>sh)return true
    const candidate={x,y,w:m.pw,h:m.ph}
    if(!state.boxes.some(b=>boxOverlap(candidate,b)))return false
    return maskCollides(state.occ,m,x,y)
  }

  function candidatePoints(state,m){
    const pts=[[0,0],[sw-m.pw,0],[0,sh-m.ph],[sw-m.pw,sh-m.ph]]
    state.boxes.forEach(r=>{
      pts.push(
        [r.x+r.w,r.y],[r.x-m.pw,r.y],[r.x,r.y+r.h],[r.x,r.y-m.ph],
        [r.x+r.w,r.y+r.h-m.ph],[r.x+r.w-m.pw,r.y+r.h],
        [r.x+r.w-m.pw/2,r.y],[r.x-m.pw/2,r.y+r.h],
        [r.x+r.w/2-m.pw/2,r.y+r.h],[r.x+r.w,r.y+r.h/2-m.ph/2]
      )
    })
    const seen=new Set()
    return pts.map(([x,y])=>[Math.round(x),Math.round(y)])
      .filter(([x,y])=>x>=0&&y>=0&&x+m.pw<=sw&&y+m.ph<=sh)
      .filter(([x,y])=>{const k=`${x}|${y}`;if(seen.has(k))return false;seen.add(k);return true})
  }

  async function variantsFor(part){
    const step=Math.max(5,Math.min(45,Number(angleStep)||15))
    const angles=part.allowRotate===false?[0]:Array.from({length:Math.floor(360/step)},(_,i)=>i*step)
    const out=[]
    for(const angle of angles){
      if(Date.now()>=deadline||shouldStop?.())break
      out.push(await makeAngleMask(part,angle,safeGap))
    }
    return out
  }

  function placementScore(state,m,x,y){
    const maxX=Math.max(x+m.pw,...state.boxes.map(r=>r.x+r.w),0)
    const maxY=Math.max(y+m.ph,...state.boxes.map(r=>r.y+r.h),0)
    const envelope=maxX*maxY
    const edgeWaste=(sw-maxX)+(sh-maxY)
    let contacts=0
    const probe=2
    if(x<=probe||y<=probe||x+m.pw>=sw-probe||y+m.ph>=sh-probe)contacts+=2
    state.boxes.forEach(r=>{
      if(Math.abs(x-(r.x+r.w))<=probe||Math.abs(x+m.pw-r.x)<=probe)contacts++
      if(Math.abs(y-(r.y+r.h))<=probe||Math.abs(y+m.ph-r.y)<=probe)contacts++
    })
    if(scoreMode==='bottomLeft')return y*sw+x-contacts*500
    if(scoreMode==='contact')return envelope*1000-contacts*15000+y*20+x
    if(scoreMode==='balanced')return envelope*5000+Math.abs(maxX/sw-maxY/sh)*50000-contacts*7000+y*30+x
    if(scoreMode==='rightFill')return (sh-maxY)*5000+Math.abs(sw-maxX)*1000-contacts*5000+y*10+x
    return envelope*10000+edgeWaste*30-contacts*6000+y*20+x
  }

  function stateEnvelopeScore(state){
    const maxX=Math.max(...state.boxes.map(r=>r.x+r.w),0)
    const maxY=Math.max(...state.boxes.map(r=>r.y+r.h),0)
    const area=maxX*maxY
    const balance=Math.abs(maxX/Math.max(1,sw)-maxY/Math.max(1,sh))
    return area*1000+balance*25000
  }

  async function placementCandidates(state,part,limit=8){
    if(Date.now()>=deadline||shouldStop?.())return []
    const variants=await variantsFor(part)
    const found=[]
    const push=(m,x,y)=>{
      if(collisionHybrid(state,m,x,y))return
      const score=placementScore(state,m,x,y)
      found.push({m,x,y,score})
    }
    for(const m of variants){
      for(const [x,y] of candidatePoints(state,m))push(m,x,y)
      if(found.length<limit*3&&scanStep>0){
        const step=Math.max(1,Math.floor(scanStep))
        for(let y=0;y<=sh-m.ph;y+=step){
          for(let x=0;x<=sw-m.pw;x+=step)push(m,x,y)
          if(y%18===0){
            if(Date.now()>=deadline||shouldStop?.())break
            await nextFrame()
          }
        }
      }
      if(Date.now()>=deadline||shouldStop?.())break
    }
    found.sort((a,b)=>a.score-b.score)
    const out=[],seen=new Set()
    for(const z of found){
      const key=`${z.m.angle}|${z.x}|${z.y}`
      if(seen.has(key))continue
      seen.add(key);out.push(z)
      if(out.length>=limit)break
    }
    return out
  }

  function applyPlacement(state,part,z){
    const next={occ:state.occ.slice(),boxes:state.boxes.map(r=>({...r})),placed:state.placed.slice()}
    maskStamp(next.occ,z.m,z.x,z.y)
    next.boxes.push({x:z.x,y:z.y,w:z.m.pw,h:z.m.ph})
    next.placed.push({...part,x:(z.x+z.m.pad)/PX_PER_CM,y:(z.y+z.m.pad)/PX_PER_CM,
      w:z.m.boxW,h:z.m.boxH,angle:z.m.angle,rotated:z.m.angle!==0,
      _mx:z.x,_my:z.y,_pw:z.m.pw,_ph:z.m.ph})
    return next
  }

  async function tryKit(state,kit){
    // Beam search local: no elegir a ciegas la primera ubicación de la tapa/base.
    // Conserva varias alternativas hasta haber colocado el kit COMPLETO.
    let parts=kit.parts.slice()
    if(orderMode==='smallPartsFirst')parts.sort((a,b)=>num(a.width)*num(a.height)-num(b.width)*num(b.height))
    else parts.sort((a,b)=>num(b.width)*num(b.height)-num(a.width)*num(a.height))

    let beam=[{occ:state.occ.slice(),boxes:state.boxes.map(r=>({...r})),placed:state.placed.slice()}]
    const beamWidth=parts.length<=2?7:4
    for(const part of parts){
      if(Date.now()>=deadline||shouldStop?.())return false
      const nextBeam=[]
      for(const branch of beam){
        const candidates=await placementCandidates(branch,part,beamWidth+3)
        for(const z of candidates)nextBeam.push(applyPlacement(branch,part,z))
        if(Date.now()>=deadline||shouldStop?.())break
      }
      if(!nextBeam.length)return false
      nextBeam.sort((a,b)=>stateEnvelopeScore(a)-stateEnvelopeScore(b))
      beam=nextBeam.slice(0,beamWidth)
    }
    const winner=beam[0]
    state.occ=winner.occ;state.boxes=winner.boxes;state.placed=winner.placed
    return true
  }

  const kitArea=k=>k.parts.reduce((a,p)=>a+num(p.width)*num(p.height),0)
  const kitAspect=k=>{
    const a=k.parts.reduce((sum,p)=>sum+Math.max(num(p.width),num(p.height))/Math.max(.01,Math.min(num(p.width),num(p.height))),0)
    return a/Math.max(1,k.parts.length)
  }
  const priority=(a,b)=>num(a.priority,999999)-num(b.priority,999999)||String(a.date).localeCompare(String(b.date))
  let ordered=kits.slice().sort((a,b)=>{
    const p=priority(a,b);if(p)return p
    if(orderMode==='areaAsc')return kitArea(a)-kitArea(b)
    if(orderMode==='aspect')return kitAspect(b)-kitAspect(a)||kitArea(b)-kitArea(a)
    if(orderMode==='nameMix')return String(a.figure).localeCompare(String(b.figure),'es')||kitArea(b)-kitArea(a)
    if(orderMode==='smallPartsFirst')return kitArea(a)-kitArea(b)
    return kitArea(b)-kitArea(a)
  })
  if(shuffleSeed){
    const groups=[]
    ordered.forEach(k=>{
      const key=`${num(k.priority,999999)}|${k.date||''}`
      let g=groups.find(x=>x.key===key)
      if(!g){g={key,items:[]};groups.push(g)}
      g.items.push(k)
    })
    ordered=groups.flatMap((g,i)=>seededShuffle(g.items,shuffleSeed+i*97))
  }

  const state={occ:new Uint8Array(sw*sh),boxes:[],placed:[]},skipped=[]
  for(let i=0;i<ordered.length;i++){
    if(Date.now()>=deadline||shouldStop?.())break
    if(!await tryKit(state,ordered[i]))skipped.push(ordered[i])
    const used=occupiedAreaCm2(state.occ)
    const partial={number:1,placed:state.placed,used,efficiency:sheetArea?Math.min(100,100*used/sheetArea):0}
    onProgress?.({done:i+1,total:ordered.length,completeFigures:kitCountOnSheet(partial),efficiency:partial.efficiency,sheet:partial,
      strategy:{angleStep,orderMode,scoreMode,scanStep,shuffleSeed}})
    if(i%2===0)await nextFrame()
  }

  const used=occupiedAreaCm2(state.occ)
  const efficiency=sheetArea?Math.min(100,100*used/sheetArea):0
  const sheet={number:1,placed:state.placed,used,efficiency}
  const completeFigures=kitCountOnSheet(sheet)
  if(!sheet.placed.length)return {sheets:[],rejected:kits,total:0,sheetArea,used:0,completeFigures:0,target}

  // Verificación independiente, usando exactamente la misma geometría de cada pieza.
  const verifyOcc=new Uint8Array(sw*sh)
  for(const piece of sheet.placed){
    const m=await makeAngleMask(piece,num(piece.angle,0),requestedGap)
    const x=Math.round(num(piece.x)*PX_PER_CM-m.pad),y=Math.round(num(piece.y)*PX_PER_CM-m.pad)
    if(maskCollides(verifyOcc,m,x,y))throw new Error(`Seguridad de placa: superposición detectada en ${piece.name}.`)
    maskStamp(verifyOcc,m,x,y)
  }

  sheet.placed=sheet.placed.map(({_mx,_my,_pw,_ph,...piece})=>piece)
  return {sheets:[sheet],rejected:skipped,total:sheet.placed.length,sheetArea,used,completeFigures,target,targetEfficiency,
    strategy:{angleStep,orderMode,scoreMode,scanStep,shuffleSeed}}
}

function localKitArea(k){
  return (k?.parts||[]).reduce((sum,p)=>sum+num(p.width||p.sourceWidth)*num(p.height||p.sourceHeight),0)
}
function stableSubsetVariants(kits,target){
  const n=Math.max(1,Math.min(Number(target)||1,kits.length)),window=kits.slice(0,Math.min(kits.length,28))
  const out=[],seen=new Set()
  const add=(label,arr)=>{
    const rows=arr.filter(Boolean).slice(0,n)
    if(rows.length!==n)return
    const key=rows.map(k=>k.kitId).sort().join('|')
    if(seen.has(key))return
    seen.add(key);out.push({label,kits:rows})
  }
  add('prioridad estricta',kits.slice(0,n))
  add('compactos',window.slice().sort((a,b)=>localKitArea(a)-localKitArea(b)).slice(0,n))

  // Mantiene la mitad más urgente y usa piezas compactas para completar.
  const keep=Math.min(Math.max(3,Math.floor(n/2)),n)
  const urgent=kits.slice(0,keep)
  const rest=window.slice(keep).sort((a,b)=>localKitArea(a)-localKitArea(b))
  add('urgentes + compactos',[...urgent,...rest].slice(0,n))

  // Intercambios controlados de las figuras más voluminosas del prefijo.
  const base=kits.slice(0,n),extras=kits.slice(n,Math.min(kits.length,n+12))
  const removable=base.map((k,i)=>({i,area:localKitArea(k)})).sort((a,b)=>b.area-a.area).slice(0,5)
  extras.slice(0,8).forEach((extra,ei)=>{
    removable.slice(0,4).forEach(({i})=>{
      const v=base.slice();v[i]=extra;add(`intercambio ${ei+1}.${i+1}`,v)
    })
  })

  // Variantes deterministas que mezclan la ventana completa sin depender del azar del navegador.
  ;[17,31,47,73,101,131].forEach(seed=>{
    const v=seededShuffle(window,seed)
    // Reinyecta 3 urgentes al frente para no perder la lógica de producción.
    const first=kits.slice(0,Math.min(3,n)),ids=new Set(first.map(k=>k.kitId))
    add(`mezcla ${seed}`,[...first,...v.filter(k=>!ids.has(k.kitId))])
  })
  return out.slice(0,22)
}

async function runSparrowStable(kits,wCm,hCm,gapCm,{
  target=10,targetEfficiency=80,deadlineMs=90000,onProgress=null,shouldStop=null
}={}){
  const started=Date.now(),deadline=started+deadlineMs
  let best=null,tested=0,attempts=[]
  const better=(a,b)=>!b||Number(a.completeFigures||0)>Number(b.completeFigures||0)||(
    Number(a.completeFigures||0)===Number(b.completeFigures||0)&&Number(a.validation?.usage||0)>Number(b.validation?.usage||0)
  )
  async function tryVariant(variant,wanted,seed){
    if(Date.now()>=deadline||shouldStop?.())return null
    tested++
    const remain=Math.max(5,Math.floor((deadline-Date.now())/1000))
    const seconds=Math.max(5,Math.min(wanted<=10?16:11,remain))
    onProgress?.({stage:`Sparrow WASM · ${wanted} figuras · ${variant.label}`,percent:Math.min(92,7+tested*7),completeFigures:Number(best?.completeFigures||0),efficiency:Number(best?.validation?.usage||0)})
    try{
      const r=await solveWithSparrow(variant.kits,wCm,hCm,gapCm,{target:wanted,timeLimit:seconds,angleStep:10,nWorkers:Math.max(1,Math.min(4,(navigator.hardwareConcurrency||4)-1)),seed,onProgress:()=>{},shouldStop})
      const placed=(r.placements||[]).map(q=>({...q,x:num(q.xCm),y:num(q.yCm),angle:num(q.angle),rotated:Math.abs(num(q.angle)%360)>.001,w:num(q.sourceWidth||q.width),h:num(q.sourceHeight||q.height),industrial:false,sparrow:true}))
      const sheet={number:1,placed}
      const validation=await precisionValidateSheet(sheet,wCm,hCm,Math.max(.30,num(gapCm,.3)))
      const completeFigures=kitCountOnSheet(sheet)
      attempts.push({engine:'sparrow',label:variant.label,target:wanted,seed,completeFigures,usage:Number(validation.usage||0),valid:!!validation.ok,collision:validation.collision||null,usedWidthMm:Number(r.usedWidthMm||0)})
      const candidate={sheets:[sheet],rejected:[],completeFigures,validation,attempts,tested,engine:r.engine||'Sparrow WASM + jagua-rs'}
      if(validation.ok&&better(candidate,best))best=candidate
      return candidate
    }catch(err){attempts.push({engine:'sparrow',label:variant.label,target:wanted,seed,error:String(err?.message||err),valid:false});return null}
  }

  const wanted=Math.min(Math.max(1,Number(target)||10),kits.length)
  const variants=stableSubsetVariants(kits,wanted).slice(0,6)
  for(const variant of variants){
    for(const seed of [17,47]){
      const r=await tryVariant(variant,wanted,seed)
      if(r?.validation?.ok&&Number(r.completeFigures)>=wanted)break
    }
    if(best&&Number(best.completeFigures)>=wanted)break
  }
  if(!best||Number(best.completeFigures)<wanted)throw new Error(`Sparrow no certificó todavía el mínimo de ${wanted} figuras completas a ${Math.round(gapCm*10)} mm.`)

  for(let grow=wanted+1;grow<=Math.min(kits.length,wanted+5);grow++){
    if(Date.now()>=deadline||shouldStop?.())break
    let improved=false
    for(const variant of stableSubsetVariants(kits,grow).slice(0,3)){
      const r=await tryVariant(variant,grow,17+grow)
      if(r?.validation?.ok&&Number(r.completeFigures)>=grow){improved=true;break}
    }
    if(!improved)break
  }
  return {...best,attempts,tested}
}

async function runStableLocalSolver(kits,wCm,hCm,gapCm,{
  target=10,targetEfficiency=80,deadlineMs=110000,onProgress=null,shouldStop=null
}={}){
  const started=Date.now(),deadline=started+deadlineMs
  let best=null,bestGeometric=null,attempts=[],tested=0
  const rank=r=>[
    Number(r?.completeFigures||0),
    Number(r?.validation?.usage||r?.sheets?.[0]?.efficiency||0),
    -Number(r?.rejected?.length||0)
  ]
  const better=(a,b)=>{
    if(!b)return true
    const A=rank(a),B=rank(b)
    for(let i=0;i<A.length;i++){if(A[i]!==B[i])return A[i]>B[i]}
    return false
  }
  async function attempt(subset,cfg,label){
    if(Date.now()>=deadline||shouldStop?.())return null
    tested++
    onProgress?.({stage:`Motor estable · ${label} · ${cfg.angleStep}°`,percent:Math.min(94,5+tested*3),completeFigures:Number(best?.completeFigures||0),efficiency:Number(best?.validation?.usage||0)})
    try{
      const r=await packCompleteKits(subset,wCm,hCm,gapCm,{
        target:subset.length,targetEfficiency,deadline,shouldStop,
        onProgress:p=>onProgress?.({stage:`Motor estable · ${label} · ${p.completeFigures||0}/${subset.length}`,percent:Math.min(94,5+tested*3),completeFigures:Number(Math.max(best?.completeFigures||0,p.completeFigures||0)),efficiency:Number(p.efficiency||0)}),
        ...cfg
      })
      const sheet=r?.sheets?.[0]
      if(!sheet?.placed?.length)return null
      const validation=await precisionValidateSheet(sheet,wCm,hCm,Math.max(.25,num(gapCm,.3)))
      const completeFigures=kitCountOnSheet(sheet)
      const candidate={...r,completeFigures,validation,subsetLabel:label}
      attempts.push({label,angleStep:cfg.angleStep,orderMode:cfg.orderMode,scoreMode:cfg.scoreMode,completeFigures,usage:Number(validation.usage||0),valid:!!validation.ok,validationCollision:validation.collision||null})
      if(!bestGeometric||Number(completeFigures)>Number(bestGeometric.completeFigures||0))bestGeometric=candidate
      if(validation.ok&&better(candidate,best))best=candidate
      return candidate
    }catch(err){attempts.push({label,error:String(err?.message||err),completeFigures:0,valid:false});return null}
  }

  const wanted=Math.min(Math.max(1,Number(target)||10),kits.length)
  const configs=[
    {angleStep:15,orderMode:'areaDesc',scoreMode:'compact',scanStep:3,shuffleSeed:0},
    {angleStep:10,orderMode:'areaDesc',scoreMode:'balanced',scanStep:3,shuffleSeed:0},
    {angleStep:10,orderMode:'aspect',scoreMode:'contact',scanStep:3,shuffleSeed:0},
    {angleStep:15,orderMode:'smallPartsFirst',scoreMode:'contact',scanStep:3,shuffleSeed:0},
    {angleStep:10,orderMode:'areaDesc',scoreMode:'compact',scanStep:2,shuffleSeed:17},
    {angleStep:5,orderMode:'areaDesc',scoreMode:'contact',scanStep:3,shuffleSeed:31}
  ]

  // FASE 1: no bajar de 10 sin probar combinaciones distintas de 10 kits completos.
  for(const variant of stableSubsetVariants(kits,wanted)){
    if(Date.now()>=deadline||shouldStop?.())break
    for(const cfg of configs){
      const r=await attempt(variant.kits,cfg,`${wanted} figuras · ${variant.label}`)
      if(r?.validation?.ok&&Number(r.completeFigures)>=wanted)break
    }
    if(best&&Number(best.completeFigures)>=wanted)break
  }

  // FASE 2: si 10 entra, crecer 11, 12, 13... con la misma lógica.
  if(best&&Number(best.completeFigures)>=wanted){
    for(let grow=wanted+1;grow<=Math.min(kits.length,wanted+6);grow++){
      if(Date.now()>=deadline||shouldStop?.())break
      let improved=false
      for(const variant of stableSubsetVariants(kits,grow).slice(0,8)){
        const r=await attempt(variant.kits,configs[1],`${grow} figuras · ${variant.label}`)
        if(r?.validation?.ok&&Number(r.completeFigures)>=grow){improved=true;break}
      }
      if(!improved)break
    }
  }else{
    // FASE 3: sólo después de agotar 10, buscar el máximo seguro inferior.
    for(let lower=wanted-1;lower>=1;lower--){
      if(Date.now()>=deadline||shouldStop?.())break
      let found=false
      for(const variant of stableSubsetVariants(kits,lower).slice(0,10)){
        const r=await attempt(variant.kits,configs[0],`${lower} figuras · ${variant.label}`)
        if(r?.validation?.ok&&Number(r.completeFigures)>=lower){found=true;break}
      }
      if(found)break
    }
  }
  if(!best){
    const geo=bestGeometric
    const detail=geo?` Mejor acomodo bruto: ${geo.completeFigures||0} figura(s). Rechazo fino: ${geo.validation?.collision||'separación/borde'}.`:''
    throw new Error(`El motor no pudo certificar una placa con la separación solicitada.${detail}`)
  }
  return {...best,attempts,tested}
}

function usableModelComponents(model){
  const components=(model?.components||[]).filter(Boolean)
  if(!components.length)return {components:[],reason:'sin componentes SVG vinculados'}
  // El planificador nunca modifica tamaños y tampoco bloquea una figura porque
  // tapa y base tengan pequeñas diferencias. Si ambas existen, usa cada SVG
  // exactamente con las medidas que trae guardadas en la Biblioteca SVG.
  return {components,reason:''}
}

function pendingGroupsByDelivery(db){
  return pendingCutByDelivery(db)
}

function bestSellerNames(db){
  const counts={}
  ;(db.orders||[]).filter(o=>o.status!=='Cancelado').forEach(o=>(o.items||[]).forEach(i=>{if(i.figure)counts[i.figure]=(counts[i.figure]||0)+num(i.qty)}))
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([name])=>name)
}

function sheetProductionRows(sheet,multiplier=1){
  const totals={}
  ;(sheet?.placed||[]).forEach(p=>{
    const figure=p.figure||p.name?.split(' · ')[0]||''
    if(!figure)return
    totals[figure]=(totals[figure]||0)+num(p.unitWeight,1)
  })
  return Object.entries(totals).map(([figure,baseQty])=>({figure,baseQty,qty:baseQty*num(multiplier,1)}))
}

export default function SheetPlanner({db,onSave}){
  const [sheetW,setSheetW]=useState(122),[sheetH,setSheetH]=useState(58),[gap,setGap]=useState(.3)
  const [items,setItems]=useState([]),[result,setResult]=useState({sheets:[],rejected:[],total:0,used:0,sheetArea:0}),[active,setActive]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[minFill,setMinFill]=useState(90),[useFillers,setUseFillers]=useState(true),[autoSummary,setAutoSummary]=useState(null),[sheetMultipliers,setSheetMultipliers]=useState({}),[modelSearch,setModelSearch]=useState(''),[modelQty,setModelQty]=useState(1)
  const [calcProgress,setCalcProgress]=useState(null)
  const [bestLive,setBestLive]=useState(null)
  const [optimizerMode,setOptimizerMode]=useState('max')
  const [optimizerStats,setOptimizerStats]=useState({tested:0,improved:0,bestStrategy:null})
  const stopCalcRef=useRef(false)
  const formatDuration=seconds=>{
    if(!Number.isFinite(seconds)||seconds<0)return '—'
    const s=Math.round(seconds),m=Math.floor(s/60),r=s%60
    return m?`${m} min ${String(r).padStart(2,'0')} s`:`${r} s`
  }
  function requestBestCurrent(){stopCalcRef.current=true;setCalcProgress(p=>p?{...p,stage:'Usando mejor resultado encontrado…'}:p)}
  const library=db.svgLibrary||[],products=normalizeCatalogProducts(db.customerCatalog?.length?db.customerCatalog:catalogProducts),pending=pendingCutRows(db).filter(x=>x.pending>0),sheet=result.sheets[active]||result.sheets[0]
  const libraryModels=useMemo(()=>{const map=new Map();library.forEach(c=>{const id=componentModelId(c),name=componentModelName(c);if(!map.has(id))map.set(id,{id,name,productId:c.productId||'',components:[]});map.get(id).components.push(c)});return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'es'))},[library])
  function modelForFigure(figure){const key=normalizedName(figure);const product=products.find(p=>normalizedName(p.name)===key)||products.find(p=>normalizedName(p.name).includes(key)||key.includes(normalizedName(p.name)));const model=libraryModels.find(m=>(product?.id&&m.productId===product.id)||normalizedName(m.name)===key)||libraryModels.find(m=>normalizedName(m.name).includes(key)||key.includes(normalizedName(m.name)));return {product,model}}
  const scale=Math.min(700/num(sheetW,122),420/num(sheetH,58))
  const dirtyKey=useMemo(()=>JSON.stringify([items.map(x=>[x.id,x.qty,x.width,x.height,x.svgId]),sheetW,sheetH,gap]),[items,sheetW,sheetH,gap])
  useEffect(()=>setResult(r=>({...r,stale:true})),[dirtyKey])

  function loadPending(){
    const next=[];const missing=[]
    for(const row of pending){
      const {product,model}=modelForFigure(row.figure)
      const checked=usableModelComponents(model),components=checked.components
      if(!components.length){missing.push(`${row.figure}${checked.reason?` (${checked.reason})`:''}`);continue}
      const totalPerUnit=components.reduce((a,c)=>a+num(c.qtyPerUnit,1),0)||1;components.forEach((c,i)=>{const width=num(c.sourceWidthCm||c.widthCm),height=num(c.sourceHeightCm||c.heightCm);next.push({id:uid(),svgId:c.id,productId:product?.id,figure:row.figure,name:`${row.figure} · ${c.role||'pieza'}`,width,height,sourceWidth:width,sourceHeight:height,sizeLocked:true,qty:row.pending*num(c.qtyPerUnit||1),unitWeight:1/totalPerUnit,svgText:c.svgText,svgMeta:parseSvg(c.svgText),allowRotate:c.allowRotate!==false,blockInterior:c.blockInterior!==false,color:COLORS[i%COLORS.length]})})
    }
    setItems(next);if(missing.length)alert(`Faltan SVG vinculados para: ${missing.join(', ')}`)
  }
  function componentsForRows(rows,priority,date,source='pedido'){
    const next=[],missing=[]
    rows.forEach(row=>{
      const {product,model}=modelForFigure(row.figure)
      const checked=usableModelComponents(model),components=checked.components
      if(!components.length){missing.push(`${row.figure}${checked.reason?` (${checked.reason})`:''}`);return}
      const totalPerUnit=components.reduce((a,c)=>a+num(c.qtyPerUnit,1),0)||1;components.forEach((c,i)=>{const width=num(c.sourceWidthCm||c.widthCm),height=num(c.sourceHeightCm||c.heightCm);next.push({id:uid(),svgId:c.id,productId:product?.id,figure:row.figure,name:`${row.figure} · ${c.role||'pieza'}`,width,height,sourceWidth:width,sourceHeight:height,sizeLocked:true,qty:num(row.qty)*num(c.qtyPerUnit||1),unitWeight:1/totalPerUnit,svgText:c.svgText,svgMeta:parseSvg(c.svgText),allowRotate:c.allowRotate!==false,blockInterior:c.blockInterior!==false,color:COLORS[i%COLORS.length],priority,dueDate:date||'',source})})
    })
    return {items:next,missing}
  }
  async function generateAutomatic(){
    setBusy(true);setError('');setActive(0);setAutoSummary(null);setBestLive(null)
    const started=Date.now()
    let timer=null
    try{
      const groups=pendingGroupsByDelivery(db),kits=[],missing=[]
      groups.forEach((g,index)=>{
        const built=buildCompleteKits(g.rows,index,g.date,'pedido',modelForFigure)
        kits.push(...built.kits);missing.push(...built.missing)
      })
      // Siempre agrega una reserva de modelos de alta rotación. No reemplazan prioridades:
      // sólo dan al motor alternativas para completar una placa rentable cuando los kits urgentes
      // son demasiado grandes o no encastran entre sí.
      if(useFillers){
        const ranking=bestSellerNames(db)
        let ri=0,added=0
        while(added<18&&ranking.length&&ri<ranking.length*6){
          const name=ranking[ri%ranking.length];ri++
          const built=buildCompleteKits([{figure:name,qty:1}],9999,'','relleno',modelForFigure)
          if(built.kits.length){kits.push(...built.kits);added+=built.kits.length}
        }
      }
      if(!kits.length)throw new Error('No hay figuras completas con SVG vinculados para enviar al motor industrial.')

      setCalcProgress({stage:'Motor CNC externo · preparando geometrías…',percent:3,elapsed:0,eta:45,completeFigures:0,efficiency:0})
      timer=setInterval(()=>setCalcProgress(v=>v?{...v,elapsed:(Date.now()-started)/1000,eta:Math.max(0,150-(Date.now()-started)/1000)}:v),1000)

      const payload={
        widthCm:num(sheetW,122),heightCm:num(sheetH,58),gapCm:Math.max(.25,num(gap,.3)),
        targetDensity:80,
        kits:kits.slice(0,32).map(k=>({kitId:k.kitId,figure:k.figure,priority:k.priority,date:k.date,source:k.source,parts:k.parts.map(part=>({
          instanceId:part.instanceId,id:part.id,kitId:part.kitId,figure:part.figure,name:part.name,role:part.role,
          sourceWidthCm:num(part.sourceWidth||part.width),sourceHeightCm:num(part.sourceHeight||part.height),
          allowRotate:part.allowRotate!==false,svgText:part.svgText
        }))}))
      }
      // Motor principal: Sparrow WASM + jagua-rs. El solver local anterior queda
      // únicamente como respaldo si el navegador no habilita memoria WASM compartida.
      let local
      try{
        local=await runSparrowStable(
          kits,num(sheetW,122),num(sheetH,58),Math.max(.30,num(gap,.3)),{
            target:Math.min(10,kits.length),targetEfficiency:Math.min(90,Math.max(80,num(minFill,90))),deadlineMs:90000,
            shouldStop:()=>stopCalcRef.current,
            onProgress:p=>setCalcProgress(v=>({...v,...p,elapsed:(Date.now()-started)/1000,eta:Math.max(0,90-(Date.now()-started)/1000)}))
          }
        )
      }catch(sparrowError){
        if(globalThis.crossOriginIsolated===true&&typeof SharedArrayBuffer!=='undefined')throw sparrowError
        setCalcProgress(v=>({...v,stage:'Sparrow no disponible en este navegador · respaldo local…'}))
        local=await runStableLocalSolver(
          kits,num(sheetW,122),num(sheetH,58),Math.max(.30,num(gap,.3)),{
            target:Math.min(10,kits.length),targetEfficiency:Math.min(90,Math.max(80,num(minFill,90))),deadlineMs:70000,
            shouldStop:()=>stopCalcRef.current,
            onProgress:p=>setCalcProgress(v=>({...v,...p,elapsed:(Date.now()-started)/1000,eta:Math.max(0,70-(Date.now()-started)/1000)}))
          }
        )
      }
      const ls=local.sheets[0],validation=local.validation||{}
      const xs=(ls.placed||[]).map(q=>num(q.x)),ys=(ls.placed||[]).map(q=>num(q.y))
      const x2=(ls.placed||[]).map(q=>num(q.x)+num(q.w)),y2=(ls.placed||[]).map(q=>num(q.y)+num(q.h))
      const usedW=xs.length?Math.max(...x2)-Math.min(...xs):0,usedH=ys.length?Math.max(...y2)-Math.min(...ys):0
      const materialArea=Number(validation.materialArea||ls.used||0)
      const compactness=usedW*usedH>0?Math.min(100,100*materialArea/(usedW*usedH)):0
      const data={
        ok:true,localStable:true,engine:local.engine||'Sparrow WASM + jagua-rs',
        completeFigures:Number(local.completeFigures||kitCountOnSheet(ls)),
        placements:(ls.placed||[]).map(q=>({instanceId:q.instanceId,kitId:q.kitId,figure:q.figure,name:q.name,role:q.role,xCm:num(q.x),yCm:num(q.y),angle:num(q.angle),trimXCm:0,trimYCm:0})),
        density:Number(validation.usage||ls.efficiency||0),compactness,usedWidthMm:usedW*10,usedHeightMm:usedH*10,
        attempts:local.attempts||[],minimumTarget:Math.min(10,kits.length),reachedMinimum:Number(local.completeFigures||0)>=Math.min(10,kits.length),
        reachedDensity:Number(validation.usage||0)>=Math.min(90,Math.max(80,num(minFill,90)))
      }
      const response={ok:true,status:200}
      const placementMap=new Map((data.placements||[]).map(x=>[x.instanceId,x]))
      const sourceParts=new Map()
      kits.forEach(k=>k.parts.forEach(part=>sourceParts.set(part.instanceId,part)))
      const placed=(data.placements||[]).map(pl=>{
        const part=sourceParts.get(pl.instanceId)
        if(!part)return null
        return {...part,x:num(pl.xCm),y:num(pl.yCm),angle:num(pl.angle),rotated:Math.abs(num(pl.angle)%360)>.001,
          industrial:false,localFallback:false,localStable:true,trimXCm:num(pl.trimXCm),trimYCm:num(pl.trimYCm),w:num(part.sourceWidth||part.width),h:num(part.sourceHeight||part.height)}
      }).filter(Boolean)
      if(!placed.length)throw new Error('El motor local terminó sin componentes colocados.')
      const kitIds=new Set(placed.map(x=>x.kitId).filter(Boolean))
      const completeFigures=kitIds.size
      const finalCompactness=Math.max(0,Math.min(100,num(data.compactness)))
      const density=Math.max(0,Math.min(100,num(data.density)))
      const sheetArea=num(sheetW,122)*num(sheetH,58)
      const one={number:1,placed,used:sheetArea*density/100,efficiency:density,groupCompactness:finalCompactness,industrial:true,materialDensity:density,usedWidthCm:num(data.usedWidthMm)/10,usedHeightCm:num(data.usedHeightMm)/10}
      const reachedMinimum=completeFigures>=Number(data.minimumTarget||10)
      const finalResult={sheets:[one],rejected:[],total:placed.length,used:one.used,sheetArea,stale:false,automatic:true,industrial:true,precisionValidated:true,productionMinimumValidated:reachedMinimum,
        threshold:num(minFill,90),fillers:[],materialDensity:density,engine:data.engine||'PackingSolver C++',attempts:data.attempts||[]}
      setItems(placed.map(x=>({...x,qty:1})));setResult(finalResult)
      setAutoSummary({groups,missing:[...new Set(missing)],fillers:[],complete:1,waiting:0,threshold:num(minFill,90),rejected:0,completeFigures,targetComplete:Number(data.minimumTarget||10),targetEfficiency:num(minFill,90),partial:!reachedMinimum})
      setOptimizerStats({tested:(data.attempts||[]).length,improved:1,bestStrategy:'Motor Polifan v23 · subconjuntos completos'})
      setCalcProgress({stage:`Finalizado · ${data.engine||'PackingSolver C++'}`,percent:100,elapsed:(Date.now()-started)/1000,eta:0,completeFigures,efficiency:finalCompactness})

    }catch(e){
      const msg=e?.message||'No se pudo generar una placa válida con el motor estable.'
      setError(msg);setCalcProgress(null);setResult({sheets:[],rejected:[],total:0,used:0,sheetArea:0})
    }finally{
      if(timer)clearInterval(timer)
      setBusy(false);stopCalcRef.current=false
    }
  }
  function addModelByName(){
    const wanted=String(modelSearch||'').trim().toLowerCase()
    const model=libraryModels.find(m=>m.name.toLowerCase()===wanted)||libraryModels.find(m=>m.name.toLowerCase().includes(wanted))
    if(!model)return alert('No encontré esa figura en la Biblioteca SVG.')
    const qty=Math.max(1,Math.floor(num(modelQty,1))),checked=usableModelComponents(model),components=checked.components.filter(c=>['tapa','base','simple','capa'].includes(c.role||'simple'))
    if(!components.length)return alert(checked.reason||'La figura no tiene componentes SVG.')
    const totalPerUnit=components.reduce((a,c)=>a+num(c.qtyPerUnit,1),0)||1
    const additions=components.map((c,i)=>{const width=num(c.sourceWidthCm||c.widthCm),height=num(c.sourceHeightCm||c.heightCm);return {id:uid(),svgId:c.id,modelId:model.id,productId:c.productId||model.productId,figure:model.name,name:`${model.name} · ${c.role||'pieza'}`,width,height,sourceWidth:width,sourceHeight:height,sizeLocked:true,qty:qty*num(c.qtyPerUnit||1),unitWeight:1/totalPerUnit,svgText:c.svgText,svgMeta:parseSvg(c.svgText),allowRotate:c.allowRotate!==false,blockInterior:c.blockInterior!==false,color:COLORS[(items.length+i)%COLORS.length]}})
    const invalid=additions.filter(x=>!x.width||!x.height)
    if(invalid.length)return alert('Algún componente no declara medidas físicas válidas en el SVG.')
    setItems(v=>[...v,...additions]);setModelSearch(model.name)
  }
  const update=(id,k,val)=>setItems(v=>v.map(x=>x.id===id?{...x,[k]:val}:x))
  const automaticItemSummary=useMemo(()=>{
    const totals={}
    items.forEach(it=>{
      const key=it.figure||it.name
      if(!totals[key])totals[key]={figure:key,kits:new Set(),parts:0}
      if(it.kitId)totals[key].kits.add(it.kitId)
      totals[key].parts+=num(it.qty,1)
    })
    return Object.values(totals).map(x=>({figure:x.figure,qty:x.kits.size||Math.round(x.parts)}))
  },[items])
  async function generate(){setBusy(true);setError('');setActive(0);try{const invalid=items.filter(x=>!num(x.sourceWidth||x.width)||!num(x.sourceHeight||x.height)||!sameSize(x.width,x.sourceWidth||x.width)||!sameSize(x.height,x.sourceHeight||x.height));if(invalid.length)throw new Error(`Medida alterada o faltante en: ${invalid.map(x=>x.name).join(', ')}. El motor solo acepta la medida exacta del SVG.`);setResult({...await pack(items,num(sheetW),num(sheetH),num(gap),{strictRects:true}),stale:false})}catch(e){setError(e.message||'No se pudo generar')}finally{setBusy(false)}}
  function markup(p){
    const m=p.svgMeta;if(!m)return ''
    const angle=((num(p.angle,p.rotated?90:0)%360)+360)%360
    const srcW=num(p.sourceWidth||p.width),srcH=num(p.sourceHeight||p.height)
    if(p.industrial){
      return `<g transform="translate(${p.x} ${p.y}) rotate(${angle}) translate(${-num(p.trimXCm)} ${-num(p.trimYCm)})"><svg width="${srcW}" height="${srcH}" viewBox="${esc(m.viewBox)}" preserveAspectRatio="none">${m.inner}</svg></g>`
    }
    if(!angle)return `<svg x="${p.x}" y="${p.y}" width="${srcW}" height="${srcH}" viewBox="${esc(m.viewBox)}" preserveAspectRatio="none">${m.inner}</svg>`
    const rad=angle*Math.PI/180,c=Math.cos(rad),sn=Math.sin(rad)
    const corners=[[0,0],[srcW,0],[0,srcH],[srcW,srcH]].map(([x,y])=>[x*c-y*sn,x*sn+y*c])
    const minX=Math.min(...corners.map(q=>q[0])),minY=Math.min(...corners.map(q=>q[1]))
    return `<g transform="translate(${p.x-minX} ${p.y-minY}) rotate(${angle})"><svg width="${srcW}" height="${srcH}" viewBox="${esc(m.viewBox)}" preserveAspectRatio="none">${m.inner}</svg></g>`
  }
  function download(){
    if(!sheet)return
    // La rotación cambia la caja exterior, pero nunca las medidas internas del SVG.
    // Por eso validamos las medidas fuente, no w/h de la caja rotada.
    const invalid=sheet.placed.filter(p=>!num(p.sourceWidth||p.width)||!num(p.sourceHeight||p.height))
    if(invalid.length)return alert(`No se puede exportar: faltan medidas originales en ${invalid.slice(0,5).map(x=>x.name).join(', ')}`)
    const metadata=esc(JSON.stringify({
      empresa:'Tu Vida en Tinta',regla:'medidas exactas del SVG',
      rotacionPermitida:true,rotacionLibre:true,escalaPermitida:false,
      piezas:sheet.placed.map(p=>({
        nombre:p.name,svgId:p.svgId,
        anchoOrigen:p.sourceWidth||p.width,altoOrigen:p.sourceHeight||p.height,
        angulo:num(p.angle,p.rotated?90:0),scaleX:1,scaleY:1
      }))
    }))
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}cm" height="${sheetH}cm" viewBox="0 0 ${sheetW} ${sheetH}"><metadata>${metadata}</metadata>${sheet.placed.map(markup).join('')}</svg>`
    const u=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),a=document.createElement('a')
    a.href=u;a.download=`placa-cnc-${sheet.number}.svg`;a.click();URL.revokeObjectURL(u)
  }
  async function savePlan(){if(!result.sheets.length)return;const plan={id:uid(),date:new Date().toISOString(),status:result.automatic?'Lista automática':'Diseñada',automatic:!!result.automatic,priorityRule:'fecha de salida ascendente',fillThreshold:result.threshold||null,fillers:result.fillers||[],sheetW:num(sheetW),sheetH:num(sheetH),gap:num(gap),sheets:result.sheets.map(s=>({number:s.number,multiplier:num(sheetMultipliers[s.number],1),efficiency:s.efficiency,pieces:s.placed.map(p=>({name:p.name,figure:p.figure,unitWeight:num(p.unitWeight,1),itemId:p.itemId||p.id,svgId:p.svgId,x:p.x,y:p.y,w:p.w,h:p.h,sourceWidth:p.sourceWidth||p.width,sourceHeight:p.sourceHeight||p.height,scaleX:1,scaleY:1,angle:num(p.angle,p.rotated?90:0),rotated:p.rotated}))}))};await onSave({...db,generatedSheets:[...(db.generatedSheets||[]),plan]});alert('Diseño guardado. No se descontaron piezas todavía.')}
  function setMultiplier(number,value){setSheetMultipliers(v=>({...v,[number]:Math.max(1,Math.min(2,Number(value)||1))}))}
  async function sendSheetToCut(){
    if(!sheet)return
    const multiplier=num(sheetMultipliers[sheet.number],1),rows=sheetProductionRows(sheet,multiplier)
    const incomplete=rows.filter(r=>Math.abs(r.qty-Math.round(r.qty))>.001)
    if(incomplete.length)return alert(`Esta placa tiene juegos incompletos de: ${incomplete.map(r=>r.figure).join(', ')}. Agrupá los componentes antes de enviarla a corte.`)
    const items=rows.filter(r=>r.qty>0).map(r=>({figure:r.figure,qty:Math.round(r.baseQty)}))
    if(!items.length)return alert('No se pudieron identificar productos completos en esta placa.')
    const mode=multiplier===2?'doble':'simple'
    if(!confirm(`¿Enviar la placa ${sheet.number} a corte ${mode}? Se reservarán ${items.reduce((a,i)=>a+i.qty*multiplier,0)} unidades.`))return
    const nextNumber=String((Math.max(0,...(db.cutBatches||[]).map(b=>Number(b.number)||0))+1)).padStart(3,'0')
    const batch={id:uid(),number:nextNumber,name:`Diseño automático · Placa ${sheet.number}`,date:new Date().toISOString().slice(0,10),notes:`Generada desde Diseñar placas · corte ${mode}`,status:'En corte',multiplier,sourceSheetNumber:sheet.number,items,createdAt:new Date().toISOString()}
    await onSave({...db,cutBatches:[...(db.cutBatches||[]),batch]})
    alert(`Placa enviada a corte ${mode}. Las cantidades quedaron reservadas y se sumarán al stock al terminar.`)
  }

  return <div className="sheet-planner-page">
    <div className="page-title"><div><h1>Diseñar placas de corte</h1><p>Motor industrial PackingSolver: el cálculo automático se ejecuta con un solver C++ especializado en nesting irregular. React solo muestra el resultado; ya no decide las posiciones.</p></div><div className="title-actions"><button className="ghost" onClick={loadPending}>Cargar manualmente</button><button className="ghost" onClick={generateAutomatic} disabled={busy}>{busy?'Calculando placa…':'Generar 1 placa automática'}</button><button className="primary" onClick={generate} disabled={busy}>{busy?'Calculando…':'Generar selección'}</button></div></div>
    <div className="notice"><b>Escala bloqueada</b><span>Las medidas salen del SVG original. El catálogo solo sirve para reconocer el modelo. Se permite trasladar y rotar libremente en cualquier ángulo; no se permite escalar, deformar ni reflejar. Las diferencias de tapa/base que hayas aceptado manualmente en Biblioteca SVG sí pueden utilizarse, sin cambiar sus medidas.</span></div><div className="notice"><b>Cálculo rápido</b><span>El cálculo automático ya no usa el motor experimental del navegador. PackingSolver trabaja con polígonos no convexos, rotación libre y separación física entre piezas. El botón manual sigue disponible solo para pruebas.</span></div><div className="notice"><b>Cola automática de producción</b><span>Genera una sola placa por vez. Coloca primero las entregas más cercanas y usa el espacio restante con pedidos de fechas siguientes. Lo que no entra queda pendiente para la próxima placa.</span></div>
    {calcProgress&&<section className="panel calc-progress-panel">
      <div className="calc-progress-head"><div><b>{calcProgress.stage}</b><small>{calcProgress.percent}% completado</small></div>{busy&&bestLive?.sheet&&<button className="ghost" onClick={requestBestCurrent}>Usar mejor resultado actual</button>}</div>
      <div className="calc-progress-bar"><span style={{width:`${calcProgress.percent}%`}}/></div>
      <div className="calc-progress-stats">
        <span>⏱ Transcurrido: <b>{formatDuration(calcProgress.elapsed)}</b></span>
        <span>⌛ Restante aprox.: <b>{calcProgress.percent>=100?'0 s':formatDuration(calcProgress.eta)}</b></span>
        <span>✓ Mejor resultado: <b>{calcProgress.completeFigures||0} figuras · {Number(calcProgress.efficiency||0).toFixed(1)}%</b></span>
      </div>
      <div className="ai-optimizer-stats"><span>🧠 Etapa del solver: <b>{calcProgress?.stage||'Preparando…'}</b></span><span>✓ Figuras completas detectadas: <b>{calcProgress?.completeFigures||0}</b></span><span>↻ Paso angular final: <b>{result?.attempts?.find?.(a=>a.stage==='repack-5'&&a.ok)?'5°':'en proceso'}</b></span></div>
      {busy&&<small>El cálculo industrial tiene un límite de 150 segundos. Si no termina, no genera una placa dudosa: informa el error para volver a intentar.</small>}
    </section>}
    <section className="panel planner-settings"><label>Ancho (cm)<input type="number" step=".1" value={sheetW} onChange={e=>setSheetW(e.target.value)}/></label><label>Alto (cm)<input type="number" step=".1" value={sheetH} onChange={e=>setSheetH(e.target.value)}/></label><label>Separación (cm)<input type="number" min=".25" step=".1" value={gap} onChange={e=>setGap(Math.max(.3,num(e.target.value,.3)))}/></label><label>Objetivo de ocupación (%)<input type="number" min="50" max="100" value={minFill} onChange={e=>setMinFill(e.target.value)}/></label><label>Motor automático<select value={optimizerMode} onChange={e=>setOptimizerMode(e.target.value)} disabled={busy}><option value="max">PackingSolver industrial</option></select></label><label className="form-check"><input className="form-check-input" type="checkbox" checked={useFillers} onChange={e=>setUseFillers(e.target.checked)}/><span className="form-check-label">Completar con modelos de alta venta</span></label></section>
    <section className="panel model-picker"><div><label>Buscar figura por nombre<input list="svg-model-options" value={modelSearch} onChange={e=>setModelSearch(e.target.value)} placeholder="Ej.: Minnie Mouse"/></label><datalist id="svg-model-options">{libraryModels.map(m=><option key={m.id} value={m.name}/>)}</datalist></div><label>Cantidad de figuras<input type="number" min="1" value={modelQty} onChange={e=>setModelQty(e.target.value)}/></label><button className="primary" onClick={addModelByName}>Agregar figura completa</button><span>Al agregar una figura se cargan automáticamente su tapa y su base, o su SVG simple.</span></section>
    {autoSummary&&<div className="notice"><b>Plan automático</b><span>{autoSummary.completeFigures??0} figura(s) completa(s) · mínimo: {autoSummary.targetComplete??10} · objetivo de aprovechamiento: {autoSummary.targetEfficiency??90}% · prioridad por {autoSummary.groups.length} fecha(s){autoSummary.fillers.length?` · ${autoSummary.fillers.length} rellenos de alta venta`:``}.</span></div>}
    {error&&<div className="notice">{error}</div>}
    <div className="planner-layout"><section className="panel planner-items"><div className="panel-heading"><h3>{result.automatic?'Figuras completas de esta placa':`Piezas físicas (${items.reduce((a,x)=>a+num(x.qty),0)})`}</h3><button className="ghost" onClick={()=>setItems([])}>Limpiar</button></div>
      {result.automatic?<>
        <div className="auto-figure-summary">
          {automaticItemSummary.map(row=><div className="auto-figure-row" key={row.figure}><b>{row.figure}</b><span>{row.qty} figura{row.qty===1?'':'s'} completa{row.qty===1?'':'s'}</span></div>)}
        </div>
        {!automaticItemSummary.length&&<div className="empty-message">Generá una placa automática para ver las figuras completas incluidas.</div>}
      </>:<>
        <div className="planner-item-head svg-head"><span>Componente</span><span>Ancho</span><span>Alto</span><span>Cant.</span><span></span></div>
        {items.map(it=><div className="planner-item svg-item" key={it.id}><div className="svg-upload-cell"><b>{it.name}</b><small>{it.blockInterior!==false?'Interior bloqueado':'Interior utilizable'}</small></div><input type="number" step=".001" value={it.width} readOnly title="Ancho exacto leído del SVG"/><input type="number" step=".001" value={it.height} readOnly title="Alto exacto leído del SVG"/><input type="number" min="0" value={it.qty} onChange={e=>update(it.id,'qty',e.target.value)}/><button className="danger small" onClick={()=>setItems(v=>v.filter(x=>x.id!==it.id))}>×</button></div>)}
        {!items.length&&<div className="empty-message">Buscá una figura por nombre y elegí la cantidad.</div>}
      </>}
    </section><section className="planner-preview"><div className="planner-kpis"><div className="metric-card"><small>Placas</small><b className="viz-stat-value">{result.sheets.length}</b></div><div className="metric-card"><small>Piezas</small><b className="viz-stat-value">{result.total}</b></div><div className="metric-card"><small>Compactación</small><b className="viz-stat-value">{result.sheets.length?Math.round(100*result.used/(result.sheetArea*result.sheets.length)):0}%</b></div></div>
      {result.rejected.length>0&&<div className="notice">{result.rejected.length} pieza(s) no entraron.</div>}{result.waitingSheets?.length>0&&<div className="notice"><b>{result.waitingSheets.length} placa(s) en espera</b><span>No se guardan como listas para cortar hasta alcanzar {result.threshold}% o recibir más piezas pendientes.</span></div>}
      <div className="panel preview-panel"><div className="panel-heading"><h3>Vista previa</h3><div><button className="ghost" disabled={!sheet} onClick={savePlan}>Guardar diseño</button> <button className="ghost" disabled={!sheet||(result.automatic&&kitCountOnSheet(sheet)<10)} title={result.automatic&&sheet&&kitCountOnSheet(sheet)<10?'Resultado parcial: el motor todavía no alcanzó 10 figuras completas.':''} onClick={sendSheetToCut}>Enviar a corte</button> <button className="primary" disabled={!sheet} onClick={download}>Descargar SVG</button></div></div>{result.sheets.length>1&&<div className="sheet-tabs">{result.sheets.map((s,i)=><button key={i} className={active===i?'active':''} onClick={()=>setActive(i)}>Placa {i+1}</button>)}</div>}{!sheet?<div className="empty-message">Generá las placas para ver el resultado.</div>:<><div className="sheet-info"><div><b>Placa {sheet.number}</b><span>{kitCountOnSheet(sheet)} figuras completas · {sheet.placed.length} componentes físicos · {sheet.efficiency.toFixed(1)}% ocupación real {result.precisionValidated?'· ✓ geometría CNC válida':''} {kitCountOnSheet(sheet)>=10?'· ✓ mínimo 10':'· ⚠ RESULTADO PARCIAL · faltan '+(10-kitCountOnSheet(sheet))+' para mínimo 10'} {sheet.groupCompactness!=null?` · compactación del grupo ${Number(sheet.groupCompactness).toFixed(1)}%`:''}</span><small className="block">Producción real: {sheetProductionRows(sheet,sheetMultipliers[sheet.number]||1).reduce((a,r)=>a+r.qty,0)} figura(s). Esta cantidad se reserva en “Para cortar” y se suma al inventario al terminar.</small></div><label className="sheet-cut-mode"><b>Tipo de corte</b><select value={sheetMultipliers[sheet.number]||1} onChange={e=>setMultiplier(sheet.number,e.target.value)}><option value="1">Simple · cortar 1 placa</option><option value="2">Doble · cortar 2 placas iguales</option></select><small>{(sheetMultipliers[sheet.number]||1)===2?'Las cantidades se multiplican por 2.':'Las cantidades se registran una sola vez.'}</small></label></div><div className="sheet-canvas-wrap"><div className="sheet-canvas" style={{width:num(sheetW)*scale,height:num(sheetH)*scale}}>{sheet.placed.map(p=>{
  const angle=((num(p.angle,p.rotated?90:0)%360)+360)%360
  const srcW=num(p.sourceWidth||p.width),srcH=num(p.sourceHeight||p.height)
  const rad=angle*Math.PI/180,c=Math.cos(rad),sn=Math.sin(rad)
  const corners=[[0,0],[srcW,0],[0,srcH],[srcW,srcH]].map(([x,y])=>[x*c-y*sn,x*sn+y*c])
  const minX=Math.min(...corners.map(q=>q[0])),minY=Math.min(...corners.map(q=>q[1]))
  if(p.industrial)return <div key={p.instanceId} title={`${p.name} · ${angle}°`} style={{position:'absolute',left:p.x*scale,top:p.y*scale,transform:`rotate(${angle}deg)`,transformOrigin:'0 0'}}><img src={svgDataUrl(p.svgText)} alt={p.name} style={{position:'absolute',left:-num(p.trimXCm)*scale,top:-num(p.trimYCm)*scale,width:srcW*scale,height:srcH*scale,maxWidth:'none',pointerEvents:'none'}}/></div>
  return <img key={p.instanceId} src={svgDataUrl(p.svgText)} alt={p.name} title={`${p.name} · ${angle}°`}
    style={{position:'absolute',left:(p.x-minX)*scale,top:(p.y-minY)*scale,width:srcW*scale,height:srcH*scale,
      transform:`rotate(${angle}deg)`,transformOrigin:'0 0',display:'block',pointerEvents:'none'}}/>
})}</div></div></>}</div>
    </section></div>
  </div>
}
