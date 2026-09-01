function packageFromQuantity(quantity) {
  const q = Math.max(1, Math.floor(Number(quantity || 1)))
  if (q <= 6) return { quantity: q, kg: 1, width: 30, height: 20, length: 20 }
  if (q <= 12) return { quantity: q, kg: 1, width: 40, height: 30, length: 30 }
  if (q <= 24) return { quantity: q, kg: 1, width: 50, height: 40, length: 30 }
  if (q <= 36) return { quantity: q, kg: 1, width: 50, height: 40, length: 40 }
  return { quantity: q, kg: 2, width: 60, height: 40, length: 40 }
}

function resolvePackage(input = {}) {
  const explicit = [input.kg, input.width, input.height, input.length].every(v => Number(v) > 0)
  if (explicit) {
    return {
      quantity: Math.max(1, Math.floor(Number(input.quantity || 1))),
      kg: Number(input.kg),
      width: Number(input.width),
      height: Number(input.height),
      length: Number(input.length),
    }
  }
  return packageFromQuantity(input.quantity)
}

module.exports = { packageFromQuantity, resolvePackage }
