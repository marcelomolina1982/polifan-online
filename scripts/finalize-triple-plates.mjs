import fs from 'node:fs'

function mustReplace(text,pattern,replacement,label){
  const next=text.replace(pattern,replacement)
  if(next===text)throw new Error(`triple plates: no se encontró ${label}`)
  return next
}

{
  const file='src/pages/MotorDefinitivo.jsx'
  let src=fs.readFileSync(file,'utf8')

  src=src.replaceAll("multiplier===2?'doble':'simple'","multiplier===3?'triple':multiplier===2?'doble':'simple'")
  src=src.replaceAll("multiplier===2?'PLACA DOBLE':'PLACA SIMPLE'","multiplier===3?'PLACA TRIPLE':multiplier===2?'PLACA DOBLE':'PLACA SIMPLE'")

  src=mustReplace(
    src,
    '<button className="primary" onClick={()=>generateAutomatic(2)}>Placa doble · ×2</button><button className="ghost" onClick={()=>setChoosingMode(false)}>Cancelar</button>',
    '<button className="primary" onClick={()=>generateAutomatic(2)}>Placa doble · ×2</button><button className="primary" onClick={()=>generateAutomatic(3)}>Placa triple · ×3</button><button className="ghost" onClick={()=>setChoosingMode(false)}>Cancelar</button>',
    'botón de placa triple'
  )

  src=src.replace('Ejemplo: si faltan 3 Minnie, en doble se diseñan 2; al cortar ×2 salen 4 y sobra sólo 1.','Ejemplo: si faltan 7 Minnie, en triple se diseñan 3; al cortar ×3 salen 9 y sobran 2.')
  src=src.replace("Number(plan.multiplier||1)===2?'DOBLE ×2':'SIMPLE ×1'","Number(plan.multiplier||1)===3?'TRIPLE ×3':Number(plan.multiplier||1)===2?'DOBLE ×2':'SIMPLE ×1'")
  src=src.replace("Number(plan.multiplier||1)===2?' (sale ×'+(x.qty*2)+')':''","Number(plan.multiplier||1)>1?' (sale ×'+(x.qty*Number(plan.multiplier||1))+')':''")
  src=src.replace('SIMPLE o DOBLE','SIMPLE, DOBLE o TRIPLE')

  if(!src.includes('generateAutomatic(3)'))throw new Error('triple plates: el Motor no ofrece ×3')
  if(!src.includes("TRIPLE ×3"))throw new Error('triple plates: el Motor no etiqueta ×3')
  fs.writeFileSync(file,src)
}

{
  const file='src/pages/CutBatches.jsx'
  let src=fs.readFileSync(file,'utf8')

  src=src.replaceAll("multiplier===2?'doble':'simple'","multiplier===3?'triple':multiplier===2?'doble':'simple'")
  src=src.replaceAll("(Number(b.multiplier)||1)===2?'doble':'simple'","(Number(b.multiplier)||1)===3?'triple':(Number(b.multiplier)||1)===2?'doble':'simple'")
  src=mustReplace(
    src,
    '<option value="1">Simple · 1 placa</option><option value="2">Doble · 2 placas iguales</option>',
    '<option value="1">Simple · 1 placa</option><option value="2">Doble · 2 placas iguales</option><option value="3">Triple · 3 placas iguales</option>',
    'opción triple en En corte'
  )

  if(!src.includes('<option value="3">Triple · 3 placas iguales</option>'))throw new Error('triple plates: En corte no admite ×3')
  fs.writeFileSync(file,src)
}

console.log('TRIPLE PLATES OK · generación ×3 · registro ×3 · inventario ×3 · etiquetas triple')
