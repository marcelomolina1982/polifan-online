import React from 'react'
import { createRoot } from 'react-dom/client'
import LabApp from './LabApp'
import './styles.css'
import './trust-overrides.css'
import './catalog-pro.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode><LabApp /></React.StrictMode>
)
