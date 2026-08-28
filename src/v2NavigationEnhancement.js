const GROUPS=[
  ['OPERACIÓN',['Inicio','Centro operativo']],
  ['PEDIDOS Y CLIENTES',['Pedidos','Presupuestos','Solicitudes web','Clientes']],
  ['PRODUCCIÓN',['Calendario','Para cortar','En corte','Generar placas','Biblioteca SVG','Inventario']],
  ['CATÁLOGO Y VENTAS',['Catálogo','Asistente del catálogo','Fotos y reseñas','Estadísticas']],
  ['FINANZAS',['Caja y gastos','Resumen mensual','Costos']],
  ['ADMINISTRACIÓN',['Configuración']],
]

const labelOf=button=>String(button?.textContent||'').replace(/^[^A-Za-zÁÉÍÓÚÑÜ0-9]+/,'').trim()
let observer=null

function ensurePrimaryAction(nav,buttons){
  const newOrder=buttons.find(b=>labelOf(b)==='Nuevo pedido')
  if(!newOrder)return
  newOrder.classList.add('v2-primary-new-order')
  if(newOrder.parentElement!==nav||nav.firstElementChild!==newOrder)nav.insertBefore(newOrder,nav.firstElementChild)
}

function makeGroup(title){
  const group=document.createElement('div')
  group.className='nav-group v2-nav-generated'
  const heading=document.createElement('small')
  heading.textContent=title
  group.appendChild(heading)
  return group
}

function applyNavigation(){
  const nav=document.querySelector('.sidebar nav')
  if(!nav)return
  observer?.disconnect()
  try{
    const existing=[...nav.querySelectorAll('.nav-group')]
    const buttons=[...nav.querySelectorAll('button')]
    ensurePrimaryAction(nav,buttons)

    const byTitle=new Map(existing.map(group=>[String(group.querySelector('small')?.textContent||'').trim(),group]))
    const claimed=new Set()
    const orderedGroups=[]
    GROUPS.forEach(([title,labels],index)=>{
      let group=byTitle.get(title)
      if(!group){
        group=existing.find((g,i)=>!claimed.has(g)&&i===index)||existing.find(g=>!claimed.has(g))||makeGroup(title)
      }
      claimed.add(group)
      const heading=group.querySelector('small')||group.insertBefore(document.createElement('small'),group.firstChild)
      heading.textContent=title
      labels.forEach(label=>{
        const button=buttons.find(b=>labelOf(b)===label)
        if(button)group.appendChild(button)
      })
      group.style.display=''
      orderedGroups.push(group)
    })

    existing.filter(g=>!claimed.has(g)).forEach(g=>g.remove())
    orderedGroups.forEach(group=>nav.appendChild(group))
  }finally{
    observer?.observe(document.documentElement,{subtree:true,childList:true})
  }
}

let scheduled=false
const schedule=()=>{
  if(scheduled)return
  scheduled=true
  requestAnimationFrame(()=>{scheduled=false;applyNavigation()})
}

observer=new MutationObserver(schedule)
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true})
else schedule()
observer.observe(document.documentElement,{subtree:true,childList:true})
