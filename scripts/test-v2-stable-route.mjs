import assert from 'node:assert/strict'
import fs from 'node:fs'
const v2=fs.readFileSync(new URL('../src/lib/v2Data.js',import.meta.url),'utf8')
const app=fs.readFileSync(new URL('../src/AppV2.jsx',import.meta.url),'utf8')
const entry=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8')
assert.match(entry,/AppV2/)
assert.match(v2,/supabase\.rpc\('patch_v2_sections_cas',args\)/)
assert.doesNotMatch(v2,/supabase\.rpc\('patch_v2_sections_cas_compat'/)
assert.match(v2,/p_expected_revisions/)
assert.match(v2,/revisión segura/)
assert.match(app,/patchV2Sections\(patch,session\?\.user\?\.id,latestResult\.revisions\)/)
assert.match(app,/baselineRef\.current/)
assert.doesNotMatch(app,/catalog_write_nonce/)
console.log('OK: AppV2 route uses known working original CAS RPC; avoids timed-out compatibility wrapper')
