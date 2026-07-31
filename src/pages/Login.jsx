import React, { useState } from 'react'
import { supabase } from '../supabase'

export default function Login(){
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)

  async function submit(e){
    e.preventDefault()
    setBusy(true); setMsg('')
    const {error}=await supabase.auth.signInWithPassword({email,password})
    if(error) setMsg('No se pudo ingresar: '+error.message)
    setBusy(false)
  }

  return <div className="login-bg">
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo">✂</div>
      <h1>Tu Vida En Tinta</h1>
      <h2>Gestión de Polifan</h2>
      <p>Ingresá con el usuario creado en Supabase.</p>
      <label>Correo electrónico</label>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
      <label>Contraseña</label>
      <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/>
      {msg && <div className="error">{msg}</div>}
      <button className="primary full" disabled={busy}>{busy?'Ingresando…':'Ingresar'}</button>
    </form>
  </div>
}
