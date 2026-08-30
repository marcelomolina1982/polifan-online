const express = require('express')
const { quoteViaCargo, getBrowser } = require('./viacargo')
const { resolveViaCargoDestination } = require('./resolveDestination')

const app = express()
const port = Number(process.env.PORT || 10000)
const allowedOrigins = String(process.env.CORS_ORIGIN || 'https://polifan-app-v2.vercel.app')
  .split(',').map(value => value.trim()).filter(Boolean)

app.use((req, res, next) => {
  const origin = String(req.headers.origin || '')
  if (origin && allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(origin && !allowedOrigins.includes(origin) ? 403 : 204)
  next()
})

app.use(express.json({ limit: '32kb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'viacargo-quote-api', version: '1.2.0' })
})

app.get('/health/browser', async (_req, res) => {
  try {
    const browser = await getBrowser()
    res.json({ ok: true, browserConnected: browser.isConnected() })
  } catch (error) {
    res.status(503).json({ ok: false, error: error?.message || String(error) })
  }
})

async function cotizar(req, res) {
  const started = Date.now()
  try {
    const result = await quoteViaCargo(req.body || {})
    res.setHeader('Cache-Control', 'no-store')
    return res.json(result)
  } catch (error) {
    const message = error?.message || String(error)
    const badInput = /debe tener|obligatorios|no coinciden/i.test(message)
    return res.status(badInput ? 400 : 422).json({ ok: false, error: message, elapsedMs: Date.now() - started })
  }
}

async function destino(req,res){
  try{
    const result=await resolveViaCargoDestination(req.body||{})
    res.setHeader('Cache-Control','no-store')
    return res.json(result)
  }catch(error){return res.status(422).json({ok:false,error:error?.message||String(error)})}
}

app.post('/api/cotizar', cotizar)
app.post('/api/destino', destino)
app.get('/api/destino', async (req,res)=>{req.body={query:req.query.query||req.query.cp||req.query.locality};return destino(req,res)})
app.get('/api/cotizar', async (req, res) => {
  req.body = {destinationCp: req.query.destinationCp || req.query.cp,locality: req.query.locality,province: req.query.province,quantity: req.query.quantity,kg: req.query.kg,width: req.query.width,height: req.query.height,length: req.query.length,originCp: req.query.originCp}
  return cotizar(req, res)
})

app.listen(port, '0.0.0.0', () => {console.log(`VIACARGO_API_READY port=${port}`)})
