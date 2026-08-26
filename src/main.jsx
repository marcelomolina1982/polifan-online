import React from 'react'
import { createRoot } from 'react-dom/client'
import CustomerOrderV2 from './pages/CustomerOrderV2'
import './catalog-v2-shell.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode><CustomerOrderV2 /></React.StrictMode>
)
