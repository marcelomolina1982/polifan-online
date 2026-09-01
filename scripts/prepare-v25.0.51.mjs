import './prepare-v25.0.50.mjs'
import fs from 'node:fs'

// v25.0.51: estabilización móvil y operativa sin cambiar el modelo de datos.
// - navegación React sin manipulación externa del DOM
// - carga del módulo antes de cambiar de pantalla
// - error boundary para evitar pantalla blanca
// - fallbacks de SVG
// - timeout del polling de Render
// - contraste móvil
// - catálogo público sincronizado sólo por trigger de Supabase (sin duplicar 6 MB desde el cliente)

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')

app=app.replace(
  "const Loading=()=> <div className=\"v2-boot\"><div className=\"v2-boot-orb\"/><b>Preparando tu espacio de trabajo</b><span>Cargando sólo lo necesario…</span></div>",
  `const Loading=()=> <div className="v2-boot"><div className="v2-boot-orb"/><b>Preparando tu espacio de trabajo</b><span>Cargando sólo lo necesario…</span></div>\n\nclass PageErrorBoundary extends React.Component{\n  constructor(props){super(props);this.state={error:null}}\n  static getDerivedStateFromError(error){return{error}}\n  componentDidCatch(error,info){console.error('Error de módulo V2',error,info)}\n  render(){\n    if(this.state.error)return <div className="panel v2-module-error"><b>No se pudo abrir esta sección.</b><span>{String(this.state.error?.message||'Error inesperado')}</span><button className="primary" onClick={()=>window.location.reload()}>Recargar aplicación</button></div>\n    return this.props.children\n  }\n}`
)

app=app.replace(
  "if(!missing.length){setLoading(false);setPageLoading(false);return}",
  "if(!missing.length){setLoading(false);setPageLoading(false);return true}"
)
app=app.replace("if(request!==requestRef.current)return\n      const next=", "if(request!==requestRef.current)return false\n      const next=")
app=app.replace(
  "setDb(next);writeCache({keys:[...loadedRef.current],data:Object.fromEntries([...loadedRef.current].filter(k=>k!=='customerCatalog'||target!=='catalog').map(k=>[k,next[k]]))})\n    }catch(error){console.error(error);alert('No se pudo cargar esta sección: '+error.message)}finally{if(request===requestRef.current){setLoading(false);setPageLoading(false)}}",
  "setDb(next);writeCache({keys:[...loadedRef.current],data:Object.fromEntries([...loadedRef.current].filter(k=>k!=='customerCatalog'||target!=='catalog').map(k=>[k,next[k]]))});return true\n    }catch(error){console.error(error);alert('No se pudo cargar esta sección: '+error.message);return false}finally{if(request===requestRef.current){setLoading(false);setPageLoading(false)}}"
)

app=app.replace(
  "function go(id){if(id==='new'){try{localStorage.removeItem('polifan-order-draft-v1')}catch{}setEditingOrder(null)}setPage(id);setMobileOpen(false);ensurePage(id,false)}",
  "async function go(id){if(id==='new'){try{localStorage.removeItem('polifan-order-draft-v1')}catch{}setEditingOrder(null)}setMobileOpen(false);const ok=await ensurePage(id,false);if(ok!==false)setPage(id)}"
)
app=app.replace(
  "try{localStorage.setItem('polifan-order-draft-v1',JSON.stringify(draft))}catch{}setEditingOrder(null);setPage('new');ensurePage('new')",
  "try{localStorage.setItem('polifan-order-draft-v1',JSON.stringify(draft))}catch{}setEditingOrder(null);ensurePage('new').then(ok=>{if(ok!==false)setPage('new')})"
)
app=app.replace(
  "onEdit={o=>{setEditingOrder(o);setPage('new');ensurePage('new')}}",
  "onEdit={async o=>{setEditingOrder(o);const ok=await ensurePage('new');if(ok!==false)setPage('new')}}"
)
app=app.replace('<Suspense fallback={<Loading/>}>','<PageErrorBoundary key={page}><Suspense fallback={<Loading/>}>')
app=app.replace('</Suspense></main></div>','</Suspense></PageErrorBoundary></main></div>')
fs.writeFileSync(appFile,app)

const mainFile='src/main.jsx'
let main=fs.readFileSync(mainFile,'utf8')
main=main.replace("import './v2NavigationEnhancement'\n",'')
fs.writeFileSync(mainFile,main)

const v2DataFile='src/lib/v2Data.js'
let v2=fs.readFileSync(v2DataFile,'utf8')
const pageLoader=/export async function loadV2PageSections\(keys,\{fullCatalog=false,metadataSvg=false\}=\{\}\)\{[\s\S]*?\n\}/
if(pageLoader.test(v2))v2=v2.replace(pageLoader,`export async function loadV2PageSections(keys,{fullCatalog=false,metadataSvg=false}={}){\n  const wanted=uniq(keys)\n  if(!metadataSvg||!wanted.includes('svgLibrary'))return loadV2Sections(wanted,{fullCatalog})\n  try{\n    const rest=wanted.filter(k=>k!=='svgLibrary')\n    const [base,meta]=await Promise.all([\n      rest.length?loadV2Sections(rest,{fullCatalog}):Promise.resolve({data:{},updatedAt:''}),\n      loadV2SvgMetadata()\n    ])\n    return{data:{...(base.data||{}),svgLibrary:meta.data||[]},updatedAt:meta.updatedAt||base.updatedAt||''}\n  }catch(error){\n    console.warn('No se pudo cargar metadata SVG; usando fallback completo sólo para esta apertura.',error)\n    return loadV2Sections(wanted,{fullCatalog})\n  }\n}`)
const svgFull=/export async function loadV2SvgFull\(id\)\{[\s\S]*?\n\}/
if(svgFull.test(v2))v2=v2.replace(svgFull,`export async function loadV2SvgFull(id){\n  const key=String(id||'')\n  try{\n    const {data,error}=await supabase.rpc('get_v2_svg_full',{p_id:key})\n    if(error)throw error\n    const row=Array.isArray(data)?data[0]:data\n    return{data:row?.data||null,updatedAt:row?.updated_at||''}\n  }catch(error){\n    if(!isSchemaCacheError(error))throw error\n    console.warn('get_v2_svg_full no disponible; usando fallback de svgLibrary una vez.',error)\n    const fallback=await fallbackSections(['svgLibrary'])\n    const item=(fallback.data?.svgLibrary||[]).find(x=>String(x?.id||'')===key)||null\n    return{data:item,updatedAt:fallback.updatedAt||''}\n  }\n}`)
fs.writeFileSync(v2DataFile,v2)

const statusFile='api/nest-status.js'
fs.writeFileSync(statusFile,`export const config={maxDuration:20}\n\nconst BASE='https://polifan-motor-1230-bench-v4.onrender.com'\n\nasync function fetchTimed(url,options={},timeoutMs=15000){\n  const controller=new AbortController()\n  const timer=setTimeout(()=>controller.abort(),timeoutMs)\n  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}\n  finally{clearTimeout(timer)}\n}\n\nexport default async function handler(req,res){\n  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido'})\n  const raw=String(req.query?.id||'').trim()\n  if(!raw)return res.status(400).json({ok:false,error:'Falta id del trabajo'})\n  let id=raw\n  const sep=raw.indexOf(':')\n  if(sep>0)id=raw.slice(sep+1)\n  try{\n    const r=await fetchTimed(BASE+'/solve-status?id='+encodeURIComponent(id),{headers:{accept:'application/json'}},15000)\n    const text=await r.text()\n    res.status(r.status)\n    res.setHeader('content-type',r.headers.get('content-type')||'application/json')\n    res.setHeader('cache-control','no-store')\n    res.setHeader('x-solver-backend','motor-1230-v4')\n    return res.send(text)\n  }catch(e){\n    return res.status(e?.name==='AbortError'?503:502).json({ok:false,error:'No se pudo consultar Sparrow 1230 en Render: '+(e?.name==='AbortError'?'timeout':(e?.message||String(e))),renderBase:BASE,retryable:true})\n  }\n}\n`)

const catalogFile='src/pages/CatalogAdmin.jsx'
let catalog=fs.readFileSync(catalogFile,'utf8')
catalog=catalog.replace(/  async function persist\(next\)\{[\s\S]*?\n  \}\n  useEffect\(\(\)=>\{[\s\S]*?\n  \},\[\]\)\n/,`  async function persist(next){\n    // app_state/main dispara trg_sync_public_catalog_items en Supabase.\n    // No volver a subir el catálogo completo desde el navegador.\n    return await onSave(next)\n  }\n`)
fs.writeFileSync(catalogFile,catalog)

const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
css+=`\n/* v25.0.51 · legibilidad y recuperación */\n.v2-shell .delivery-head>b{background:#dff8f7!important;color:#0b5960!important;border:1px solid #b8e7e4!important}\n.v2-module-error{display:grid;gap:12px;max-width:620px;margin:24px auto!important;padding:22px!important}\n.v2-module-error>b{font-size:18px;color:#172033}.v2-module-error>span{color:#667085;overflow-wrap:anywhere}.v2-module-error>button{width:max-content}\n@media(max-width:760px){.v2-module-error{margin:12px!important}.v2-module-error>button{width:100%}}\n`
fs.writeFileSync(cssFile,css)

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
motor=motor.replace(/(const plan=\{[^\n]*?stripWidthMm:Number\(data\.stripWidthMm\|\|0\),)([^\n]*?),stripWidthMm:Number\(data\.stripWidthMm\|\|0\),/,'$1$2,')
motor=motor.replaceAll('/ 1220 mm','/ 1230 mm')
fs.writeFileSync(motorFile,motor)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.51'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.51'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · candidata V2 estabilizada para prueba real'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.51'")
fs.writeFileSync(swFile,sw)
const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.51'")
fs.writeFileSync(indexFile,index)

console.log('v25.0.51: navegación estable · sin pantalla blanca · SVG fallback · polling con timeout · catálogo sin doble transferencia')
