if(process.env.PORT&&!process.env.npm_config_user_agent&&!/(^|[\\/])npm(?:-cli)?(?:\.js)?$|(^|[\\/])npx(?:-cli)?(?:\.js)?$|install\.m?js/.test(process.argv[1]||'')){
const express=require('express');
const {quoteViaCargo}=require('../viacargo-api/src/viacargo');
const {resolveViaCargoDestination}=require('../viacargo-api/src/resolveDestination');
const app=express();
const allowedOrigins=String(process.env.CORS_ORIGIN||'https://polifan-app-v2.vercel.app').split(',').map(x=>x.trim()).filter(Boolean);
const buckets=new Map();
app.use((req,res,next)=>{const origin=String(req.headers.origin||'');if(origin&&allowedOrigins.includes(origin))res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','content-type, authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(origin&&!allowedOrigins.includes(origin)?403:204);next()});
app.use(express.json({limit:'32kb'}));
app.get('/health',(_req,res)=>res.json({ok:true,service:'viacargo-quote-api',version:'1.2.0'}));
function limited(req){const now=Date.now(),ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim(),slot=buckets.get(ip)||{start:now,count:0};if(now-slot.start>60000){slot.start=now;slot.count=0}slot.count++;buckets.set(ip,slot);if(buckets.size>500)for(const [k,v] of buckets)if(now-v.start>120000)buckets.delete(k);return slot.count>30}
async function quoteHandler(req,res){if(limited(req))return res.status(429).json({ok:false,error:'Demasiadas cotizaciones seguidas. Esperá un momento y reintentá.'});const input=req.method==='GET'?req.query:(req.body||{});try{const result=await quoteViaCargo(input);res.setHeader('Cache-Control','no-store');res.json(result)}catch(error){const message=error?.message||String(error);const bad=/debe tener|obligatorios|no coinciden/i.test(message);res.status(bad?400:422).json({ok:false,error:message})}}
async function destinationHandler(req,res){if(limited(req))return res.status(429).json({ok:false,error:'Demasiadas consultas seguidas. Esperá un momento y reintentá.'});const input=req.method==='GET'?req.query:(req.body||{});try{const result=await resolveViaCargoDestination(input);res.setHeader('Cache-Control','no-store');res.json(result)}catch(error){res.status(422).json({ok:false,error:error?.message||String(error)})}}
app.get('/quote',quoteHandler);
app.post('/quote',quoteHandler);
app.get('/api/cotizar',quoteHandler);
app.post('/api/cotizar',quoteHandler);
app.get('/api/destino',destinationHandler);
app.post('/api/destino',destinationHandler);
const originalListen=express.application.listen;
const server=originalListen.call(app,process.env.PORT,()=>console.log('VIACARGO_API_READY'));
express.application.listen=function(port,...args){if(String(port)===String(process.env.PORT))return server;return originalListen.call(this,port,...args)};
}
