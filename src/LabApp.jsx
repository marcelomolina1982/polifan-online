import React,{useEffect,useRef,useState} from 'react'
import {supabase} from './supabase'
import {emptyState} from './lib/constants'
import Login from './pages/Login'
import MotorDefinitivo from './pages/MotorDefinitivo'

const Loading=()=> <div className="center-screen">Cargando Motor Lab…</div>

export default function LabApp(){
  const [session,setSession]=useState(null)
  const [db,setDb]=useState(emptyState())
  const [loading,setLoading]=useState(true)
  const loadedRef=useRef(false)
  const mountedRef=useRef(true)

  useEffect(()=>{
    mountedRef.current=true
    async function init(){
      const {data}=await supabase.auth.getSession()
      if(!mountedRef.current)return
      setSession(data.session)
      if(data.session)await loadData(true)
      else setLoading(false)
    }
    init()

    // Supabase emite TOKEN_REFRESHED / USER_UPDATED cuando el navegador vuelve
    // a una pestaña. Antes eso volvía a poner loading=true, desmontaba el motor
    // y hacía parecer que el cálculo empezaba de cero. Sólo cargamos los datos
    // cuando realmente inicia una sesión nueva.
    const {data:{subscription}}=supabase.auth.onAuthStateChange(async(event,next)=>{
      if(!mountedRef.current)return
      setSession(next)
      if(!next){
        loadedRef.current=false
        setDb(emptyState())
        setLoading(false)
        return
      }
      if(!loadedRef.current && (event==='SIGNED_IN'||event==='INITIAL_SESSION')){
        await loadData(true)
      }
    })
    return()=>{mountedRef.current=false;subscription.unsubscribe()}
  },[])

  async function loadData(showSpinner=false){
    if(showSpinner)setLoading(true)
    const {data,error}=await supabase.from('app_state').select('data').eq('id','main').maybeSingle()
    if(!mountedRef.current)return
    if(error){
      alert('Motor Lab no pudo leer los datos de producción: '+error.message)
      setLoading(false)
      return
    }
    setDb(data?.data?{...emptyState(),...data.data}:emptyState())
    loadedRef.current=true
    setLoading(false)
  }

  async function logout(){await supabase.auth.signOut();setSession(null)}
  async function blockProductionWrite(){
    alert('Motor Lab es sólo de pruebas. No modifica producción ni envía placas a corte.')
    return {ok:false,error:new Error('Escritura bloqueada en Motor Lab')}
  }

  if(!session)return <Login/>
  if(loading)return <Loading/>

  return <div className="app">
    <div className="content" style={{marginLeft:0,width:'100%'}}>
      <header>
        <div style={{paddingLeft:18}}><b>MOTOR LAB · AISLADO</b><small className="block">Pruebas del motor definitivo sin modificar producción</small></div>
        <div className="header-right"><span className="sync">Sólo lectura</span><div className="avatar">L</div><div className="user"><b>Motor Lab</b><small>{session.user.email}</small></div><button className="ghost" onClick={logout}>Salir</button></div>
      </header>
      <main>
        <div className="notice" style={{marginBottom:16}}><b>Laboratorio independiente</b><span>Este sitio usa el backend polifan-cnc-solver-lab. Podés generar, certificar y descargar SVG de prueba; “Pasar a corte” está bloqueado para no alterar la producción estable.</span></div>
        <MotorDefinitivo db={db} onSave={blockProductionWrite}/>
      </main>
    </div>
  </div>
}
