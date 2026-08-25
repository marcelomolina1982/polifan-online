import './prepare-v25.0.42.mjs'
import fs from 'node:fs'

// v25.0.43: permitir registrar rápidamente una figura agregada manualmente al SVG.
// Al hacerlo, se actualiza el contenido de la placa y, si ya está terminada,
// también se agrega el movimiento de inventario correspondiente. Así "Para cortar"
// descuenta la figura extra inmediatamente.
const cutsFile='src/pages/CutBatches.jsx'
let cuts=fs.readFileSync(cutsFile,'utf8')

const stateNeedle="  const [editing,setEditing]=useState(null)\n  const autoFinishRef=useRef(false)"
const stateReplacement="  const [editing,setEditing]=useState(null)\n  const [extraBatch,setExtraBatch]=useState(null)\n  const [extraFigure,setExtraFigure]=useState('')\n  const [extraQty,setExtraQty]=useState(1)\n  const autoFinishRef=useRef(false)"
if(cuts.includes(stateNeedle)) cuts=cuts.replace(stateNeedle,stateReplacement)
else if(!cuts.includes('const [extraBatch,setExtraBatch]')) throw new Error('v25.0.43: no se pudo agregar estado de figura extra')

const fnNeedle="  function edit(batch){\n    setEditing(batch)"
const fnReplacement=`  async function addExtraToBatch(){
    const batch=extraBatch
    const raw=String(extraFigure||'').trim()
    const qty=Math.max(1,Number(extraQty)||1)
    if(!batch)return
    if(!raw)return alert('Elegí la figura que agregaste manualmente al SVG.')
    const figure=sortedFigures.find(f=>f.localeCompare(raw,'es',{sensitivity:'base'})===0)
    if(!figure)return alert('No encontré esa figura en el sistema. Elegila de la lista para que Inventario y Para cortar la reconozcan correctamente.')

    const items=(batch.items||[]).map(i=>({...i}))
    const existing=items.find(i=>String(i.figure||'').localeCompare(figure,'es',{sensitivity:'base'})===0&&(i.component||'complete')==='complete')
    if(existing)existing.qty=Number(existing.qty||0)+qty
    else items.push({figure,component:'complete',qty})

    const updated={...batch,items,updatedAt:new Date().toISOString()}
    const cutBatches=(db.cutBatches||[]).map(b=>b.id===batch.id?updated:b)
    let movements=[...(db.movements||[])]
    if(batch.status==='Terminada'){
      const movement=movementForItem(batch,{figure,component:'complete',qty},1,'Figura extra agregada manualmente al SVG')
      if(movement)movements.push(movement)
    }
    const saved=await onSave({...db,__onlyKeys:['movements','cutBatches'],movements,cutBatches})
    if(saved?.ok===false)return
    setExtraBatch(null);setExtraFigure('');setExtraQty(1)
  }

  function openExtra(batch){
    setExtraBatch(batch);setExtraFigure('');setExtraQty(1)
    setTimeout(()=>document.getElementById('extra-figure-input')?.focus(),0)
  }

  function edit(batch){
    setEditing(batch)`
if(cuts.includes(fnNeedle)) cuts=cuts.replace(fnNeedle,fnReplacement)
else if(!cuts.includes('async function addExtraToBatch()')) throw new Error('v25.0.43: no se pudo agregar función de figura extra')

const panelNeedle="    <div className=\"panel table-wrap\"><table>"
const panelReplacement=`    {extraBatch&&<div className="panel" style={{border:'2px solid #7c3aed'}}>
      <div className="panel-heading"><div><h3>＋ Figura extra en placa #{extraBatch.number}</h3><small>Usalo cuando agregaste una figura manualmente al SVG. La app actualizará la placa, Inventario y Para cortar.</small></div></div>
      <div className="form-grid">
        <Field label="Figura"><input id="extra-figure-input" list="extra-cut-figures" placeholder="Buscar figura" value={extraFigure} onChange={e=>setExtraFigure(e.target.value)}/><datalist id="extra-cut-figures">{sortedFigures.map(f=><option key={f} value={f}/>)}</datalist></Field>
        <Field label="Cantidad"><input type="number" min="1" value={extraQty} onChange={e=>setExtraQty(e.target.value)}/></Field>
      </div>
      <div className="actions"><button type="button" className="primary" onClick={addExtraToBatch}>Registrar figura extra</button><button type="button" className="ghost" onClick={()=>{setExtraBatch(null);setExtraFigure('');setExtraQty(1)}}>Cancelar</button></div>
    </div>}
    <div className="panel table-wrap"><table>`
if(cuts.includes(panelNeedle)) cuts=cuts.replace(panelNeedle,panelReplacement)
else if(!cuts.includes('Figura extra en placa #')) throw new Error('v25.0.43: no se pudo agregar panel de figura extra')

const actionsOld="{b.status==='En corte'&&<><button className=\"primary\" onClick={()=>finish(b)}>Terminar</button><button className=\"ghost\" onClick={()=>edit(b)}>Modificar</button><button className=\"danger\" onClick={()=>cancel(b)}>Cancelar</button></>}{b.status==='Terminada'&&<><button className=\"ghost\" onClick={()=>edit(b)}>Modificar</button><button className=\"danger\" onClick={()=>cancel(b)}>Anular corte</button></>}"
const actionsNew="{b.status==='En corte'&&<><button className=\"primary\" onClick={()=>finish(b)}>Terminar</button><button className=\"ghost\" onClick={()=>openExtra(b)}>＋ Extra</button><button className=\"ghost\" onClick={()=>edit(b)}>Modificar</button><button className=\"danger\" onClick={()=>cancel(b)}>Cancelar</button></>}{b.status==='Terminada'&&<><button className=\"primary\" onClick={()=>openExtra(b)}>＋ Extra</button><button className=\"ghost\" onClick={()=>edit(b)}>Modificar</button><button className=\"danger\" onClick={()=>cancel(b)}>Anular corte</button></>}"
if(cuts.includes(actionsOld)) cuts=cuts.replace(actionsOld,actionsNew)
else if(!cuts.includes('onClick={()=>openExtra(b)}')) throw new Error('v25.0.43: no se pudo agregar botón Extra')

fs.writeFileSync(cutsFile,cuts)

const versionFile='src/version.js'
let version=fs.readFileSync(versionFile,'utf8')
version=version.replace(/APP_VERSION='[^']*'/,"APP_VERSION='25.0.43'")
version=version.replace(/APP_VERSION_LABEL='[^']*'/,"APP_VERSION_LABEL='v25.0.43'")
version=version.replace(/APP_VERSION_NAME='[^']*'/,"APP_VERSION_NAME='Polifan 25 · figura extra manual sincronizada con Inventario y Para cortar'")
fs.writeFileSync(versionFile,version)

const swFile='public/sw.js'
let sw=fs.readFileSync(swFile,'utf8').replace(/SW_VERSION='[^']*'/,"SW_VERSION='25.0.43'")
fs.writeFileSync(swFile,sw)

const indexFile='index.html'
let index=fs.readFileSync(indexFile,'utf8').replace(/const build='[^']*'/,"const build='25.0.43'")
fs.writeFileSync(indexFile,index)

console.log('v25.0.43: botón + Extra registra figuras agregadas manualmente al SVG y actualiza Para cortar')
