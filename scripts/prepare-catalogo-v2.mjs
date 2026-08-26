import './prepare-v25.0.49.mjs'
import fs from 'node:fs'

const file='src/App.jsx'
let text=fs.readFileSync(file,'utf8')

if(!text.includes("CustomerOrderV2")){
  text=text.replace("const CustomerOrder=lazy(()=>import('./pages/CustomerOrder'))", "const CustomerOrder=lazy(()=>import('./pages/CustomerOrder'))\nconst CustomerOrderV2=lazy(()=>import('./pages/CustomerOrderV2'))")
}

const old="  const params=new URLSearchParams(window.location.search),controlMode=params.get('control'),customerMode=window.location.hash==='#pedido'||params.get('pedido')==='1'\n  if(controlMode)return <Suspense fallback={<Loading/>}><OrderControl/></Suspense>\n  if(customerMode)return <Suspense fallback={<Loading/>}><CustomerOrder/></Suspense>"
const next="  const params=new URLSearchParams(window.location.search),controlMode=params.get('control'),catalogV2Mode=params.get('catalogo-v2')==='1',customerMode=window.location.hash==='#pedido'||params.get('pedido')==='1'\n  if(catalogV2Mode)return <Suspense fallback={<Loading/>}><CustomerOrderV2/></Suspense>\n  if(controlMode)return <Suspense fallback={<Loading/>}><OrderControl/></Suspense>\n  if(customerMode)return <Suspense fallback={<Loading/>}><CustomerOrder/></Suspense>"
if(text.includes(old))text=text.replace(old,next)
else if(!text.includes("catalogV2Mode=params.get('catalogo-v2')==='1'"))throw new Error('No se pudo activar la ruta catalogo-v2')

fs.writeFileSync(file,text)
console.log('Catálogo V2 laboratorio activo en ?catalogo-v2=1')
