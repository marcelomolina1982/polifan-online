const assert = require('node:assert/strict')
const { parsePrice, verifyDestination, verifyOrigin } = require('../src/viacargo')
const { packageFromQuantity } = require('../src/packageRules')

assert.equal(parsePrice('$22.000'), 22000)
assert.equal(parsePrice('$22.000,50'), 22000.5)
assert.equal(parsePrice('$22000.01'), 22000.01)
assert.equal(parsePrice('$22,50'), 22.5)

const official = 'PRESIDENCIA ROQUE SAENZ PEÑA (3700) - CHACO'
const valid = verifyDestination(official, '3700', 'Presidencia Roque Sáenz Peña', 'Chaco')
assert.equal(valid.ok, true)
assert.equal(valid.cpOk, true)
assert.equal(valid.localityOk, true)
assert.equal(valid.provinceOk, true)
assert.equal(valid.selectedCp, '3700')
assert.equal(verifyDestination(official, '3701', 'Presidencia Roque Sáenz Peña', 'Chaco').ok, false)
assert.equal(verifyDestination(official, '3700', 'Roque', 'Chaco').ok, false)
assert.equal(verifyDestination(official, '3700', 'Presidencia Roque Sáenz Peña', 'Cha').ok, false)
assert.equal(verifyOrigin('BOULOGNE (1609) - BUENOS AIRES', '1609').ok, true)
assert.equal(verifyOrigin('BOULOGNE (1609) - BUENOS AIRES', '1655').ok, false)

assert.deepEqual(packageFromQuantity(6), { quantity: 6, kg: 1, width: 30, height: 20, length: 20 })
assert.deepEqual(packageFromQuantity(12), { quantity: 12, kg: 1, width: 40, height: 30, length: 30 })
assert.deepEqual(packageFromQuantity(24), { quantity: 24, kg: 1, width: 50, height: 40, length: 30 })
assert.deepEqual(packageFromQuantity(36), { quantity: 36, kg: 1, width: 50, height: 40, length: 40 })
assert.deepEqual(packageFromQuantity(37), { quantity: 37, kg: 2, width: 60, height: 40, length: 40 })

console.log('Via Cargo unit tests OK')
