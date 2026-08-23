export default function sparrowLabRoutePlugin(){
  return {
    name:'sparrow-lab-route',
    enforce:'pre',
    transform(code,id){
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
