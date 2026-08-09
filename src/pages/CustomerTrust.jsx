import React,{useState} from 'react'
import {Title} from '../components/UI'
const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2)
export default function CustomerTrust({db,onSave}){
 const [review,setReview]=useState({name:'',text:''});const [photo,setPhoto]=useState({name:'',caption:'',image:''})
 const reviews=db.customerReviews||[],photos=db.customerPhotos||[]
 const saveReview=async()=>{if(!review.text.trim())return alert('Escribí la reseña.');await onSave({...db,customerReviews:[...reviews,{id:uid(),...review,active:true,createdAt:new Date().toISOString()}]});setReview({name:'',text:''})}
 const choose=file=>{if(!file)return;const r=new FileReader();r.onload=()=>setPhoto(v=>({...v,image:String(r.result||'')}));r.readAsDataURL(file)}
 const savePhoto=async()=>{if(!photo.image)return alert('Elegí una foto.');await onSave({...db,customerPhotos:[...photos,{id:uid(),...photo,active:true,createdAt:new Date().toISOString()}]});setPhoto({name:'',caption:'',image:''})}
 const del=async(type,id)=>{if(!confirm('¿Eliminar?'))return;await onSave({...db,[type]:(db[type]||[]).filter(x=>x.id!==id)})}
 return <><Title title="Confianza de clientes" sub="Administrá las fotos y reseñas reales que se muestran en el catálogo público."/>
 <div className="analytics-grid"><section className="panel"><h3>📸 Fotos de clientes</h3><input placeholder="Nombre (opcional)" value={photo.name} onChange={e=>setPhoto({...photo,name:e.target.value})}/><input placeholder="Texto de la foto" value={photo.caption} onChange={e=>setPhoto({...photo,caption:e.target.value})}/><input type="file" accept="image/*" onChange={e=>choose(e.target.files?.[0])}/><button className="primary" type="button" onClick={savePhoto}>Agregar foto</button>{photos.map(x=><div className="trust-admin-item" key={x.id}>{x.image&&<img src={x.image} alt="Cliente"/>}<span><b>{x.name||'Cliente'}</b><small>{x.caption}</small></span><button className="danger smallbtn" onClick={()=>del('customerPhotos',x.id)}>Eliminar</button></div>)}</section>
 <section className="panel"><h3>⭐ Reseñas</h3><input placeholder="Nombre del cliente" value={review.name} onChange={e=>setReview({...review,name:e.target.value})}/><textarea placeholder="Reseña recibida..." value={review.text} onChange={e=>setReview({...review,text:e.target.value})}/><button className="primary" type="button" onClick={saveReview}>Agregar reseña</button>{reviews.map(x=><div className="trust-admin-item" key={x.id}><span><b>★★★★★ {x.name||'Cliente'}</b><small>{x.text}</small></span><button className="danger smallbtn" onClick={()=>del('customerReviews',x.id)}>Eliminar</button></div>)}</section></div></>
}
