import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './trust-overrides.css'
import './catalog-pro.css'
import './app-v2.css'
import './app-v2-phase1.css'
import './trustCatalogEnhancements'
import './catalogProEnhancements'

const NEW_CATALOG_URL='https://tu-vida-en-tinta-catalogo-v2.vercel.app/'
if(window.location.hash==='#pedido'){
  const query=window.location.search || ''
  window.location.replace(`${NEW_CATALOG_URL}${query}`)
}else{
  createRoot(document.getElementById('root')).render(
    <React.StrictMode><App /></React.StrictMode>
  )
}
