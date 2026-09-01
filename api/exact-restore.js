export default function handler(req,res){
  res.setHeader('cache-control','no-store')
  return res.status(410).json({ok:false,error:'Endpoint de recuperación retirado. Las restauraciones se realizan únicamente desde administración segura.'})
}
