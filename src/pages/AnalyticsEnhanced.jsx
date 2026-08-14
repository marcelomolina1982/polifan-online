import React,{useEffect,useMemo,useState} from 'react'
import AnalyticsBase from './AnalyticsBase'
import {supabase} from '../supabase'

export default function AnalyticsEnhanced(props){
  const [events,setEvents]=useState([])
  const [days,setDays]=useState(30)
  useEffect(()=>{const since=new Date(Date.now()-90*86400000).toISOString();supabase.from('catalog_events').select('event_type,metadata,created_at').gte('created_at',since).limit(5000).then(({data})=>setEvents(data||[]))},[])
  const rows=useMemo(()=>['TikTok','Instagram','WhatsApp','Directo / otro'].map(source=>{const since=Date.now()-days*86400000;const list=events.filter(e=>new Date(e.created_at).getTime()>=since&&(e.metadata?.source||'Directo / otro')===source);const visits=list.filter(e=>e.event_type==='catalog_visit').length;const sent=list.filter(e=>e.event_type==='order_sent').length;return{source,visits,sent,rate:visits?Math.round(sent/visits*1000)/10:0}}),[events,days])
  return <><section className="panel" style={{marginBottom:16}}><div className="panel-heading"><div><h3>Origen del catálogo</h3><small>De qué red social llegan las visitas y solicitudes.</small></div><select value={days} onChange={e=>setDays(Number(e.target.value))}><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option></select></div><div className="cards" style={{marginTop:12}}>{rows.map(r=><div className="kpi" key={r.source}><small>{r.source}</small><b>{r.visits} visitas</b><span>{r.sent} solicitudes · {r.rate}%</span></div>)}</div></section><AnalyticsBase {...props}/></>
}
