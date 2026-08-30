const puppeteer = require('puppeteer')
const { resolvePackage } = require('./packageRules')

const FORM_URL = process.env.VIACARGO_FORM_URL || 'https://formularios.viacargo.com.ar/'
const DEFAULT_ORIGIN_CP = String(process.env.VIACARGO_ORIGIN_CP || '1609')
const DECLARED_VALUE = Number(process.env.VIACARGO_DECLARED_VALUE || 100000)

let browserPromise = null

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
  if (raw.includes(',')) return Number(raw.replace(',', '.')) || 0
  return Number(raw) || 0
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
  await page.keyboard.type(String(value), { delay: 5 })

  for (const wait of [450, 650, 900]) {
    await new Promise(resolve => setTimeout(resolve, wait))
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await new Promise(resolve => setTimeout(resolve, 100))
    const selected = await inputValue(page, index)
    if (/\(\d{4}\)/.test(selected)) return selected
  }

  return inputValue(page, index)
}

function verifyDestination(destination, cp, locality, province) {
  const d = normalize(destination)
  const selectedCp = (String(destination).match(/\((\d{4})\)/) || [])[1] || ''
  const cpOk = selectedCp === String(cp)
  const localityOk = d.includes(normalize(locality))
  const provinceOk = d.includes(normalize(province))
  return { ok: cpOk && localityOk && provinceOk, cpOk, localityOk, provinceOk, selectedCp }
}

async function setInput(page, index, value) {
  await page.evaluate(i => document.querySelectorAll('input')[i]?.focus(), index)
  await selectAll(page)
  await page.keyboard.type(String(value), { delay: 2 })
}

function parseProducts(text) {
  const products = [...String(text).matchAll(/Producto\s+([^\n]+)[\s\S]*?Valor\s+(\$[0-9.,]+)/gi)]
    .map(match => ({ name: match[1].trim(), priceText: match[2], price: parsePrice(match[2]) }))
  const agencyToAgency = products.find(item => /agencia/i.test(item.name) && !/domicilio/i.test(item.name)) || null
  return { products, agencyToAgency }
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

  const browser = await getBrowser()
  let page

  try {
    page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', request => {
      const type = request.resourceType()
      if (['image', 'font', 'media'].includes(type)) return request.abort()
      return request.continue()
    })

    await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 25000 })

    const origin = await fillAutocomplete(page, 0, originCp)
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

    await page.waitForFunction(() => /DESPACHO AGENCIA[\s\S]*?\$\s*[0-9]/i.test(document.body.innerText), { timeout: 15000 })

    const text = await page.evaluate(() => document.body.innerText)
    const { products, agencyToAgency } = parseProducts(text)
    if (!agencyToAgency?.price) throw new Error('Vía Cargo no devolvió una tarifa Agencia → Agencia válida')

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
      deliveryEstimate: '24–72 h estimadas',
      payment: 'destino',
      package: {
        kg: packageData.kg,
        width: packageData.width,
        height: packageData.height,
        length: packageData.length,
      },
      declaredValue: DECLARED_VALUE,
      verified,
      products,
      elapsedMs: Date.now() - started,
    }
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

module.exports = { quoteViaCargo, getBrowser }
