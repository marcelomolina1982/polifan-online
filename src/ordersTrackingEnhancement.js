import { supabase } from './supabase'

const BUTTON_MARK='data-tracking-order'

function orderNumberFromRow(row){
  const cell=row?.children?.[1]
  return String(cell?.textContent||'').replace('#','').trim()
}

async function openTracking(orderNumber,button){
  if(!orderNumber)return
  const oldText=button.textContent
  button.disabled=true
  button.textContent='Abriendo…'
  try{
    const {data,error}=await supabase.rpc('get_order_tracking_admin_by_number',{p_order_number:orderNumber})
    if(error)throw error
    const row=Array.isArray(data)?data[0]:data
    if(!row?.token){
      alert(`El pedido #${orderNumber} no tiene un seguimiento activo disponible.`)
      return
    }
    const url=`${window.location.origin}/p/${encodeURIComponent(row.token)}`
    window.open(url,'_blank','noopener,noreferrer')
  }catch(error){
    console.error('No se pudo abrir el seguimiento',error)
    alert('No se pudo obtener el enlace de seguimiento. Recargá la sección e intentá nuevamente.')
  }finally{
    button.disabled=false
    button.textContent=oldText
  }
}

function enhanceOrdersTable(){
  document.querySelectorAll('td.row-actions').forEach(actions=>{
    if(actions.querySelector(`[${BUTTON_MARK}]`))return
    const row=actions.closest('tr')
    const orderNumber=orderNumberFromRow(row)
    if(!orderNumber)return

    const button=document.createElement('button')
    button.className='ghost'
    button.type='button'
    button.textContent='Seguimiento'
    button.setAttribute(BUTTON_MARK,orderNumber)
    button.title=`Abrir seguimiento público del pedido #${orderNumber}`
    button.addEventListener('click',()=>openTracking(orderNumber,button))

    const editButton=[...actions.querySelectorAll('button')].find(el=>el.textContent?.trim()==='Editar')
    if(editButton)actions.insertBefore(button,editButton)
    else actions.appendChild(button)
  })
}

let queued=false
function scheduleEnhance(){
  if(queued)return
  queued=true
  requestAnimationFrame(()=>{
    queued=false
    enhanceOrdersTable()
  })
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleEnhance,{once:true})
else scheduleEnhance()

const observer=new MutationObserver(scheduleEnhance)
observer.observe(document.documentElement,{childList:true,subtree:true})
