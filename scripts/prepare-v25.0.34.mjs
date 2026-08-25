import './prepare-v25.0.26.mjs'
import fs from 'node:fs'

const file='src/pages/Stock.jsx'
let text=fs.readFileSync(file,'utf8')

function replaceExact(oldText,newText,label){
  if(text.includes(newText)) return
  if(!text.includes(oldText)) throw new Error(`v25.0.34: no se encontró ${label}`)
  text=text.replace(oldText,newText)
}

// El recuento físico del 14/08 era una migración puntual. Nunca debe volver a
// ejecutarse automáticamente al abrir Inventario porque puede pisar el stock actual.
replaceExact(
  "if(!db||!onSave||db.inventoryRecount?.id===RECOUNT_ID||applyingRef.current)return",
  "if(true)return // v25.0.34: auto-recuento histórico 14/08 desactivado definitivamente",
  'auto-recuento 14/08'
)

// Tampoco ejecutar automáticamente el cierre asociado a ese recuento histórico.
replaceExact(
  "if(!db||!onSave||db.inventoryRecount?.id!==RECOUNT_ID||db.inventoryRecountCloseout?.id===CLOSEOUT_ID||closeoutRef.current)return",
  "if(true)return // v25.0.34: auto-cierre histórico 14/08 desactivado definitivamente",
  'auto-cierre 14/08'
)

// Quitar los avisos de migración vieja para que Inventario muestre únicamente
// el stock real calculado con los movimientos vigentes.
text=text.replace("{recountStatus!=='applied'&&<div className=\"notice\">","{false&&<div className=\"notice\">")
text=text.replace("{recountStatus==='applied'&&<div className=\"notice\">","{false&&<div className=\"notice\">")

fs.writeFileSync(file,text)
console.log('v25.0.34: recuento/cierre 14-08 desactivados; inventario actual protegido')
