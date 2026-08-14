import React,{useEffect} from 'react'
import StockBase from './StockBase'

export default function Stock(props){
  useEffect(()=>{
    const clean=()=>document.querySelectorAll('.stock-no-projection .inventory-explanation').forEach(el=>{if(el.textContent?.toLocaleLowerCase('es').includes('proyección'))el.style.display='none'})
    clean();const observer=new MutationObserver(clean);const root=document.querySelector('.stock-no-projection');if(root)observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect()
  },[])
  return <div className="stock-no-projection"><style>{`
    .stock-no-projection .inventory-kpis > .panel:nth-child(5){display:none!important}
    .stock-no-projection .inventory-table th:nth-child(8),
    .stock-no-projection .inventory-table td:nth-child(8){display:none!important}
  `}</style><StockBase {...props}/></div>
}
