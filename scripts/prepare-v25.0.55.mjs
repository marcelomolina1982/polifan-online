import './prepare-v25.0.54.mjs'
import fs from 'node:fs'

const v2DataFile='src/lib/v2Data.js'
let v2=fs.readFileSync(v2DataFile,'utf8')
const rx=/export async function loadV2SvgFull\(id\)\{[\s\S]*?\n\}/
if(!rx.test(v2))throw new Error('v25.0.55: no encontré loadV2SvgFull generado por 25.0.54')
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
motor=motor.replace("const row={instanceId,kitId,figure:unit.figure,name:comp.name||`${unit.figure} ${comp.role||'pieza'}`,role:comp.role||'simple',svgText:comp.svgText,sourceWidthCm:Number(comp.sourceWidthCm||comp.widthCm),sourceHeightCm:Number(comp.sourceHeightCm||comp.heightCm),widthCm:Number(comp.sourceWidthCm||comp.widthCm),heightCm:Number(comp.sourceHeightCm||comp.heightCm),allowRotate:true}","const row={instanceId,kitId,figure:unit.figure,name:comp.name||`${unit.figure} ${comp.role||'pieza'}`,role:comp.role||'simple',svgId:String(comp.id||''),svgText:comp.svgText,sourceWidthCm:Number(comp.sourceWidthCm||comp.widthCm),sourceHeightCm:Number(comp.sourceHeightCm||comp.heightCm),widthCm:Number(comp.sourceWidthCm||comp.widthCm),heightCm:Number(comp.sourceHeightCm||comp.heightCm),allowRotate:true}")
const oldStart=`  async function startJob(payload,multiplier){
    const response=await fetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
    const data=await response.json().catch(()=>({}))`
const newStart=`  async function startJob(payload,multiplier){
    const sessionResult=await supabase.auth.getSession()
    const accessToken=sessionResult?.data?.session?.access_token||''
    if(!accessToken)throw new Error('La sesión venció. Volvé a ingresar antes de generar una placa.')
    const compact={...payload,_accessToken:accessToken,kits:(payload.kits||[]).map(k=>({...k,parts:(k.parts||[]).map(p=>{const {svgText,...rest}=p;return rest})}))}
    const response=await fetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(compact)})
    const data=await response.json().catch(()=>({}))`
if(!motor.includes(oldStart))throw new Error('v25.0.55: no encontré startJob para compactar payload')
motor=motor.replace(oldStart,newStart)
fs.writeFileSync(motorFile,motor)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.56'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.56'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Sparrow payload liviano y SVG servidor'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.56'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.56'"))
console.log('v25.0.56: navegador envía refs SVG livianas · Vercel hidrata antes de Sparrow · cache renovada')
