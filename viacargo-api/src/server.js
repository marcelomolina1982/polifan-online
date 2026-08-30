const express = require('express')
const { quoteViaCargo, getBrowser } = require('./viacargo')

const app = express()
const port = Number(process.env.PORT || 10000)

app.use((req, res, next) => {
  const allowedOrigin = process.env.CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json({ limit: '32kb' }))

app.get('/health', async (_req, res) => {
  try {
    const browser = await getBrowser()
    res.json({ ok: true, service: 'viacargo-quote-api', browserConnected: browser.isConnected() })
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
    return res.status(badInput ? 400 : 422).json({
      ok: false,
      error: message,
      elapsedMs: Date.now() - started,
    })
  }
}

app.post('/api/cotizar', cotizar)

app.get('/api/cotizar', async (req, res) => {
  req.body = {
    destinationCp: req.query.destinationCp || req.query.cp,
    locality: req.query.locality,
    province: req.query.province,
    quantity: req.query.quantity,
    kg: req.query.kg,
    width: req.query.width,
    height: req.query.height,
    length: req.query.length,
    originCp: req.query.originCp,
  }
  return cotizar(req, res)
})

app.listen(port, '0.0.0.0', () => {
  console.log(`VIACARGO_API_READY port=${port}`)
})
