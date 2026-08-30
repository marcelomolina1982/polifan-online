if(process.env.PORT&&!process.env.npm_config_user_agent&&!/(^|[\\/])npm(?:-cli)?(?:\.js)?$|(^|[\\/])npx(?:-cli)?(?:\.js)?$|install\.m?js/.test(process.argv[1]||'')){
const express=require('express');
const {quoteViaCargo}=require('../viacargo-api/src/viacargo');
const app=express();
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin',process.env.CORS_ORIGIN||'*');res.setHeader('Access-Control-Allow-Headers','content-type, authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);next()});
app.use(express.json({limit:'32kb'}));
app.get('/health',(_req,res)=>res.json({ok:true,service:'viacargo-quote-api',version:'1.0.0'}));
async function handler(req,res){const input=req.method==='GET'?req.query:(req.body||{});try{const result=await quoteViaCargo(input);res.setHeader('Cache-Control','no-store');res.json(result)}catch(error){const message=error?.message||String(error);const bad=/debe tener|obligatorios|no coinciden/i.test(message);res.status(bad?400:422).json({ok:false,error:message})}}
app.get('/quote',handler);
app.post('/quote',handler);
app.get('/api/cotizar',handler);
app.post('/api/cotizar',handler);
const originalListen=express.application.listen;
const server=originalListen.call(app,process.env.PORT,()=>console.log('VIACARGO_API_READY'));
express.application.listen=function(port,...args){if(String(port)===String(process.env.PORT))return server;return originalListen.call(this,port,...args)};
}
