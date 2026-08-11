from pathlib import Path

sheet = Path('src/pages/SheetPlanner.jsx')
s = sheet.read_text(encoding='utf-8')

imp = "import { solveWithSparrow } from '../lib/sparrowEngine'\n"
if imp not in s:
    s = s.replace("import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'\n", "import { catalogProducts, normalizeCatalogProducts } from '../lib/catalog'\n" + imp)

if 'async function runSparrowStable(' not in s:
    marker = 'async function runStableLocalSolver(kits,wCm,hCm,gapCm,{'
    insert = r'''async function runSparrowStable(kits,wCm,hCm,gapCm,{
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

'''
    if marker not in s:
        raise SystemExit('No se encontró runStableLocalSolver')
    s = s.replace(marker, insert + marker, 1)

old = '''      // v23: una sola ruta de cálculo. Sin fetch, sin Render y sin segundo algoritmo.\n      const local=await runStableLocalSolver(\n        kits,num(sheetW,122),num(sheetH,58),Math.max(.25,num(gap,.3)),{\n          target:Math.min(10,kits.length),targetEfficiency:Math.min(90,Math.max(80,num(minFill,90))),deadlineMs:110000,\n          shouldStop:()=>stopCalcRef.current,\n          onProgress:p=>setCalcProgress(v=>({...v,...p,elapsed:(Date.now()-started)/1000,eta:Math.max(0,110-(Date.now()-started)/1000)}))\n        }\n      )\n'''
new = '''      // Motor principal: Sparrow WASM + jagua-rs. El solver local anterior queda\n      // únicamente como respaldo si el navegador no habilita memoria WASM compartida.\n      let local\n      try{\n        local=await runSparrowStable(\n          kits,num(sheetW,122),num(sheetH,58),Math.max(.30,num(gap,.3)),{\n            target:Math.min(10,kits.length),targetEfficiency:Math.min(90,Math.max(80,num(minFill,90))),deadlineMs:90000,\n            shouldStop:()=>stopCalcRef.current,\n            onProgress:p=>setCalcProgress(v=>({...v,...p,elapsed:(Date.now()-started)/1000,eta:Math.max(0,90-(Date.now()-started)/1000)}))\n          }\n        )\n      }catch(sparrowError){\n        if(globalThis.crossOriginIsolated===true&&typeof SharedArrayBuffer!=='undefined')throw sparrowError\n        setCalcProgress(v=>({...v,stage:'Sparrow no disponible en este navegador · respaldo local…'}))\n        local=await runStableLocalSolver(\n          kits,num(sheetW,122),num(sheetH,58),Math.max(.30,num(gap,.3)),{\n            target:Math.min(10,kits.length),targetEfficiency:Math.min(90,Math.max(80,num(minFill,90))),deadlineMs:70000,\n            shouldStop:()=>stopCalcRef.current,\n            onProgress:p=>setCalcProgress(v=>({...v,...p,elapsed:(Date.now()-started)/1000,eta:Math.max(0,70-(Date.now()-started)/1000)}))\n          }\n        )\n      }\n'''
if old in s:
    s = s.replace(old, new, 1)
elif 'local=await runSparrowStable(' not in s:
    raise SystemExit('No se encontró el bloque de solver automático')

s = s.replace("engine:'Motor Polifan v23 · local estable · silueta real',", "engine:local.engine||'Sparrow WASM + jagua-rs',")
sheet.write_text(s, encoding='utf-8')

engine = Path('src/lib/sparrowEngine.js')
e = engine.read_text(encoding='utf-8')
e = e.replace("if(rm)angle=-num(rm[1])", "if(rm)angle=num(rm[1])")
oldp = "placements.push({...meta,xCm:(tx+meta.padMm)/10,yCm:(ty+meta.padMm)/10,angle})"
newp = """const rad=angle*Math.PI/180,c=Math.cos(rad),sn=Math.sin(rad),w=meta.widthCm*10,h=meta.heightCm*10,pad=meta.padMm\n    const rawOriginX=tx+pad*c-pad*sn,rawOriginY=ty+pad*sn+pad*c\n    const corners=[[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>[x*c-y*sn,x*sn+y*c])\n    const minX=Math.min(...corners.map(q=>q[0])),minY=Math.min(...corners.map(q=>q[1]))\n    placements.push({...meta,xCm:(rawOriginX+minX)/10,yCm:(rawOriginY+minY)/10,angle})"""
if oldp in e:
    e = e.replace(oldp, newp)
engine.write_text(e, encoding='utf-8')

print('Sparrow integration applied')
