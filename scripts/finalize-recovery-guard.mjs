import fs from 'node:fs'

function writeIfChanged(file,before,after){
  if(after===before) return false
  fs.writeFileSync(file,after)
  return true
}

// RECOVERY GUARD: neutraliza únicamente la reconciliación automática que el
// finalizer legado inyecta en OperationsHub durante build. El Centro operativo
// debe ser de lectura para las etapas derivadas; no debe guardar por montarse.
{
  const file='src/pages/OperationsHub.jsx'
  const before=fs.readFileSync(file,'utf8')
  let src=before
  src=src.replace(/\s*useEffect\(\(\)=>\{const result=advanceOperationalJourney\(db,new Date\(\)\.toISOString\(\)\);if\(result\.changed\)Promise\.resolve\(onSave\?\.\(\{\.\.\.db,orders:result\.orders\}\)\)\.catch\(console\.error\)\},\[db\.orders,db\.movements,db\.cutBatches,onSave\]\)\n?/,'\n')
  // Si el finalizer dejó imports ampliados, no son peligrosos; el punto crítico
  // es impedir escrituras automáticas al abrir la pantalla.
  writeIfChanged(file,before,src)
}

// RECOVERY GUARD: Sparrow requiere sesión. La app ya tiene una sesión Supabase
// válida; adjuntamos sólo el access token al POST de inicio. No se toca db,
// pedidos, movimientos, inventario ni registro de placas.
{
  const file='src/pages/MotorDefinitivo.jsx'
  const before=fs.readFileSync(file,'utf8')
  let src=before
  if(!src.includes("import {supabase} from '../supabase'")){
    src=src.replace("import {Title} from '../components/UI'", "import {Title} from '../components/UI'\nimport {supabase} from '../supabase'")
  }
  const old="  async function startJob(payload,multiplier){\n    const response=await fetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})"
  const next="  async function startJob(payload,multiplier){\n    const {data:{session}}=await supabase.auth.getSession()\n    const accessToken=String(session?.access_token||'').trim()\n    if(!accessToken)throw new Error('Tu sesión venció. Volvé a iniciar sesión antes de generar la placa.')\n    const response=await fetch('/api/nest-start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,_accessToken:accessToken})})"
  if(src.includes(old)) src=src.replace(old,next)
  if(!src.includes('_accessToken:accessToken')) throw new Error('RECOVERY GUARD: no se pudo asegurar autenticación de Sparrow')
  writeIfChanged(file,before,src)
}

console.log('RECOVERY GUARD OK · Centro operativo sin auto-save · Sparrow con sesión')
