import React from 'react'
import Stock from './Stock'

export default function StockClean(props){
  return <div className="stock-no-projection"><style>{`
    .stock-no-projection .inventory-kpis > .panel:nth-child(5){display:none!important}
    .stock-no-projection .inventory-table th:nth-child(8),
    .stock-no-projection .inventory-table td:nth-child(8){display:none!important}
    .stock-no-projection .inventory-kpis + .notice + .notice + .notice{display:none!important}
  `}</style><Stock {...props}/></div>
}
