import React from 'react'
import {Title} from '../components/UI'

export default function ChatGPTAssist(){
  return <>
    <Title title="Asistencia ChatGPT" sub="Reemplaza al asistente automático viejo del catálogo."/>
    <div className="panel" style={{maxWidth:820}}>
      <small style={{display:'block',fontWeight:800,letterSpacing:'.08em',color:'#d82a74',marginBottom:8}}>ASISTENCIA REAL</small>
      <h3 style={{margin:'0 0 10px'}}>Usá ChatGPT con tu cuenta, sin un bot paralelo.</h3>
      <p style={{margin:'0 0 14px',lineHeight:1.55,color:'#5f6b7a'}}>El antiguo asistente del catálogo fue retirado. Este acceso abre ChatGPT para que puedas seguir trabajando sobre Polifan, mandar capturas, revisar errores y pedir cambios usando tu acceso habitual de ChatGPT.</p>
      <button className="primary" type="button" onClick={()=>window.open('https://chatgpt.com/','_blank','noopener,noreferrer')}>Abrir ChatGPT ↗</button>
      <div className="notice" style={{marginTop:16}}><b>Importante</b><span>Esto no agrega consumo de API de OpenAI dentro de Polifan ni crea otro chatbot para los clientes.</span></div>
    </div>
  </>
}
