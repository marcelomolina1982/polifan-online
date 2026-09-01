import './prepare-v25.0.54.mjs'
import fs from 'node:fs'

const v2DataFile='src/lib/v2Data.js'
let v2=fs.readFileSync(v2DataFile,'utf8')
const rx=/export async function loadV2SvgFull\(id\)\{[\s\S]*?\n\}/
if(!rx.test(v2))throw new Error('v25.0.58: no encontré loadV2SvgFull generado por 25.0.54')
v2=v2.replace(rx,`export async function loadV2SvgFull(id){
  const sessionResult=await supabase.auth.getSession()
  const token=sessionResult?.data?.session?.access_token||''
  if(!token)throw new Error('La sesión venció. Volvé a ingresar antes de generar una placa.')
  const response=await fetch('/api/v2-svg-full',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({id:String(id||''),token})})
  const payload=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(payload?.error||('No se pudo cargar SVG (HTTP '+response.status+')'))
  return{data:payload?.data||null,updatedAt:payload?.updatedAt||''}
}`)
fs.writeFileSync(v2DataFile,v2)

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
if(!motor.includes("import {supabase} from '../supabase'"))motor=motor.replace("import {today} from '../lib/format'","import {today} from '../lib/format'\nimport {supabase} from '../supabase'")

const rowBefore="const row={instanceId,kitId,figure:unit.figure,name:comp.name||`${unit.figure} ${comp.role||'pieza'}`,role:comp.role||'simple',svgText:comp.svgText,sourceWidthCm:Number(comp.sourceWidthCm||comp.widthCm),sourceHeightCm:Number(comp.sourceHeightCm||comp.heightCm),widthCm:Number(comp.sourceWidthCm||comp.widthCm),heightCm:Number(comp.sourceHeightCm||comp.heightCm),allowRotate:true}"
const rowAfter="const row={instanceId,kitId,figure:unit.figure,name:comp.name||`${unit.figure} ${comp.role||'pieza'}`,role:comp.role||'simple',svgId:String(comp.id||''),svgText:comp.svgText,sourceWidthCm:Number(comp.sourceWidthCm||comp.widthCm),sourceHeightCm:Number(comp.sourceHeightCm||comp.heightCm),widthCm:Number(comp.sourceWidthCm||comp.widthCm),heightCm:Number(comp.sourceHeightCm||comp.heightCm),allowRotate:true}"
if(motor.includes(rowBefore))motor=motor.replace(rowBefore,rowAfter)
else if(!motor.includes("svgId:String(comp.id||'')"))throw new Error('v25.0.58: no encontré fila de pieza para agregar svgId')

const hydrateBlock=`    const designUnits=await hydrateUnits(unitsForMultiplier(pending.units,multiplier))
    const invalidGeometry=designUnits.flatMap(u=>u.components||[]).filter(c=>!c?.svgText)
    if(invalidGeometry.length)throw new Error(\`No se pudo cargar la geometría de \${invalidGeometry.length} componente(s) SVG. Volvé a intentar una vez.\`)
    const industrial=buildIndustrialKits(designUnits)`
const lightBlock=`    const designUnits=unitsForMultiplier(pending.units,multiplier)
    const industrial=buildIndustrialKits(designUnits)`
if(motor.includes(hydrateBlock))motor=motor.replace(hydrateBlock,lightBlock)
else if(!motor.includes(lightBlock))throw new Error('v25.0.58: no encontré bloque de generación liviana')

const startAnchor='  async function startJob(payload,multiplier){'
if(!motor.includes(startAnchor))throw new Error('v25.0.58: no encontré startJob')
if(!motor.includes('const compact={...payload,_accessToken:accessToken')){
  motor=motor.replace(startAnchor,startAnchor+`\n    const sessionResult=await supabase.auth.getSession()\n    const accessToken=sessionResult?.data?.session?.access_token||''\n    if(!accessToken)throw new Error('La sesión venció. Volvé a ingresar antes de generar una placa.')\n    const compact={...payload,_accessToken:accessToken,kits:(payload.kits||[]).map(k=>({...k,parts:(k.parts||[]).map(p=>{const {svgText,...rest}=p;return rest})}))}`)
}
const bodyAnchor='body:JSON.stringify(payload)'
if(motor.includes(bodyAnchor))motor=motor.replace(bodyAnchor,'body:JSON.stringify(compact)')
else if(!motor.includes('body:JSON.stringify(compact)'))throw new Error('v25.0.58: no encontré body de nest-start')

const composeBefore='    const composed=composeIndustrialSvg(data.placements||[],industrial.partMap)'
const composeAfter=`    const placementRows=data.placements||[]
    const placedMeta=[...new Map(placementRows.map(p=>{const key=String(p.instanceId||'');const meta=industrial.partMap.get(key);const id=String(meta?.svgId||meta?.original?.id||'');return id&&!meta?.svgText?[id,meta]:null}).filter(Boolean)).entries()]
    const loadedPairs=await Promise.all(placedMeta.map(async([id])=>{const row=await loadV2SvgFull(id);return[id,row?.data||null]}))
    const fullById=new Map(loadedPairs.filter(([,full])=>full?.svgText))
    const hydratedPartMap=new Map(industrial.partMap)
    for(const p of placementRows){
      const key=String(p.instanceId||'');const meta=hydratedPartMap.get(key);if(!meta||meta.svgText)continue
      const id=String(meta.svgId||meta.original?.id||'');const full=fullById.get(id)
      if(full?.svgText)hydratedPartMap.set(key,{...meta,svgText:full.svgText,sourceWidthCm:Number(meta.sourceWidthCm||full.sourceWidthCm||full.widthCm),sourceHeightCm:Number(meta.sourceHeightCm||full.sourceHeightCm||full.heightCm),widthCm:Number(meta.widthCm||full.sourceWidthCm||full.widthCm),heightCm:Number(meta.heightCm||full.sourceHeightCm||full.heightCm)})
    }
    const missingPlaced=placementRows.filter(p=>!hydratedPartMap.get(String(p.instanceId||''))?.svgText)
    if(missingPlaced.length)throw new Error('No se pudo recuperar la geometría final de '+missingPlaced.length+' pieza(s) para certificar la placa.')
    const composed=composeIndustrialSvg(placementRows,hydratedPartMap)`
if(motor.includes(composeBefore))motor=motor.replace(composeBefore,composeAfter)
else if(!motor.includes('const hydratedPartMap=new Map(industrial.partMap)'))throw new Error('v25.0.58: no encontré composición final para hidratar piezas colocadas')
fs.writeFileSync(motorFile,motor)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.58'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.58'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · certificación con SVG colocados hidratados'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.58'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.58'"))
console.log('v25.0.58: Sparrow arranca liviano · sólo hidrata SVG colocados al certificar · cache renovada')
