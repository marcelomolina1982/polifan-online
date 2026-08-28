const GROUPS=[
  ['OPERACIÓN',['Inicio','Centro operativo']],
  ['PEDIDOS Y CLIENTES',['Pedidos','Presupuestos','Solicitudes web','Clientes']],
  ['PRODUCCIÓN',['Calendario','Para cortar','En corte','Generar placas','Biblioteca SVG','Inventario']],
  ['CATÁLOGO Y VENTAS',['Catálogo','Asistente del catálogo','Fotos y reseñas','Estadísticas']],
  ['FINANZAS',['Caja y gastos','Resumen mensual','Costos']],
  ['ADMINISTRACIÓN',['Configuración']],
]

const labelOf=button=>String(button?.textContent||'').replace(/^[^A-Za-zÁÉÍÓÚÑÜ0-9]+/,'').trim()

function ensurePrimaryAction(nav,buttons){
  const newOrder=buttons.find(b=>labelOf(b)==='Nuevo pedido')
  if(!newOrder)return
  newOrder.classList.add('v2-primary-new-order')
  if(newOrder.parentElement!==nav||nav.firstElementChild!==newOrder)nav.insertBefore(newOrder,nav.firstElementChild)
}

function applyNavigation(){
  const nav=document.querySelector('.sidebar nav')
  if(!nav)return
  const existing=[...nav.querySelectorAll('.nav-group')]
  const buttons=[...nav.querySelectorAll('button')]
  ensurePrimaryAction(nav,buttons)

  const byTitle=new Map(existing.map(group=>[String(group.querySelector('small')?.textContent||'').trim(),group]))
  const pool=existing.slice()
  GROUPS.forEach(([title,labels],index)=>{
    let group=byTitle.get(title)||pool[index]
    if(!group)return
    const heading=group.querySelector('small')
    if(heading)heading.textContent=title
    labels.forEach(label=>{
      const button=buttons.find(b=>labelOf(b)===label)
      if(button&&button!==nav.firstElementChild)group.appendChild(button)
    })
    nav.appendChild(group)
  })

  existing.forEach(group=>{
    const realButtons=[...group.querySelectorAll('button')].filter(b=>!b.classList.contains('v2-primary-new-order'))
    group.style.display=realButtons.length?'':'none'
  })
}

let scheduled=false
const schedule=()=>{
  if(scheduled)return
  scheduled=true
  requestAnimationFrame(()=>{scheduled=false;applyNavigation()})
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true})
else schedule()
new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true})
