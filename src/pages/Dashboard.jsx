import React from 'react'
import DashboardV3 from './DashboardV3'
import {todayArgentinaISO} from '../lib/production'

export default function Dashboard(props){
  const today=todayArgentinaISO()
  const orders=(props.db?.orders||[]).filter(order=>!order.delivery||String(order.delivery)>=today)
  return <DashboardV3 {...props} db={{...props.db,orders}} />
}
