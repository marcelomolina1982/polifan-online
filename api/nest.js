export default function handler(req,res){
  res.setHeader('cache-control','no-store')
  return res.status(410).json({ok:false,error:'Motor Lab legado retirado. Usá Sparrow V5.'})
}
