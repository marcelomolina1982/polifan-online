// LAB CLEAN V2: this preview must never execute the historical V1.12 nesting path.
// BUILD MARKER 2026-08-28: force 1230x580 and persist reproducible real-run history.
const BENCH_LAST='polifan-motor-benchmark-last-v1'
const BENCH_HISTORY='polifan-motor-benchmark-history-v1'
const BENCH_HISTORY_MAX=20
function persistBenchmark(benchmark){
  try{
    localStorage.setItem(BENCH_LAST,JSON.stringify(benchmark))
    const previous=JSON.parse(localStorage.getItem(BENCH_HISTORY)||'[]')
    const history=Array.isArray(previous)?previous:[]
    history.unshift(benchmark)
    localStorage.setItem(BENCH_HISTORY,JSON.stringify(history.slice(0,BENCH_HISTORY_MAX)))
  }catch{}
  try{window.__POLIFAN_LAST_NEST_BENCHMARK__=benchmark}catch{}
}
function persistBenchmarkResult(runId,result){
  try{
    const previous=JSON.parse(localStorage.getItem(BENCH_HISTORY)||'[]')
    if(!Array.isArray(previous))return
    const idx=previous.findIndex(x=>x?.runId===runId)
    if(idx<0)return
    previous[idx]={...previous[idx],finishedAt:new Date().toISOString(),result:{
      ok:Boolean(result?.ok),engine:String(result?.engine||''),completeFigures:Number(result?.completeFigures||0),
      geometricOccupancyPct:Number(result?.geometricOccupancyPct||result?.density||0),stripWidthMm:Number(result?.stripWidthMm||0),
      selectedKitIds:Array.isArray(result?.selectedKitIds)?result.selectedKitIds:[],placements:Array.isArray(result?.placements)?result.placements:[],
      elapsedSeconds:Number(result?.elapsedSeconds||0)
    }}
    localStorage.setItem(BENCH_HISTORY,JSON.stringify(previous.slice(0,BENCH_HISTORY_MAX)))
  }catch{}
}

export default function sparrowLabRoutePlugin(){
  return {
    name:'sparrow-lab-route',
    enforce:'pre',
    transform(code,id){
      if(id.endsWith('/src/pages/SheetPlanner.jsx')){
        let out=code
        if(!out.includes("from '../lib/sparrowLab'")){
          out=out.replace("import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'","import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'\nimport { solveWithSparrowLab } from '../lib/sparrowLab'")
        }
        const start="      // v23: una sola ruta de cálculo. Sin fetch, sin Render y sin segundo algoritmo."
        const end="      const response={ok:true,status:200}"
        const a=out.indexOf(start),b=out.indexOf(end,a)
        if(a<0||b<0)throw new Error('sparrowLabRoutePlugin: no encontré el bloque local de generateAutomatic en SheetPlanner')
        const replacement=`      // LAB CLEAN: única ruta permitida en este preview. El solver local V1.12/V23 queda fuera.\n      const clean=await solveWithSparrowLab(payload,{\n        onStage:stage=>setCalcProgress(v=>({...v,stage,elapsed:(Date.now()-started)/1000}))\n      })\n      const raw=clean.raw||{}\n      const data={\n        ...raw,ok:true,localStable:false,engine:clean.engine||'Sparrow CLEAN Area-First',completeFigures:Number(clean.completeFigures||raw.completeFigures||0),placements:clean.placements||[],density:Number(clean.geometricOccupancyPct||raw.geometricOccupancyPct||0),compactness:Number(clean.materialInsideUsedStripPct||raw.materialInsideUsedStripPct||clean.geometricOccupancyPct||0),usedWidthMm:Number(clean.stripWidthMm||raw.stripWidthMm||0),usedHeightMm:num(sheetH,58)*10,attempts:clean.attempts||[],minimumTarget:1,reachedMinimum:true,reachedDensity:Number(clean.geometricOccupancyPct||0)>=Math.min(90,Math.max(70,num(minFill,70))),selectionStrategy:clean.selectionStrategy||raw.selectionStrategy||'area-first'\n      }\n      const response={ok:true,status:200}`
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
        out=out.replace("import React,{useEffect,useMemo,useState} from 'react'","import React,{useEffect,useMemo,useState} from 'react'\nimport {solveWithSparrowLab} from '../lib/sparrowLab'")
      }
      out=out.replace("const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v1'","const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v2-clean'")
      out=out.replaceAll('widthCm:122,heightCm:58','widthCm:123,heightCm:58')
      out=out.replaceAll('width=\"1220mm\" height=\"580mm\" viewBox=\"0 0 1220 580\"','width=\"1230mm\" height=\"580mm\" viewBox=\"0 0 1230 580\"')
      out=out.replaceAll('1220 × 580 mm','1230 × 580 mm')
      const rx=/\basync\s+function\s+runPayload\s*\(payload\s*,\s*multiplier\s*\)\s*\{[\s\S]*?\}\s*async\s+function\s+finishResult/
      if(!rx.test(out))throw new Error('sparrowLabRoutePlugin: no encontré runPayload en MotorDefinitivo')
      const replacement=`async function runPayload(payload,multiplier){\n    clearActiveJob()\n    payload={...payload,widthCm:123,heightCm:58}\n    const runId='real-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)\n    const benchmark={schema:'polifan-nesting-benchmark-v2',runId,capturedAt:new Date().toISOString(),source:'MotorDefinitivo',plate:{widthMm:1230,heightMm:580,gapMm:Number(payload?.gapCm||0)*10},multiplier:Number(multiplier||1),candidateKitIds:(payload?.kits||[]).map(k=>k?.kitId).filter(Boolean),payload}\n    persistBenchmark(benchmark)\n    setProgress('Sparrow limpio · 1230×580 · entrada real guardada · enviando geometrías…')\n    const clean=await solveWithSparrowLab(payload,{onStage:stage=>setProgress(stage)})\n    const raw=clean.raw||{}\n    const result={...raw,ok:true,engine:clean.engine,placements:clean.placements,completeFigures:clean.completeFigures,density:clean.geometricOccupancyPct,geometricOccupancyPct:clean.geometricOccupancyPct,stripWidthMm:clean.stripWidthMm,stripWidthUsagePct:clean.stripWidthUsagePct,materialInsideUsedStripPct:clean.materialInsideUsedStripPct,rotationStep:raw.rotation==='continua'?'continua':(raw.rotation||'-'),reachedMinimum:true,noArtificialMinimum:true,candidatePool:Number(raw.candidatePoolTested||0),selectionStrategy:clean.selectionStrategy||clean.engine,elapsedSeconds:Number(raw.elapsedSeconds||0)}\n    persistBenchmarkResult(runId,result)\n    return result\n  }\n  async function finishResult`
      out=out.replace(rx,replacement)
      out=out.replaceAll('Motor Sparrow + Certificador V1.7','Sparrow CLEAN Area-First + Certificador')
      out=out.replaceAll('10 base · crecer mientras entre','AREA-FIRST real · sin mínimo artificial')
      out=out.replaceAll('Sparrow asíncrono · V1.7 certifica','Sparrow CLEAN directo · Area-First')
      out=out.replaceAll('Primero asegura 10 y después intenta agregar 11, 12, 13… mientras entren físicamente dentro de los 1230 × 580 mm.','Prueba aislada: usa Sparrow CLEAN directamente sobre 1230 × 580 mm, conserva cada entrada real reproducible y prioriza figuras completas + ocupación real.')
      return {code:out,map:null}
    }
  }
}