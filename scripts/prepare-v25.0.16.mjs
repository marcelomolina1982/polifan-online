import fs from 'node:fs'

const file='src/pages/MotorDefinitivo.jsx'
let text=fs.readFileSync(file,'utf8')

function patch(oldText,newText,label){
  if(text.includes(newText)) return
  if(!text.includes(oldText)) throw new Error(`v25.0.16 patch: no se encontró ${label}`)
  text=text.replace(oldText,newText)
}

// Nueva prueba = nuevo almacenamiento. No reutilizar una placa o trabajo V1.7 guardado.
patch("const LAB_STORAGE='polifan-motor-lab-last-plan-v3'","const LAB_STORAGE='polifan-motor-lab-last-plan-v4-sparrow-v18'",'LAB_STORAGE')
patch("const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v1'","const ACTIVE_JOB_STORAGE='polifan-motor-lab-active-job-v2-sparrow-v18'",'ACTIVE_JOB_STORAGE')

patch("V1.7 certificando…","V1.8 certificando…",'texto de certificación')
patch("const payload={widthCm:121.4,heightCm:58,gapCm:.3,targetDensity:75,kits:industrial.kits}","const payload={widthCm:122,heightCm:58,gapCm:.25,targetDensity:70,kits:industrial.kits}",'payload Sparrow')
patch("Sparrow + V1.7 · ${plan.units.length} diseños","Sparrow V1.8 · ${plan.units.length} diseños",'nota de placa')
patch('Generar placas · Motor Sparrow + Certificador V1.7','Generar placas · Sparrow V1.8 · Objetivo 70%','título')
patch('La placa real es 1220 × 580 mm. Sparrow diseña dentro de 1214 mm útiles para reservar 3 mm a cada lateral.','La placa real es 1220 × 580 mm. Sparrow V1.8 diseña dentro de 1214 × 574 mm útiles para reservar 3 mm en los cuatro bordes.','aviso de borde')
patch('objetivo ≥75%, sin descartar 11/12 válidas','objetivo ≥70% · gap mínimo 2,5 mm · crecer 11/12/13/14 mientras entre','criterio productivo')
patch('Sparrow asíncrono · V1.7 certifica','Sparrow V1.8 · 2,5 mm · borde 3 mm','arquitectura')
patch("plan.density>=75?'green-text':''","plan.density>=70?'green-text':''",'umbral de color')
patch("plan.density>=75?'Objetivo ≥75% alcanzado':'Mejor placa válida encontrada'","plan.density>=70?'Objetivo ≥70% alcanzado':'Mejor placa válida encontrada'",'umbral visible')

fs.writeFileSync(file,text)
console.log('v25.0.16: MotorDefinitivo preparado como Sparrow V1.8 / objetivo 70% / gap 2.5 mm')
