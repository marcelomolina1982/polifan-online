import React, { useMemo, useState } from 'react'
import { Title } from '../components/UI'

function downloadSvg(name,text){
  if(!text)return
  const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}))
  const a=document.createElement('a')
  a.href=url
  a.download=String(name||'placa.svg').replace(/\.svg$/i,'')+'__CERTIFICADO_V1_7.svg'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function statusClass(status){
  return String(status||'').startsWith('CERTIFICADO')?'green-text':'red-text'
}

export default function MotorDefinitivo(){
  const [files,setFiles]=useState([])
  const [rows,setRows]=useState([])
  const [busy,setBusy]=useState(false)
  const [progress,setProgress]=useState('')
  const certified=useMemo(()=>rows.filter(r=>String(r.status||'').startsWith('CERTIFICADO')).length,[rows])

  async function run(){
    if(!files.length)return alert('Elegí uno o más SVG.')
    setBusy(true);setRows([])
    let next=[]
    try{
      for(let i=0;i<files.length;i++){
        const file=files[i]
        setProgress(`Procesando ${i+1}/${files.length}: ${file.name}`)
        const svgText=await file.text()
        try{
          const response=await fetch('/api/motor-definitivo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:file.name,svgText})})
          let data={};try{data=await response.json()}catch{}
          const row={id:`${file.name}-${i}`,fileName:file.name,status:data.status||`HTTP ${response.status}`,engine:data.engineVersion||data.engine||'V1.7',pieces:data.pieces??'-',searchGap:data.search_gap_used_mm??'-',rescueGap:data.rescue_search_gap_mm??null,minGap:data.validation?.min_gap_mm??data.min_gap_mm??'-',conflicts:data.validation?.conflicts??data.conflicts??'-',border:data.validation?.border_conflicts??data.border_conflicts??'-',seconds:data.seconds??'-',svgText:data.svgText||null,error:data.error||''}
          next=[...next,row];setRows(next)
        }catch(error){
          const row={id:`${file.name}-${i}`,fileName:file.name,status:'ERROR',engine:'V1.7',pieces:'-',searchGap:'-',rescueGap:null,minGap:'-',conflicts:'-',border:'-',seconds:'-',svgText:null,error:error.message}
          next=[...next,row];setRows(next)
        }
      }
    }finally{setBusy(false);setProgress('')}
  }

  return <>
    <Title title="Motor definitivo V1.7" sub="Motor certificado para placas 1220×580 mm. Solo permite descargar resultados con 0 conflictos, 0 borde y separación final mínima de 2,5 mm." actions={<label className="primary filebtn">Elegir SVG<input type="file" accept=".svg,image/svg+xml" multiple onChange={e=>setFiles([...e.target.files])}/></label>}/>
    <div className="notice"><b>Motor de producción activo · V1.7</b><span>La batería real terminó 7/7 certificada. El motor intenta 3 mm y nunca certifica una exportación por debajo de 2,5 mm.</span></div>
    <div className="panel">
      <div className="form-grid"><div><small>SVG seleccionados</small><b className="block big">{files.length}</b></div><div><small>Certificados</small><b className="block big green-text">{certified}</b></div><div><small>No certificados</small><b className="block big red-text">{rows.length-certified}</b></div><div><small>Estado</small><b className="block">{busy?'Calculando…':rows.length?'Proceso terminado':'Listo'}</b></div></div>
      <div className="actions"><button className="primary" disabled={busy||!files.length} onClick={run}>{busy?'Procesando…':'Certificar con V1.7'}</button><button className="ghost" disabled={busy} onClick={()=>{setFiles([]);setRows([]);setProgress('')}}>Limpiar</button></div>
      {progress&&<div className="notice" style={{marginTop:14,marginBottom:0}}><b>{progress}</b><span>No cierres esta pantalla mientras el solver está trabajando.</span></div>}
    </div>
    <div className="panel table-wrap"><table><thead><tr><th>Archivo</th><th>Estado</th><th>Piezas</th><th>Gap buscado</th><th>Gap certificado</th><th>Conflictos</th><th>Borde</th><th>Tiempo</th><th>Acción</th></tr></thead><tbody>
      {rows.map(row=>{const ok=String(row.status||'').startsWith('CERTIFICADO');return <tr key={row.id}><td><b>{row.fileName}</b><small className="block">Motor {row.engine}</small></td><td><b className={statusClass(row.status)}>{row.status}</b>{row.error&&<small className="block red-text">{row.error}</small>}</td><td>{row.pieces}</td><td>{row.searchGap} mm{row.rescueGap!=null&&<small className="block">rescate {row.rescueGap} mm</small>}</td><td><b>{row.minGap} mm</b></td><td className={Number(row.conflicts)===0?'green-text':'red-text'}>{row.conflicts}</td><td className={Number(row.border)===0?'green-text':'red-text'}>{row.border}</td><td>{row.seconds} s</td><td>{ok&&row.svgText?<button className="primary" onClick={()=>downloadSvg(row.fileName,row.svgText)}>Descargar SVG certificado</button>:<span className="red-text">No descargar</span>}</td></tr>})}
      {!rows.length&&<tr><td colSpan="9">Elegí uno o varios SVG y ejecutá la certificación V1.7.</td></tr>}
    </tbody></table></div>
  </>
}
