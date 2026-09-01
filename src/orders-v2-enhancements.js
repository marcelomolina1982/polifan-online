const isOrdersPage=()=>Boolean(document.querySelector('.request-tabs'))
const getSearch=()=>document.querySelector('.panel.filters input')
const closePrintMenus=()=>document.querySelectorAll('.print-center[open]').forEach(el=>el.removeAttribute('open'))
document.addEventListener('keydown',event=>{
  if(!isOrdersPage())return
  const target=event.target
  const typing=target&&['INPUT','TEXTAREA','SELECT'].includes(target.tagName)
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
    event.preventDefault();getSearch()?.focus();getSearch()?.select?.();return
  }
  if(!typing&&event.key==='/'){
    event.preventDefault();getSearch()?.focus();return
  }
  if(event.key==='Escape'){
    closePrintMenus();if(document.activeElement===getSearch())document.activeElement.blur()
  }
})
document.addEventListener('dblclick',event=>{
  if(!isOrdersPage())return
  const row=event.target.closest?.('.table-wrap tbody tr')
  if(!row||event.target.closest('button,select,input,details,summary'))return
  const edit=[...row.querySelectorAll('button')].find(btn=>btn.textContent.trim()==='Editar')
  edit?.click()
})
