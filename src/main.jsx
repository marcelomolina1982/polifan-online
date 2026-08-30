import React from 'react'
import { createRoot } from 'react-dom/client'
import AppV2 from './AppV2'
import './styles.css'
import './trust-overrides.css'
import './catalog-pro.css'
import './app-v2.css'
import './app-v2-phase1.css'
import './orders-v2.css'
import './order-form-v2.css'
import './v2-shell.css'
import './dashboard-v4.css'
import './v2-workspaces.css'
import './v2-navigation.css'
import './v2-adaptive.css'
import './v2-mobile-hotfix.css'
import './trustCatalogEnhancements'
import './catalogProEnhancements'
import './orders-v2-enhancements'
import './v2NavigationEnhancement'
import './v2MobileTables'

// V2 bundle: responsive mobile shell + validated 1230 mm nesting motor.
const NEW_CATALOG_URL='https://tu-vida-en-tinta-catalogo-v2.vercel.app/'
const params=new URLSearchParams(window.location.search)
const legacyCatalogLink=window.location.hash==='#pedido'||params.get('pedido')==='1'
if(legacyCatalogLink){
  params.delete('pedido')
  const query=params.toString()
  window.location.replace(`${NEW_CATALOG_URL}${query?`?${query}`:''}`)
}else{
  createRoot(document.getElementById('root')).render(
    <React.StrictMode><AppV2 /></React.StrictMode>
  )
}
