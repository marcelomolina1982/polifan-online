import React from 'react'
import { statusColors } from '../lib/constants'

export function Title({title,sub,actions}){
  return <div className="page-title"><div><h1>{title}</h1><p>{sub}</p></div><div className="title-actions">{actions}</div></div>
}

export function Kpi({label,value}){
  return <div className="kpi"><small>{label}</small><b>{value}</b></div>
}

export function Badge({status}){
  return <span className={'badge '+(statusColors[status]||'gray')}>{status}</span>
}

export function Field({label,children}){
  return <label className="field"><span>{label}</span>{children}</label>
}
