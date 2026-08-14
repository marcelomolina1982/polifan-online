import React,{useEffect} from 'react'
import WebRequests from './WebRequests'

function dayKeyFromText(text=''){
  const match=String(text).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if(!match)return ''
  const [,d,m,yRaw]=match
  const y=yRaw.length===2?`20${yRaw}`:yRaw
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
function labelForDay(key){
  if(!key)return 'Sin fecha'
  const [y,m,d]=key.split('-').map(Number)
  const date=new Date(y,m-1,d)
  const today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1)
  const same=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()
  if(same(date,today))return `HOY · ${date.toLocaleDateString('es-AR')}`
  if(same(date,yesterday))return `AYER · ${date.toLocaleDateString('es-AR')}`
  return date.toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}).toUpperCase()
}
function regroup(){
  document.querySelectorAll('.webrequests-grouped table tbody').forEach(tbody=>{
    tbody.querySelectorAll('tr.request-day-separator').forEach(row=>row.remove())
    let last=''
    ;[...tbody.querySelectorAll(':scope > tr')].forEach(row=>{
      const text=row.querySelector('td:first-child small.block')?.textContent||''
      const key=dayKeyFromText(text)
      if(key!==last){
        const sep=document.createElement('tr')
        sep.className='request-day-separator'
        const cell=document.createElement('td')
        cell.colSpan=7
        cell.textContent=labelForDay(key)
        sep.appendChild(cell)
        tbody.insertBefore(sep,row)
        last=key
      }
    })
  })
}

export default function WebRequestsGrouped(props){
  useEffect(()=>{
    regroup()
    const observer=new MutationObserver(()=>window.requestAnimationFrame(regroup))
    const root=document.querySelector('.webrequests-grouped')
    if(root)observer.observe(root,{subtree:true,childList:true,characterData:true})
    return()=>observer.disconnect()
  },[])
  return <div className="webrequests-grouped">
    <style>{`.request-day-separator td{background:#f3eefb!important;color:#4a2f8f;font-weight:900;letter-spacing:.3px;padding:12px 14px!important;border-top:18px solid #fff!important;border-bottom:1px solid #ddd!important}.request-day-separator:first-child td{border-top-width:0!important}`}</style>
    <WebRequests {...props}/>
  </div>
}
