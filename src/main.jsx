import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './trust-overrides.css'
import './catalog-pro.css'
import './trustCatalogEnhancements'
import './catalogProEnhancements'

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
