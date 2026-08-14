import React,{useEffect,useRef,useState} from 'react'
import StockBase from './StockBase'
import {automaticOrderOutflow,looseComponentBalance,manualBalance,normalizeFigureKey} from '../lib/inventory'
import {today} from '../lib/format'

const RECOUNT_ID='inventario-fisico-2026-08-14-v1'
const PHYSICAL_RECOUNT=[
  ['COPA DEL MUNDO',8,1,0],['CARAMELO',13,0,0],['OSO',1,0,0],['JESSIE',1,0,0],['TE AMO',1,0,0],['AUTO',2,0,0],['MINIONS',1,0,0],['SPIDERMAN',2,0,0],['SONIC',4,0,0],['CHANCHO',5,0,0],['DINO',10,0,0],['DINO CORAZON',2,0,0],['BOTIN',4,0,0],['ESCUDO RACING',2,0,0],['RUMMI',2,2,0],['UNICORNIO',1,0,2],
  ['PATO',0,0,1],['BABY SHARK',0,0,1],['ESCUDO RIVER',1,0,0],['MICKEY',1,0,0],['MINNIE',3,0,0],['CORAZON',1,0,0],['CAMISETA',1,0,0],['FELIZ DIA CORAZON',1,0,0],['CHOPP',4,0,0],['CARA DE PAPA',2,0,0],['STITCH COMPLETO',3,0,0],['MARCIANO',1,0,0],['GRACIAS',1,0,0],['OVEJA',1,0,0],['LETRA J',1,0,0],['FLOR DE CEREZO',1,0,0],['SEÑO CORAZON',2,0,0],['MANOS MICKEY',1,0,0],['WODY',3,0,0],['ARCO IRIS',5,0,0],['ESCUDO BOCA',6,0,0],['BESO',8,0,0],['INFINITO MAMA',3,0,0],['PICADA',5,0,0],['GATO',2,0,0],['TORTUGA NINJA',1,0,0],['ROMPE CABEZA CPRAZON',2,0,1],['MATE',2,0,0],['PALABRA MAMA IMPRENTA',5,0,0],['PERRO SALCHICHA',1,0,0],['MARIPOSA DIVISION',5,0,0],['CORAZON DIVISION',13,0,0],['FLOR SIMPLE',5,0,0],['FLOR CON TALLO',2,0,0],['PELOTA',4,0,0],['ABEJITA',2,0,0],['SKYE',1,0,0],['PLIM PLIM',2,0,0],['GOKU',1,0,0],['CORAZON MAMA',1,0,0],['CORAZON SEÑO',1,0,0],['KITTY',2,0,0],['CAMARA DE FOTO',1,0,0],['TAZA DE TE SEÑO',1,0,0],['LAPIZ',1,0,0],['MARGARITA',1,0,0]
]

const EXTRA_ALIASES={
  'wody':['woody'],
  'rompe cabeza cprazon':['rompe cabeza corazon','rompecabeza corazon','rompecabezas corazon'],
  'stitch completo':['stitch'],
  'camara de foto':['camara de fotos','camara'],
  'taza de te seño':['taza seño','taza de te seño'],
  'palabra mama imprenta':['mama imprenta','mama palabra imprenta'],
  'arco iris':['arcoiris'],
  'dino corazon':['dinosaurio corazon'],
  'flor de cerezo':['flor cerezo']
}

function allNames(db){
  const out=[]
  ;(db.figures||[]).forEach(x=>x&&out.push(String(x)))
  ;(db.customerCatalog||[]).forEach(x=>x?.name&&out.push(String(x.name)))
  ;(db.orders||[]).forEach(o=>(o.items||[]).forEach(i=>i?.figure&&out.push(String(i.figure))))
  ;(db.movements||[]).forEach(m=>m?.figure&&out.push(String(m.figure)))
  ;(db.cutBatches||[]).forEach(b=>(b.items||[]).forEach(i=>i?.figure&&out.push(String(i.figure))))
  return [...new Set(out)]
}

function resolveName(raw,names){
  const key=normalizeFigureKey(raw)
  const exact=names.find(n=>normalizeFigureKey(n)===key)
  if(exact)return exact
  for(const alias of (EXTRA_ALIASES[key]||[])){
    const hit=names.find(n=>normalizeFigureKey(n)===normalizeFigureKey(alias))
    if(hit)return hit
  }
  return raw
}

function buildRecountState(db){
  const names=allNames(db)
  const target=new Map()
  for(const [raw,complete,tapa,base] of PHYSICAL_RECOUNT){
    const figure=resolveName(raw,names)
    target.set(figure,{complete:Number(complete)||0,tapa:Number(tapa)||0,base:Number(base)||0})
    if(!names.includes(figure))names.push(figure)
  }

  const rawManual=manualBalance(db)
  const autoOut=automaticOrderOutflow(db)
  const rawLoose=looseComponentBalance(db)
  const every=new Set([...names,...Object.keys(rawManual),...Object.keys(autoOut),...Object.keys(rawLoose)])
  const movements=[...(db.movements||[])]
  const now=new Date().toISOString(),date=today()

  for(const figure of every){
    const wanted=target.get(figure)||{complete:0,tapa:0,base:0}
    for(const component of ['tapa','base']){
      const current=Math.max(0,Number(rawLoose[figure]?.[component]||0))
      const desired=Math.max(0,Number(wanted[component]||0))
      const delta=desired-current
      if(delta!==0)movements.push({id:crypto.randomUUID(),date,figure,component,type:delta>0?'Ajuste componente positivo':'Ajuste componente negativo',qty:Math.abs(delta),detail:`RECUENTO FÍSICO 14/08 · fijar ${component}s sueltas en ${desired}`,createdAt:now})
    }
    const currentManual=Number(rawManual[figure]||0)
    const desiredManual=Math.max(0,Number(wanted.complete||0))+Number(autoOut[figure]||0)
    const delta=desiredManual-currentManual
    if(delta!==0)movements.push({id:crypto.randomUUID(),date,figure,type:delta>0?'Ajuste positivo':'Ajuste negativo',qty:Math.abs(delta),detail:`RECUENTO FÍSICO 14/08 · fijar figuras completas en ${wanted.complete}`,createdAt:now})
  }

  const figures=[...new Set([...(db.figures||[]),...PHYSICAL_RECOUNT.map(([raw])=>resolveName(raw,names))])].filter(Boolean).sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))
  return {...db,figures,movements,inventoryRecount:{id:RECOUNT_ID,appliedAt:now,completeTotal:170,looseBases:4,looseTops:3,source:'INVENTARIO PIEZAS 14-08.txt'}}
}

export default function Stock(props){
  const {db,onSave}=props
  const applyingRef=useRef(false)
  const [recountStatus,setRecountStatus]=useState(db.inventoryRecount?.id===RECOUNT_ID?'applied':'pending')

  useEffect(()=>{
    const clean=()=>document.querySelectorAll('.stock-no-projection .inventory-explanation').forEach(el=>{if(el.textContent?.toLocaleLowerCase('es').includes('proyección'))el.style.display='none'})
    clean();const observer=new MutationObserver(clean);const root=document.querySelector('.stock-no-projection');if(root)observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect()
  },[])

  useEffect(()=>{
    if(!db||!onSave||db.inventoryRecount?.id===RECOUNT_ID||applyingRef.current)return
    applyingRef.current=true;setRecountStatus('applying')
    ;(async()=>{
      const next=buildRecountState(db)
      const result=await onSave(next)
      if(result?.ok===false){applyingRef.current=false;setRecountStatus('error');alert('No se pudo aplicar el recuento físico. No se modificó el inventario. Revisá la conexión y volvé a entrar a Inventario.');return}
      setRecountStatus('applied')
      alert('✅ Recuento físico 14/08 aplicado. Inventario ajustado a 170 figuras completas + 4 bases + 3 tapas. “Para cortar” ya se recalcula con este stock real y los pedidos vigentes.')
    })()
  },[db,onSave])

  return <div className="stock-no-projection"><style>{`
    .stock-no-projection .inventory-kpis > .panel:nth-child(5){display:none!important}
    .stock-no-projection .inventory-table th:nth-child(8),
    .stock-no-projection .inventory-table td:nth-child(8){display:none!important}
  `}</style>
    {recountStatus!=='applied'&&<div className="notice"><b>{recountStatus==='applying'?'Aplicando recuento físico 14/08…':'Recuento físico 14/08 pendiente'}</b><span>{recountStatus==='error'?'Falló el guardado. Salí y volvé a entrar a Inventario para reintentar.':'No cierres esta pantalla hasta que aparezca la confirmación.'}</span></div>}
    {recountStatus==='applied'&&<div className="notice"><b>✅ Inventario físico 14/08 aplicado</b><span>Base real: 170 completas · 4 bases sueltas · 3 tapas sueltas. Los faltantes de “Para cortar” se calculan desde este recuento.</span></div>}
    <StockBase {...props}/>
  </div>
}
