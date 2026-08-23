// LAB CLEAN V2: this preview must never execute the historical V1.12 nesting path.
// BUILD MARKER 2026-08-23T20:00-03:00: force exactly one preview after clean-route fix.
export default function sparrowLabRoutePlugin(){
  return {
    name:'sparrow-lab-route',
    enforce:'pre',
    transform(code,id){
      if(id.endsWith('/src/pages/SheetPlanner.jsx')){
        let out=code
        if(!out.includes("from '../lib/sparrowLab'")){
          out=out.replace(
            "import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'",
            "import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'\nimport { solveWithSparrowLab } from '../lib/sparrowLab'"
          )
        }

        const start="      // v23: una sola ruta de cálculo. Sin fetch, sin Render y sin segundo algoritmo."
        const end="      const response={ok:true,status:200}"
        const a=out.indexOf(start)
        const b=out.indexOf(end,a)
        if(a<0||b<0)throw new Error('sparrowLabRoutePlugin: no encontré el bloque local de generateAutomatic en SheetPlanner')
        const replacement=`      // LAB CLEAN: única ruta permitida en este preview. El solver local V1.12/V23 queda fuera.\n      const clean=await solveWithSparrowLab(payload,{\n        onStage:stage=>setCalcProgress(v=>({...v,stage,elapsed:(Date.now()-started)/1000}))\n      })\n      const raw=clean.raw||{}\n      const data={\n        ...raw,\n        ok:true,\n        localStable:false,\n        engine:clean.engine||'Sparrow CLEAN Area-First',\n        completeFigures:Number(clean.completeFigures||raw.completeFigures||0),\n        placements:clean.placements||[],\n        density:Number(clean.geometricOccupancyPct||raw.geometricOccupancyPct||0),\n        compactness:Number(clean.materialInsideUsedStripPct||raw.materialInsideUsedStripPct||clean.geometricOccupancyPct||0),\n        usedWidthMm:Number(clean.stripWidthMm||raw.stripWidthMm||0),\n        usedHeightMm:num(sheetH,58)*10,\n        attempts:clean.attempts||[],\n        minimumTarget:1,\n        reachedMinimum:true,\n        reachedDensity:Number(clean.geometricOccupancyPct||0)>=Math.min(90,Math.max(70,num(minFill,70))),\n        selectionStrategy:clean.selectionStrategy||raw.selectionStrategy||'area-first'\n      }\n      const response={ok:true,status:200}`
        out=out.slice(0,a)+replacement+out.slice(b+end.length)
        out=out.replace("industrial:false,localFallback:false,localStable:true","industrial:true,localFallback:false,localStable:false")
        out=out.replace("'El motor local terminó sin componentes colocados.'","'Sparrow CLEAN terminó sin componentes colocados.'")
        out=out.replace("bestStrategy:'Motor Polifan v23 · subconjuntos completos'","bestStrategy:data.selectionStrategy||'Sparrow CLEAN · Area-First'")
        out=out.replaceAll('10 base · crecer mientras entre','AREA-FIRST real · Sparrow CLEAN')
        out=out.replaceAll('mínimo 10 completas · objetivo ≥70%','sin mínimo artificial · objetivo: máxima ocupación real')
        return {code:out,map:null}
      }

      if(!id.endsWith('/src/pages/MotorDefinitivo.jsx'))return null
      let out=code

      if(!out.includes("from '../lib/sparrowLab'")){
        out=out.replace(
          "import React,{useEffect,useMemo,useState} from 'react'",
          "import React,{useEffect,useMemo,useState} from 'react'\nimport {solveWithSparrowLab} from '../lib/sparrowLab'"
        )
      }

      // Ignore any old async job saved by the V1.12/test backend.
      out=out.replace(
        "const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v1'",
        "const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v2-clean'"
      )

      const rx=/  async function runPayload\(payload,multiplier\)\{[\s\S]*?\n  \}\n  async function finishResult/
      if(!rx.test(out))throw new Error('sparrowLabRoutePlugin: no encontré runPayload en MotorDefinitivo')

      const replacement=`  async function runPayload(payload,multiplier){\n    clearActiveJob()\n    setProgress('Sparrow limpio · enviando geometrías reales…')\n    const clean=await solveWithSparrowLab(payload,{\n      onStage:stage=>setProgress(stage)\n    })\n    const raw=clean.raw||{}\n    return {\n      ...raw,\n      ok:true,\n      engine:clean.engine,\n      placements:clean.placements,\n      completeFigures:clean.completeFigures,\n      density:clean.geometricOccupancyPct,\n      geometricOccupancyPct:clean.geometricOccupancyPct,\n      stripWidthMm:clean.stripWidthMm,\n      stripWidthUsagePct:clean.stripWidthUsagePct,\n      materialInsideUsedStripPct:clean.materialInsideUsedStripPct,\n      rotationStep:raw.rotation==='continua'?'continua':(raw.rotation||'-'),\n      reachedMinimum:true,\n      noArtificialMinimum:true,\n      candidatePool:Number(raw.candidatePoolTested||0),\n      selectionStrategy:clean.selectionStrategy||clean.engine,\n      elapsedSeconds:Number(raw.elapsedSeconds||0)\n    }\n  }\n  async function finishResult`
      out=out.replace(rx,replacement)

      // Make it visually unmistakable that this preview is not using V1.12.
      out=out.replaceAll('Motor Sparrow + Certificador V1.7','Sparrow CLEAN Area-First + Certificador')
      out=out.replaceAll('10 base · crecer mientras entre','AREA-FIRST real · sin mínimo artificial')
      out=out.replaceAll('Sparrow asíncrono · V1.7 certifica','Sparrow CLEAN directo · Area-First')
      out=out.replaceAll('Primero asegura 10 y después intenta agregar 11, 12, 13… mientras entren físicamente dentro de los 1220 × 580 mm.','Prueba aislada: usa Sparrow CLEAN directamente y prioriza área real ocupada, sin pasar por V1.12.')

      return {code:out,map:null}
    }
  }
}
