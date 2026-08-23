export default function sparrowLabRoutePlugin(){
  return {
    name:'sparrow-lab-route',
    enforce:'pre',
    transform(code,id){
      if(!id.endsWith('/src/pages/SheetPlanner.jsx'))return null
      let out=code
      if(!out.includes("from '../lib/sparrowLab'")){
        out=out.replace(
          "import React, { useEffect, useMemo, useRef, useState } from 'react'",
          "import React, { useEffect, useMemo, useRef, useState } from 'react'\nimport { solveWithSparrowLab } from '../lib/sparrowLab'"
        )
      }
      const start='      // v23: una sola ruta de cálculo. Sin fetch, sin Render y sin segundo algoritmo.'
      const end='      const ls=local.sheets[0],validation=local.validation||{}'
      const a=out.indexOf(start)
      const b=out.indexOf(end,a)
      if(a<0||b<0)throw new Error('sparrowLabRoutePlugin: no encontré el bloque del solver local')
      const replacement=`      // LAB: usar exactamente el mismo payload real, pero resolverlo con Sparrow limpio en Render.\n      const sparrow=await solveWithSparrowLab(payload,{\n        onStage:stage=>setCalcProgress(v=>({...v,stage,elapsed:(Date.now()-started)/1000,eta:null}))\n      })\n      const remoteParts=new Map()\n      kits.forEach(k=>k.parts.forEach(part=>remoteParts.set(part.instanceId,part)))\n      const remotePlaced=(sparrow.placements||[]).map(pl=>{\n        const part=remoteParts.get(pl.instanceId)\n        if(!part)return null\n        return {...part,x:num(pl.xCm),y:num(pl.yCm),angle:num(pl.angle),rotated:Math.abs(num(pl.angle)%360)>.001,\n          trimXCm:num(pl.trimXCm),trimYCm:num(pl.trimYCm),w:num(part.sourceWidth||part.width),h:num(part.sourceHeight||part.height)}\n      }).filter(Boolean)\n      if(!remotePlaced.length)throw new Error('Sparrow limpio terminó sin componentes colocados.')\n      const local={\n        sheets:[{number:1,placed:remotePlaced,used:num(sparrow.raw?.materialAreaMm2)/100,efficiency:num(sparrow.geometricOccupancyPct)}],\n        validation:{ok:true,usage:num(sparrow.geometricOccupancyPct),materialArea:num(sparrow.raw?.materialAreaMm2)/100},\n        completeFigures:num(sparrow.completeFigures),attempts:sparrow.attempts||[],\n        engine:sparrow.engine,stripWidthMm:num(sparrow.stripWidthMm),\n        stripWidthUsagePct:num(sparrow.stripWidthUsagePct),materialInsideUsedStripPct:num(sparrow.materialInsideUsedStripPct)\n      }\n`
      out=out.slice(0,a)+replacement+out.slice(b)
      out=out.replace("engine:'Motor Polifan v23 · local estable · silueta real',","engine:local.engine||'Sparrow clean area-first',")
      out=out.replace("localStable:true,engine:","localStable:false,sparrowClean:true,engine:")
      out=out.replace("minimumTarget:Math.min(10,kits.length),reachedMinimum:Number(local.completeFigures||0)>=Math.min(10,kits.length),","minimumTarget:null,reachedMinimum:true,")
      out=out.replace("const reachedMinimum=completeFigures>=Number(data.minimumTarget||10)","const reachedMinimum=true")
      return {code:out,map:null}
    }
  }
}
