import React from 'react'
import DashboardV4 from './DashboardV4'
import {todayArgentinaISO} from '../lib/production'

export default function Dashboard(props){
  const today=todayArgentinaISO()
  const orders=(props.db?.orders||[]).filter(order=>!order.delivery||String(order.delivery)>=today||!['Entregado','Cancelado'].includes(order.status))
  return <DashboardV4 {...props} db={{...props.db,orders}} />
}
