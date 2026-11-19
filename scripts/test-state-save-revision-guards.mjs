import fs from 'node:fs'
import assert from 'node:assert/strict'

const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
const save=source.slice(source.indexOf('  async function saveData(next){'),source.indexOf('  async function saveOrderData(next){'))
assert.ok(save.includes("select('updated_at,catalog_image_compaction_enabled').eq('id','main').maybeSingle()"),'Guardado debe consultar primero solo la revisión')
assert.ok(save.includes("revisionRow.updated_at!==serverRevisionRef.current"),'Debe detectar cambios de otras computadoras')
assert.ok(save.includes("select('data,updated_at').eq('id','main').maybeSingle()"),'Debe leer datos completos cuando hay otra revisión')
assert.ok(save.includes("query=query.eq('updated_at',latestRow.updated_at)"),'Debe conservar la escritura condicional para evitar sobreescrituras')
assert.ok(save.includes('mergeArrayById(baseline[key],latest[key],next[key],key)'), 'Debe conservar combinación por registro')
assert.ok(save.includes("if(!result.data?.length)"),'Debe conservar reintentos ante escrituras concurrentes')
console.log('OK: revision-first save path and concurrency protections present')
