const puppeteer = require('puppeteer')
const { resolvePackage } = require('./packageRules')

const FORM_URL = process.env.VIACARGO_FORM_URL || 'https://formularios.viacargo.com.ar/'
const DEFAULT_ORIGIN_CP = String(process.env.VIACARGO_ORIGIN_CP || '1609')
const DECLARED_VALUE = Number(process.env.VIACARGO_DECLARED_VALUE || 100000)
const CACHE_TTL_MS = Math.max(0, Number(process.env.VIACARGO_CACHE_TTL_MS || 300000))
const CACHE_MAX_KEYS = Math.max(10, Number(process.env.VIACARGO_CACHE_MAX_KEYS || 200))

let browserPromise = null
let quoteQueue = Promise.resolve()
const quoteCache = new Map()
const inFlight = new Map()

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

function parsePrice(text) {
  const raw = String(text || '').replace(/[^0-9.,]/g, '')
  if (!raw) return 0
  if (raw.includes(',') && raw.includes('.')) return Number(raw.replace(/\./g, '').replace(',', '.')) || 0

  const parseSingleSeparator = separator => {
    const parts = raw.split(separator)
    if (parts.length > 2) {
      const thousands = parts.slice(1).every(part => part.length === 3)
      return Number(thousands ? parts.join('') : `${parts.slice(0, -1).join('')}.${parts.at(-1)}`) || 0
    }
    if (parts.length === 2) {
      const [left, right] = parts
      if (right.length === 3 && left.length > 0) return Number(left + right) || 0
      if (right.length >= 1 && right.length <= 2) return Number(`${left}.${right}`) || 0
      return Number(left + right) || 0
    }
    return Number(raw) || 0
  }

  if (raw.includes(',')) return parseSingleSeparator(',')
  if (raw.includes('.')) return parseSingleSeparator('.')
  return Number(raw) || 0
}

function parseOfficialDestination(destination) {
  const match = String(destination || '').trim().match(/^(.+?)\s*\((\d{4})\)\s*-\s*(.+)$/)
  if (!match) return { locality: '', cp: '', province: '' }
  return { locality: match[1].trim(), cp: match[2], province: match[3].trim() }
}

function verifyDestination(destination, cp, locality, province) {
  const official = parseOfficialDestination(destination)
  const selectedCp = official.cp
  const cpOk = selectedCp === String(cp).trim()
  const localityOk = Boolean(official.locality) && normalize(official.locality) === normalize(locality)
  const provinceOk = Boolean(official.province) && normalize(official.province) === normalize(province)
  return { ok: cpOk && localityOk && provinceOk, cpOk, localityOk, provinceOk, selectedCp, official }
}

function verifyOrigin(origin, cp) {
  const official = parseOfficialDestination(origin)
  return { ok: official.cp === String(cp).trim(), selectedCp: official.cp, official }
}

function pruneCache(now = Date.now()) {
  for (const [key, cached] of quoteCache) {
    if (now - cached.savedAt >= CACHE_TTL_MS) quoteCache.delete(key)
  }
  while (quoteCache.size > CACHE_MAX_KEYS) quoteCache.delete(quoteCache.keys().next().value)
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
      ],
    }).then(browser => {
      browser.on('disconnected', () => { browserPromise = null })
      return browser
    }).catch(error => {
      browserPromise = null
      throw error
    })
  }
  return browserPromise
}

async function selectAll(page) {
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
}

async function inputValue(page, index) {
  return page.evaluate(i => document.querySelectorAll('input')[i]?.value || '', index)
}

async function fillAutocomplete(page, index, value) {
  await page.evaluate(i => {
    const input = document.querySelectorAll('input')[i]
    if (!input) throw new Error(`input ${i} missing`)
    input.focus()
  }, index)

  await selectAll(page)
  await page.keyboard.type(String(value), { delay: 3 })

  for (const wait of [300, 500, 800]) {
    await new Promise(resolve => setTimeout(resolve, wait))
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await new Promise(resolve => setTimeout(resolve, 80))
    const selected = await inputValue(page, index)
    if (/\(\d{4}\)/.test(selected)) return selected
  }

  return inputValue(page, index)
}

async function setInput(page, index, value) {
  await page.evaluate(i => document.querySelectorAll('input')[i]?.focus(), index)
  await selectAll(page)
  await page.keyboard.type(String(value), { delay: 1 })
}

function parseProducts(text) {
  const products = [...String(text).matchAll(/Producto\s+([^\n]+)[\s\S]*?Valor\s+(\$[0-9.,]+)/gi)]
    .map(match => ({ name: match[1].trim(), priceText: match[2], price: parsePrice(match[2]) }))
  const agencyToAgency = products.find(item => /agencia/i.test(item.name) && !/domicilio/i.test(item.name)) || null
  return { products, agencyToAgency }
}

function quoteKey({ destinationCp, locality, province, originCp, packageData }) {
  return [originCp, destinationCp, normalize(locality), normalize(province), packageData.kg, packageData.width, packageData.height, packageData.length, DECLARED_VALUE].join('|')
}

async function runBrowserQuote({ destinationCp, locality, province, originCp, packageData }) {
  const browser = await getBrowser()
  let page

  try {
    page = await browser.newPage()
    await page.setCacheEnabled(true)
    await page.setRequestInterception(true)
    page.on('request', request => {
      const type = request.resourceType()
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) return request.abort()
      return request.continue()
    })

    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 25000 })

    const origin = await fillAutocomplete(page, 0, originCp)
    const originVerified = verifyOrigin(origin, originCp)
    if (!originVerified.ok) throw new Error(`Vía Cargo no confirmó correctamente el CP de origen (${origin || 'sin selección'}).`)

    const destination = await fillAutocomplete(page, 1, destinationCp)
    const verified = verifyDestination(destination, destinationCp, locality, province)

    if (!verified.ok) {
      const invalid = [
        !verified.cpOk ? 'CP' : null,
        !verified.localityOk ? 'localidad' : null,
        !verified.provinceOk ? 'provincia' : null,
      ].filter(Boolean).join(', ')
      throw new Error(`Los datos no coinciden con el destino oficial de Vía Cargo (${destination}). Revisar ${invalid}.`)
    }

    const values = [
      '1',
      String(packageData.kg),
      String(packageData.height),
      String(packageData.width),
      String(packageData.length),
      String(DECLARED_VALUE),
    ]

    for (let i = 0; i < values.length; i += 1) await setInput(page, i + 2, values[i])

    await page.evaluate(() => {
      const labels = [...document.querySelectorAll('label')]
      const label = labels.find(x => (x.innerText || '').toLowerCase().includes('pago en destino'))
      if (label) label.click()
    })

    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')]
        .find(x => (x.innerText || '').toLowerCase().includes('cotiz'))
      if (!button) return false
      button.click()
      return true
    })

    if (!clicked) throw new Error('No se encontró el botón de cotización de Vía Cargo')

    await page.waitForFunction(() => /DESPACHO AGENCIA[\s\S]*?\$\s*[0-9]/i.test(document.body.innerText), { timeout: 12000 })

    const text = await page.evaluate(() => document.body.innerText)
    const { products, agencyToAgency } = parseProducts(text)
    if (!agencyToAgency?.price) throw new Error('Vía Cargo no devolvió una tarifa Agencia → Agencia válida')

    const legacyAgency = [{ name: agencyToAgency.name, price: agencyToAgency.priceText }]
    const legacyDimensions = [packageData.width, packageData.height, packageData.length]

    return {
      ok: true,
      carrier: 'Vía Cargo',
      service: 'Agencia → Agencia',
      origin,
      destination,
      destinationCp,
      locality,
      province,
      quantity: packageData.quantity,
      price: agencyToAgency.price,
      priceText: agencyToAgency.priceText,
      deliveryEstimate: null,
      payment: 'destino',
      package: {
        kg: packageData.kg,
        width: packageData.width,
        height: packageData.height,
        length: packageData.length,
      },
      declaredValue: DECLARED_VALUE,
      originVerified,
      verified,
      products,
      quotedAt: new Date().toISOString(),
      agencyToAgency: legacyAgency,
      kg: packageData.kg,
      dimensions: legacyDimensions,
    }
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

async function quoteViaCargo(input = {}) {
  const started = Date.now()
  const destinationCp = String(input.destinationCp || input.cp || '').trim()
  const locality = String(input.locality || '').trim()
  const province = String(input.province || '').trim()
  const originCp = String(input.originCp || DEFAULT_ORIGIN_CP).trim()
  const packageData = resolvePackage(input)

  if (!/^\d{4}$/.test(destinationCp)) throw new Error('destinationCp debe tener 4 dígitos')
  if (!locality || !province) throw new Error('locality y province son obligatorios')
  if (!/^\d{4}$/.test(originCp)) throw new Error('originCp debe tener 4 dígitos')

  const args = { destinationCp, locality, province, originCp, packageData }
  const key = quoteKey(args)
  pruneCache()
  const cached = quoteCache.get(key)
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return { ...cached.value, cached: true, elapsedMs: Date.now() - started }
  }

  if (inFlight.has(key)) {
    const shared = await inFlight.get(key)
    return { ...shared, shared: true, elapsedMs: Date.now() - started }
  }

  const work = quoteQueue.then(() => runBrowserQuote(args))
  quoteQueue = work.catch(() => undefined)
  inFlight.set(key, work)

  try {
    const result = await work
    quoteCache.set(key, { savedAt: Date.now(), value: result })
    pruneCache()
    return { ...result, cached: false, elapsedMs: Date.now() - started }
  } finally {
    inFlight.delete(key)
  }
}

module.exports = { quoteViaCargo, getBrowser, parsePrice, parseOfficialDestination, verifyDestination, verifyOrigin }
