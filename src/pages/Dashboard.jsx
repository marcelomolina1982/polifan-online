import React from 'react'
import DashboardRefresh from './DashboardRefresh'
import {todayArgentinaISO} from '../lib/production'

export default function Dashboard(props){
  const today=todayArgentinaISO()
  const orders=(props.db?.orders||[]).filter(order=>!order.delivery||String(order.delivery)>=today)
  return <DashboardRefresh {...props} db={{...props.db,orders}} />
}
