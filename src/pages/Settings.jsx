import React, { useEffect, useMemo, useState } from 'react'
import { Title } from '../components/UI'
import { emptyState } from '../lib/constants'
import { today } from '../lib/format'
import { APP_VERSION_LABEL, APP_UPDATED_AT } from '../version'
import {createAppBackup,listLocalBackups,listCloudBackups,restoreCloudBackup} from '../supabase'

export default function Settings({db,onSave}){
  const [newFigures,setNewFigures]=useState(()=>localStorage.getItem('polifan-new-figures-draft')||'')
  const [search,setSearch]=useState('')
  const [customerSettings,setCustomerSettings]=useState(()=>({whatsapp:db.customerSettings?.whatsapp||'',businessName:db.customerSettings?.businessName||'Tu Vida En Tinta'}))
  const [backups,setBackups]=useState([])
  const [backupStatus,setBackupStatus]=useState('')
  const [cloudAvailable,setCloudAvailable]=useState(true)
  useEffect(()=>{localStorage.setItem('polifan-new-figures-draft',newFigures)},[newFigures])
  useEffect(()=>{refreshBackups()},[])
  const sortedFigures=useMemo(()=>[...(db.figures||[])].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})),[db.figures])
  const visibleFigures=sortedFigures.filter(f=>f.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))

  async function refreshBackups(){
    const local=listLocalBackups().map(x=>({...x,source:'Local'}))
    const cloud=await listCloudBackups()
    setCloudAvailable(cloud.ok)
    const merged=[...(cloud.items||[]).map(x=>({...x,source:'Supabase'})),...local]
    const seen=new Set();setBackups(merged.filter(x=>{const key=`${x.createdAt}-${x.summary?.orders||0}-${x.source}`;if(seen.has(key))return false;seen.add(key);return true}).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,40))
  }
  async function manualBackup(){
    setBackupStatus('Creando respaldo…')
    const result=await createAppBackup(db,'manual')
    setBackupStatus(result.cloud?.ok?'Respaldo guardado en Supabase y en esta computadora.':'Respaldo guardado en esta computadora. Supabase no aceptó la copia remota.')
    await refreshBackups()
  }
  function downloadBackup(item){
    const state=item.state||db
    const clean={...state};delete clean.__backupMeta
    const blob=new Blob([JSON.stringify(clean,null,2)],{type:'application/json'})
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`respaldo-polifan-${String(item.createdAt||today()).replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)
  }
  async function restoreBackup(item){
    const ok=window.confirm(`¿Restaurar este respaldo?\n\nFecha: ${new Date(item.createdAt).toLocaleString('es-AR')}\nPedidos: ${item.summary?.orders||0}\n\nAntes de restaurar se guardará automáticamente una copia del estado actual.`)
    if(!ok)return
    let state=item.state
    if(item.source==='Supabase'&&!state){const result=await restoreCloudBackup(item.id);if(!result.ok)return alert('No se pudo abrir el respaldo remoto.');state=result.state}
    if(!state)return alert('Ese respaldo no contiene datos recuperables.')
    const clean={...state};delete clean.__backupMeta
    const saved=await onSave({...emptyState(),...clean})
    if(saved?.ok===false)return
    alert('Respaldo restaurado correctamente.')
    await refreshBackups()
  }

  async function saveCustomerSettings(){
    const whatsapp=customerSettings.whatsapp.replace(/\D/g,'')
    if(!whatsapp)return alert('Ingresá el número de WhatsApp con código de país y área.')
    await onSave({...db,customerSettings:{...customerSettings,whatsapp}})
    setCustomerSettings(v=>({...v,whatsapp}))
    alert('Datos del catálogo guardados.')
  }
  function customerLink(){const whatsapp=(customerSettings.whatsapp||db.customerSettings?.whatsapp||'').replace(/\D/g,'');return `${window.location.origin}${window.location.pathname}?pedido=1${whatsapp?`&w=${whatsapp}`:''}#pedido`}
  async function copyCustomerLink(){const link=customerLink();try{await navigator.clipboard.writeText(link);alert('Enlace copiado. Ya podés enviarlo a tus clientes.')}catch{window.prompt('Copiá este enlace:',link)}}

  function exportData(){const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='respaldo-polifan-'+today()+'.json';a.click()}
  async function importData(e){const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());await onSave({...emptyState(),...data});alert('Copia importada.')}catch{alert('Archivo inválido.')}}
  async function addFigures(){
    const candidates=newFigures.split(/[\n,;]+/).map(f=>f.trim()).filter(Boolean)
    if(!candidates.length)return alert('Escribí al menos un nombre.')
    const existing=new Set((db.figures||[]).map(f=>f.toLocaleLowerCase('es'))),added=[]
    for(const name of candidates){const key=name.toLocaleLowerCase('es');if(!existing.has(key)){existing.add(key);added.push(name)}}
    if(!added.length)return alert('Todos esos productos ya existen.')
    const figures=[...(db.figures||[]),...added].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))
    await onSave({...db,figures});setNewFigures('');localStorage.removeItem('polifan-new-figures-draft');alert(`${added.length} producto${added.length===1?' agregado':'s agregados'}.`)
  }
  async function editFigure(oldName){
    const newName=window.prompt('Nuevo nombre del producto:',oldName)?.trim();if(!newName||newName===oldName)return
    const duplicate=(db.figures||[]).some(f=>f!==oldName&&f.localeCompare(newName,'es',{sensitivity:'base'})===0);if(duplicate)return alert('Ya existe un producto con ese nombre.')
    const figures=(db.figures||[]).map(f=>f===oldName?newName:f).sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))
    const orders=(db.orders||[]).map(order=>({...order,items:(order.items||[]).map(item=>item.figure===oldName?{...item,figure:newName}:item)}))
    const movements=(db.movements||[]).map(m=>m.figure===oldName?{...m,figure:newName}:m),stockMin={...(db.stockMin||{})}
    if(Object.prototype.hasOwnProperty.call(stockMin,oldName)){stockMin[newName]=stockMin[oldName];delete stockMin[oldName]}
    await onSave({...db,figures,orders,movements,stockMin})
  }
  async function resetTests(){
    const first=window.confirm('¿Borrar todos los pedidos, movimientos y placas de prueba? El catálogo y los clientes se conservarán.');if(!first)return
    const word=window.prompt('Para confirmar, escribí BORRAR');if(word!=='BORRAR')return alert('No se borró nada.')
    await createAppBackup(db,'antes de borrar datos de prueba')
    await onSave({...db,orders:[],movements:[],cutBatches:[],stockMin:{}});localStorage.removeItem('polifan-order-draft-v1');alert('Datos de prueba eliminados. El próximo pedido comenzará nuevamente desde 001.')
  }
  async function deleteFigure(name){const ok=window.confirm(`¿Eliminar “${name}” del catálogo?\n\nLos pedidos anteriores conservarán ese nombre.`);if(!ok)return;const figures=(db.figures||[]).filter(f=>f!==name),stockMin={...(db.stockMin||{})};delete stockMin[name];await onSave({...db,figures,stockMin})}

  return <>
    <Title title="Datos y copias" sub="Administrá el catálogo, descargá copias y restaurá respaldos automáticos."/>
    <div className="panel system-version-panel"><h3>Información del sistema</h3><div className="customer-grid"><div><small>Versión instalada</small><b>Versión {APP_VERSION_LABEL}</b></div><div><small>Última actualización</small><b>{APP_UPDATED_AT}</b></div><div><small>Zona horaria</small><b>Argentina · UTC-3</b></div></div><p>El número mostrado en toda la aplicación se obtiene de un único archivo central para evitar versiones antiguas o diferentes.</p></div>

    <div className="panel" style={{border:'2px solid #b7e4c7'}}>
      <div className="panel-heading"><div><h3>🛡️ Respaldos automáticos</h3><small>Antes de cada guardado importante se crea una copia. Se conservan hasta 30 copias locales y, cuando Supabase lo permite, también copias remotas.</small></div><button className="primary" onClick={manualBackup}>Crear respaldo ahora</button></div>
      {backupStatus&&<p><b>{backupStatus}</b></p>}
      <div className="customer-grid" style={{marginTop:12}}><div><small>Pedidos actuales</small><b>{db.orders?.length||0}</b></div><div><small>Copias disponibles</small><b>{backups.length}</b></div><div><small>Respaldo remoto</small><b>{cloudAvailable?'Activo':'No disponible · usando copia local'}</b></div></div>
      <div className="table-wrap" style={{marginTop:14}}><table><thead><tr><th>Fecha</th><th>Origen</th><th>Pedidos</th><th>Clientes</th><th>Presupuestos</th><th>Acciones</th></tr></thead><tbody>{backups.slice(0,12).map((b,i)=><tr key={`${b.id||b.createdAt}-${i}`}><td>{b.createdAt?new Date(b.createdAt).toLocaleString('es-AR'):'-'}</td><td>{b.source}</td><td><b>{b.summary?.orders||0}</b></td><td>{b.summary?.clients||0}</td><td>{b.summary?.quotes||0}</td><td><div className="actions"><button className="ghost smallbtn" onClick={()=>downloadBackup(b)}>Descargar</button><button className="danger smallbtn" onClick={()=>restoreBackup(b)}>Restaurar</button></div></td></tr>)}{!backups.length&&<tr><td colSpan="6">Todavía no hay respaldos. Creá uno ahora; luego se harán automáticamente antes de los guardados.</td></tr>}</tbody></table></div>
      <p style={{marginTop:10}}><b>Protección contra borrado accidental:</b> si Supabase devuelve 0 pedidos y esta computadora conserva una copia válida con pedidos, la app mantiene la copia segura en lugar de aceptar el estado vacío.</p>
    </div>

    <div className="panel customer-settings-panel"><h3>Pedidos por WhatsApp</h3><p>Configurá el número que recibirá las solicitudes. Usá código de país sin el signo +. Para Argentina: 54 + código de área + número, sin 0 ni 15.</p><div className="customer-grid"><label>Nombre del negocio<input value={customerSettings.businessName} onChange={e=>setCustomerSettings(v=>({...v,businessName:e.target.value}))} placeholder="Tu Vida En Tinta"/></label><label>WhatsApp del negocio<input inputMode="tel" value={customerSettings.whatsapp} onChange={e=>setCustomerSettings(v=>({...v,whatsapp:e.target.value}))} placeholder="Ej.: 541126255191"/></label></div><div className="actions"><button className="primary" onClick={saveCustomerSettings}>Guardar configuración</button><button className="ghost" onClick={copyCustomerLink}>Copiar enlace para clientes</button><a className="ghost button-link" href={customerLink()} target="_blank" rel="noreferrer">Ver catálogo</a></div><small className="share-link">{customerLink()}</small></div>
    <div className="grid2"><div className="panel"><h3>Copias manuales</h3><p>También podés descargar un archivo JSON completo o importar una copia anterior.</p><div className="actions"><button className="primary" onClick={exportData}>Descargar copia</button><label className="ghost filebtn">Importar copia<input type="file" accept=".json" onChange={importData}/></label><button className="danger" onClick={resetTests}>Borrar datos de prueba</button></div></div><div className="panel"><h3>Agregar uno o varios productos</h3><p>Escribí un nombre por línea. También podés separarlos con coma.</p><textarea value={newFigures} onChange={e=>setNewFigures(e.target.value)} placeholder={'Ejemplo:\nCorazón grande\nMariposa\nNúmero 15'}/><button className="primary full" onClick={addFigures}>Agregar productos</button></div></div>
    <div className="panel"><h3>Catálogo de figuras ({db.figures.length})</h3><input type="search" placeholder="🔍 Buscar producto..." value={search} onChange={e=>setSearch(e.target.value)}/><div className="catalog-list">{visibleFigures.map(f=><div className="catalog-row" key={f}><span>{f}</span><div className="row-actions"><button className="ghost smallbtn" onClick={()=>editFigure(f)}>Editar</button><button className="danger smallbtn" onClick={()=>deleteFigure(f)}>Eliminar</button></div></div>)}</div>{!visibleFigures.length&&<p>No se encontraron productos.</p>}</div>
  </>
}
