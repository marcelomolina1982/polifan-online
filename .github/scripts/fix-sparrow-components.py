from pathlib import Path
p=Path('scripts/prepare-v25.0.25.mjs')
s=p.read_text()
marker="// COMPONENT_AWARE_SUMMARY_V13"
if marker not in s:
    extra=r'''

// COMPONENT_AWARE_SUMMARY_V13
// El plan ya conserva repairComponent desde V1.12. El resumen anterior agrupaba
// sólo por figura y hacía parecer una tapa/base como figura completa.
{
  const motorFile='src/pages/MotorDefinitivo.jsx'
  let motor=fs.readFileSync(motorFile,'utf8')
  const oldSummary=`function summarizeUnits(units){
  const m=new Map();units.forEach(u=>m.set(u.figure,(m.get(u.figure)||0)+1))
  return [...m.entries()].map(([figure,qty])=>({figure,qty}))
}`
  const newSummary=`function summarizeUnits(units){
  const m=new Map()
  units.forEach(u=>{
    const component=u.repairComponent||u.component||'complete'
    const key=normalizeFigureKey(u.figure)+'|'+component
    const row=m.get(key)||{figure:u.figure,component,qty:0}
    row.qty+=1;m.set(key,row)
  })
  return [...m.values()]
}`
  if(motor.includes(oldSummary))motor=motor.replace(oldSummary,newSummary)
  else if(!motor.includes("const component=u.repairComponent||u.component||'complete'"))throw new Error('v25.0.25 component summary: no se encontró summarizeUnits')

  const oldCell="{plan.summary.map(x=>`${x.figure} × ${x.qty}${Number(plan.multiplier||1)===2?' (sale ×'+(x.qty*2)+')':''}`).join(', ')||'-'}"
  const newCell="{plan.summary.map(x=>`${x.figure}${x.component&&x.component!=='complete'?' '+x.component.toUpperCase():' COMPLETO'} × ${x.qty} (sale ×${x.qty*Number(plan.multiplier||1)})`).join(', ')||'-'}"
  if(motor.includes(oldCell))motor=motor.replace(oldCell,newCell)
  else {
    // Versiones con triple ya preparadas por finalize: reemplazo tolerante del map visible.
    motor=motor.replace(/\{plan\.summary\.map\(x=>`\$\{x\.figure\}[^\n]+?\.join\(', '\)\|\|'-'\}/,
      "{plan.summary.map(x=>`${x.figure}${x.component&&x.component!=='complete'?' '+x.component.toUpperCase():' COMPLETO'} × ${x.qty} (sale ×${x.qty*Number(plan.multiplier||1)})`).join(', ')||'-'}")
  }
  motor=motor.replace(/\{plan\.units\.length\} diseños · hasta \{plan\.units\.length\*Number\(plan\.multiplier\|\|1\)\} cortes completos/,
    "{plan.units.length} diseños · hasta {plan.units.length*Number(plan.multiplier||1)} unidades de corte")
  fs.writeFileSync(motorFile,motor)
}
'''
    s += extra
    p.write_text(s)
