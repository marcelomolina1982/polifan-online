import React from 'react'
import DashboardV2 from './DashboardV2'
import {todayArgentinaISO} from '../lib/production'

export default function Dashboard(props){
  const today=todayArgentinaISO()
  const orders=(props.db?.orders||[]).filter(order=>!order.delivery||String(order.delivery)>=today)
  return <DashboardV2 {...props} db={{...props.db,orders}} />
}
