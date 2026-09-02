import './finalize-v25.0.77.mjs'
import fs from 'node:fs'

const appFile='src/AppV2.jsx'
let app=fs.readFileSync(appFile,'utf8')

const refsOld="const loadedRef=useRef(new Set(cached.keys||[])),baselineRef=useRef(initial),requestRef=useRef(0)"
const refsNew="const loadedRef=useRef(new Set(cached.keys||[])),baselineRef=useRef(initial),requestRef=useRef(0),navigationRef=useRef(0)"
if(!app.includes(refsOld))throw new Error('v25.0.81: no se encontró bloque de refs de navegación')
app=app.replace(refsOld,refsNew)

const goNew="async function go(id){const navigation=++navigationRef.current;if(id==='new'){try{localStorage.removeItem('polifan-order-draft-v1')}catch{}setEditingOrder(null)}setMobileOpen(false);await ensurePage(id,false);if(navigation!==navigationRef.current)return;setPage(id)}"
const goRx=/function go\(id\)\{[\s\S]*?\}\n  function openQuoteAsOrder/
if(!goRx.test(app))throw new Error('v25.0.81: no se encontró navegación V2')
app=app.replace(goRx,goNew+'\n  function openQuoteAsOrder')
app=app.replace('async async function go','async function go')

const asideOld="<aside className={'sidebar '+(mobileOpen?'open':'')}>"
const asideNew="<aside className={'sidebar '+(mobileOpen?'open':'')} onWheel={e=>{const el=e.currentTarget;if(el.scrollHeight>el.clientHeight){e.preventDefault();el.scrollTop+=e.deltaY}}}>"
if(!app.includes(asideOld))throw new Error('v25.0.81: no se encontró sidebar')
app=app.replace(asideOld,asideNew)

const suspenseOld='<Suspense fallback={<Loading/>}>'
const suspenseNew='<Suspense fallback={<div className="v2-module-loader"><b>Cargando módulo…</b><span>Un momento</span></div>}>'
if(!app.includes(suspenseOld))throw new Error('v25.0.81: no se encontró fallback de módulos')
app=app.replace(suspenseOld,suspenseNew)
fs.writeFileSync(appFile,app)

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')
const importOld="import React,{useEffect,useMemo,useState} from 'react'"
const importNew="import React,{useEffect,useMemo,useRef,useState} from 'react'"
if(!motor.includes(importOld))throw new Error('v25.0.81: no se encontró import de MotorDefinitivo')
motor=motor.replace(importOld,importNew)
const modeOld="  const [choosingMode,setChoosingMode]=useState(false)\n\n  useEffect(()=>{if(plans.length)savePlans(plans)},[plans])\n  useEffect(()=>{\n    const active=loadActiveJob()\n    if(active?.jobId){resumeActiveJob(active)}\n  },[])"
const modeNew="  const [choosingMode,setChoosingMode]=useState(false)\n  const resumeRef=useRef('')\n\n  useEffect(()=>{if(plans.length)savePlans(plans)},[plans])\n  useEffect(()=>{\n    const active=loadActiveJob()\n    if(!active?.jobId||resumeRef.current===active.jobId)return\n    if(!(db.svgLibrary||[]).length||!(db.orders||[]).length)return\n    resumeRef.current=active.jobId\n    resumeActiveJob(active)\n  },[db.svgLibrary,db.orders])"
if(!motor.includes(modeOld))throw new Error('v25.0.81: no se encontró recuperación anterior del motor')
motor=motor.replace(modeOld,modeNew)
fs.writeFileSync(motorFile,motor)

const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
const marker='/* v25.0.81 · navegación fluida + rueda sidebar */'
if(css.includes(marker))throw new Error('v25.0.81: estilos duplicados')
css+=`\n${marker}\n.v2-shell .sidebar{overscroll-behavior:contain!important;scrollbar-gutter:stable!important}\n.v2-shell .v2-module-loader{min-height:180px;display:grid;place-items:center;align-content:center;gap:5px;color:#39445a}\n.v2-shell .v2-module-loader b{font-size:15px!important}\n.v2-shell .v2-module-loader span{font-size:12px!important;color:#8b96a8}\n.v2-shell .v2-page-loading{opacity:.88!important;filter:none!important}\n`
fs.writeFileSync(cssFile,css)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.81'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.81'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · navegación fluida + trabajo de placas persistente'")
fs.writeFileSync(versionFile,version)
const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.81-navigation-motor-resume'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.81-navigation-motor-resume'"))

if(!app.includes('navigationRef=useRef(0)')||!app.includes('onWheel={e=>')||!motor.includes("const resumeRef=useRef('')"))throw new Error('v25.0.81: validación final incompleta')
console.log('v25.0.81 FINALIZE OK · navegación sin boot repetido + sidebar wheel + recuperación segura del motor')
