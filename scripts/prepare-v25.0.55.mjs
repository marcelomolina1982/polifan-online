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

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8').replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.55'").replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.55'").replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · motor SVG móvil autenticado'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js';fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.55'"))
const indexFile='index.html';fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.55'"))
console.log('v25.0.55: SVG autenticado por POST · sin header Authorization del navegador · cache/SW renovados')
