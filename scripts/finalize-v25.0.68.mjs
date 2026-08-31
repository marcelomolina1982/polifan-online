import './finalize-v25.0.67.mjs'
import fs from 'node:fs'

function one(text,before,after,label){
  const count=text.split(before).length-1
  if(count!==1)throw new Error(`finalize-v25.0.68: ${label} aparece ${count} veces`)
  return text.replace(before,after)
}

const motorFile='src/pages/MotorDefinitivo.jsx'
let motor=fs.readFileSync(motorFile,'utf8')

// El certificador exige borde real de 3 mm en una placa 1230×580:
// área útil = 1224×574. Sparrow debe resolver exactamente dentro de esa área.
const payloadRx=/const payload=\{[^\n;]*kits:industrial\.kits[^\n;]*\}/g
const payloadMatches=motor.match(payloadRx)||[]
if(payloadMatches.length!==1)throw new Error(`finalize-v25.0.68: payload del solver aparece ${payloadMatches.length} veces`)
let payload=payloadMatches[0]
if(!/widthCm:[0-9.]+/.test(payload)||!/heightCm:[0-9.]+/.test(payload))throw new Error('finalize-v25.0.68: payload sin dimensiones reconocibles')
payload=payload.replace(/widthCm:[0-9.]+/, 'widthCm:122.4').replace(/heightCm:[0-9.]+/, 'heightCm:57.4')
motor=motor.replace(payloadMatches[0],payload)

// Las coordenadas del solver son relativas al área útil. Al componer la placa
// completa, trasladamos todo +3 mm en X/Y para respetar el borde certificado.
motor=one(
  motor,
  "const x=Number(p.xCm||0)*10,y=Number(p.yCm||0)*10,angle=Number(p.angle||0)",
  "const x=3+Number(p.xCm||0)*10,y=3+Number(p.yCm||0)*10,angle=Number(p.angle||0)",
  'offset de borde de 3 mm'
)

// Conservamos telemetría real del resultado. El ancla corta es intencional:
// los preparadores anteriores agregan campos al plan y no debe romper el build.
motor=one(
  motor,
  "targetDensityReached:Boolean(data.targetDensityReached)",
  "engineName:String(data.engine||data.source||'Sparrow'),selectionStrategy:String(data.selectionStrategy||''),runtimeSolver:String(data.runtimeSolver?.qualname||data.runtimeSolver?.name||data.runtimeSolver?.module||''),attemptsCount:Array.isArray(data.attempts)?data.attempts.length:0,requiredGapMm:3,motorGapMm:3,targetDensityReached:Boolean(data.targetDensityReached)",
  'telemetría del motor'
)

// Texto coherente con la placa física/certificada actual.
motor=motor.replaceAll('1220 × 580 mm','1230 × 580 mm')
motor=motor.replaceAll('1214 mm útiles','1224 × 574 mm útiles')

// En móvil la tabla ancha cortaba columnas y el botón rosa. Reemplazamos sólo
// el resultado del motor por tarjetas fluidas; el resto de tablas de la app no se toca.
const tableRx=/<div className="panel table-wrap"><table><thead><tr><th>Placa<\/th>[\s\S]*?<\/tbody><\/table><\/div>/
const tableMatches=motor.match(tableRx)||[]
if(tableMatches.length!==1)throw new Error(`finalize-v25.0.68: tabla de resultados aparece ${tableMatches.length} veces`)
const cards=`<div className="motor-plan-grid">
      {plans.map(plan=>{const ok=okStatus(plan.status);const density=Number(plan.density);const hasDensity=Number.isFinite(density)&&density>0;const used=Number(plan.stripWidthMm);const widthPct=Number.isFinite(used)&&used>0?Math.min(100,used/1230*100):null;const freeRight=Number.isFinite(used)&&used>0?Math.max(0,1230-used):null;return <section className="motor-plan-card" key={plan.id}>
        <div className="motor-plan-head"><div><b>Placa {plan.number}</b><small>Modo: {Number(plan.multiplier||1)===2?'DOBLE ×2':'SIMPLE ×1'} · entrega {plan.date}</small></div><b className={ok?'motor-cert-ok':'motor-cert-bad'}>{plan.status}</b></div>
        {plan.error&&<div className="motor-plan-error">{plan.error}</div>}
        <div className="motor-plan-summary"><b>{plan.units.length} diseños · hasta {plan.units.length*Number(plan.multiplier||1)} cortes completos</b><span>{plan.deferred} quedan pendientes</span><p>{plan.summary.map(x=>\`${x.figure} × ${x.qty}${Number(plan.multiplier||1)===2?' (sale ×'+(x.qty*2)+')':''}\`).join(', ')||'-'}</p></div>
        <div className="motor-plan-stats">
          <div><small>Gap certificado</small><b>{plan.minGap} mm</b></div>
          <div><small>Conflictos</small><b className={Number(plan.conflicts)===0?'green-text':'red-text'}>{plan.conflicts}</b></div>
          <div><small>Fuera de placa</small><b className={Number(plan.border)===0?'green-text':'red-text'}>{plan.border}</b></div>
          <div><small>Aprovechamiento</small><b>{hasDensity?density.toFixed(1)+'% área':widthPct!==null?widthPct.toFixed(1)+'% ancho':'-'}</b></div>
        </div>
        <div className="motor-plan-tech">
          <span><b>Motor:</b> {plan.engineName||plan.source||'Sparrow'}</span>
          <span><b>Estrategia:</b> {plan.selectionStrategy||plan.source||'-'}</span>
          <span><b>Runtime:</b> {Number(plan.industrialSeconds)>0?Number(plan.industrialSeconds).toFixed(1)+' s':'-'}</span>
          <span><b>Intentos:</b> {Number(plan.attemptsCount)>0?plan.attemptsCount:'-'}</span>
          <span><b>Gap motor:</b> {Number(plan.motorGapMm||3).toFixed(1)} mm · requerido: {Number(plan.requiredGapMm||3).toFixed(1)} mm</span>
          <span><b>Rotación:</b> {plan.rotationStep||'-'}</span>
          {Number.isFinite(used)&&used>0&&<span><b>Ancho usado:</b> {used.toFixed(0)} / 1230 mm · libre derecho: {freeRight.toFixed(0)} mm</span>}
          {plan.runtimeSolver&&<span><b>Runtime solver:</b> {plan.runtimeSolver}</span>}
        </div>
        <div className="motor-plan-actions">{ok&&plan.svgText&&<button className="ghost" onClick={()=>downloadSvg(\`pedido-${today()}-placa-${plan.number}\`,plan.svgText)}>Descargar SVG</button>}{ok&&!plan.registered&&<button className="primary" onClick={()=>registerPlan(plan)}>Registrar corte terminado</button>}{plan.registered&&<span className="green-text"><b>Terminada #{plan.batchNumber}</b></span>}</div>
      </section>})}
      {!plans.length&&<div className="panel">Tocá “Generar una placa”. Primero te pregunta SIMPLE o DOBLE y, si hay una recarga, retoma automáticamente el trabajo activo.</div>}
    </div>`
motor=motor.replace(tableRx,cards)

if(!motor.includes('widthCm:122.4')||!motor.includes('heightCm:57.4'))throw new Error('No quedó área útil 1224×574')
if(!motor.includes('const x=3+Number(p.xCm||0)*10,y=3+Number(p.yCm||0)*10'))throw new Error('No quedó offset de borde')
if(!motor.includes('attemptsCount:Array.isArray(data.attempts)'))throw new Error('No quedó telemetría real del motor')
if(!motor.includes('className="motor-plan-grid"'))throw new Error('No quedó layout móvil de resultados')
fs.writeFileSync(motorFile,motor)

// Hotfix encapsulado del Motor: nada puede ensanchar la pantalla del celular.
const cssFile='src/v2-mobile-hotfix.css'
let css=fs.readFileSync(cssFile,'utf8')
css+=`\n/* v25.0.69 · resultados del Motor sin overflow + telemetría legible */
.v2-shell,.v2-shell .content,.v2-shell .content>main{min-width:0;max-width:100%}.v2-shell .content>main{overflow-x:hidden}
.motor-plan-grid{display:grid;gap:16px;min-width:0;max-width:100%}.motor-plan-card{min-width:0;max-width:100%;overflow:hidden;background:#fff;border:1px solid #e6eaf0;border-radius:20px;padding:18px;box-shadow:0 8px 24px rgba(38,53,72,.055)}
.motor-plan-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;min-width:0}.motor-plan-head>div{min-width:0;display:grid;gap:4px}.motor-plan-head>div>b{font-size:20px;color:#263548}.motor-plan-head small{color:#7d8999;overflow-wrap:anywhere}.motor-cert-ok,.motor-cert-bad{flex:0 0 auto;font-size:13px;border-radius:999px;padding:7px 10px}.motor-cert-ok{background:#eaf8f1;color:#23835a}.motor-cert-bad{background:#fff0f2;color:#b82f49}
.motor-plan-error{margin-top:12px;padding:11px 12px;border-radius:12px;background:#fff3f5;color:#a92f46;overflow-wrap:anywhere}.motor-plan-summary{display:grid;gap:6px;margin-top:16px;min-width:0}.motor-plan-summary>b{color:#263548}.motor-plan-summary>span{color:#7d8999}.motor-plan-summary p{margin:4px 0 0;line-height:1.45;color:#465468;overflow-wrap:anywhere;word-break:break-word}
.motor-plan-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:16px}.motor-plan-stats>div{min-width:0;background:#f7f9fc;border:1px solid #edf0f4;border-radius:14px;padding:12px}.motor-plan-stats small{display:block;color:#7d8999;margin-bottom:4px}.motor-plan-stats b{color:#263548;overflow-wrap:anywhere}.motor-plan-tech{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 14px;margin-top:16px;padding-top:14px;border-top:1px solid #edf0f4;color:#667386;font-size:13px}.motor-plan-tech span{min-width:0;overflow-wrap:anywhere}.motor-plan-tech b{color:#39495d}.motor-plan-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;min-width:0}.motor-plan-actions button{min-width:0;max-width:100%}
@media(max-width:760px){.motor-plan-card{padding:14px;border-radius:16px}.motor-plan-head{align-items:flex-start}.motor-plan-head>div>b{font-size:18px}.motor-plan-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.motor-plan-tech{grid-template-columns:1fr}.motor-plan-actions{display:grid;grid-template-columns:1fr}.motor-plan-actions button{width:100%!important;max-width:100%!important;white-space:normal!important}.motor-plan-summary p{font-size:14px}.v2-shell .panel{min-width:0;max-width:100%}}
`
fs.writeFileSync(cssFile,css)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.69'")
  .replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.69'")
  .replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · Motor móvil corregido + telemetría real'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.69'"))
const indexFile='index.html'
fs.writeFileSync(indexFile,fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.69'"))

console.log('v25.0.69 FINALIZE OK · Motor responsive · sin 0.0% falso · telemetría real · placa 1230×580')