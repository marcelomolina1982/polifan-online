import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const code=fs.readFileSync(new URL('../src/lib/v2Data.js',import.meta.url),'utf8')
const start=code.indexOf('export async function patchV2Sections(')
const end=code.indexOf('export function pageSections(',start)
assert.ok(start>=0&&end>start,'Could not locate active V2 writer')
const saveSource=code.slice(start,end).replace('export async function','async function')
const seen=[]
let sequence=0
let result={data:[{updated_at:'2026-11-20T16:36:00Z',canonical_catalog:null,compaction_active:false}],error:null}
const supabase={rpc:async(name,args)=>{seen.push({name,args});return result}}
const ctx={supabase,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`},
  Object,Array,Error,String,Promise,setTimeout:()=>{},console}
const save=vm.runInNewContext(saveSource+'\npatchV2Sections',ctx)

const patch={orders:[{id:'o1'}]}
const baseline={orders:'2026-11-20T16:35:00Z'}
const one=await save(patch,'11111111-1111-4111-8111-111111111111',baseline)
assert.equal(one.updatedAt,'2026-11-20T16:36:00Z')
assert.equal(one.compactionActive,false)
assert.equal(seen[0].name,'patch_v2_sections_cas_compat')
assert.equal(seen[0].args.p_patch.orders[0].id,'o1')
assert.equal(seen[0].args.p_expected_revisions.orders,baseline.orders)
assert.equal(seen[0].args.p_write_nonce,'00000000-0000-4000-8000-000000000001')

const second=await save(patch,'11111111-1111-4111-8111-111111111111',baseline)
assert.notEqual(seen[0].args.p_write_nonce,seen[1].args.p_write_nonce,
  'Every legitimate save must present a fresh nonce')

const catalog=[{id:'heart',image:'https://example.test/photo.jpg'}]
result={data:[{updated_at:'2026-11-20T16:37:00Z',canonical_catalog:catalog,compaction_active:true}],error:null}
const v=await save({customerCatalog:[{id:'heart',image:'data:image/png;base64,aaa'}]},
  '11111111-1111-4111-8111-111111111111',{customerCatalog:baseline.orders})
assert.equal(v.compactionActive,true)
assert.equal(v.canonicalCatalog[0].image,catalog[0].image)
assert.equal(seen.at(-1).name,'patch_v2_sections_cas_compat')

result={data:[{updated_at:'2026-11-20T16:38:00Z',canonical_catalog:null,compaction_active:true}],error:null}
await assert.rejects(save({customerCatalog:[{id:'heart'}]},null,{customerCatalog:'R1'}),/catálogo/)
result={data:null,error:new Error('Conflicto de sincronización')}
await assert.rejects(save(patch,null,baseline),/Conflicto/)
await assert.rejects(save(patch,null,{}),/revisión segura/)

const app=fs.readFileSync(new URL('../src/AppV2.jsx',import.meta.url),'utf8')
assert.match(app,/const response=await patchV2Sections\(patch,session\?\.user\?\.id,latestResult\.revisions\)/)
assert.match(app,/canonicalCatalog/)
assert.match(app,/baselineRef\.current=\{\.\.\.baselineRef\.current,\.\.\.savedPatch\}/)

const sql=fs.readFileSync(new URL('./v2-catalog-write-bridge-DRAFT.sql',import.meta.url),'utf8')
assert.match(sql,/DRAFT \/ DO NOT APPLY/)
assert.match(sql,/before update of data on public\.app_state/)
assert.match(sql,/set_config\('app\.polifan_write_nonce',p_write_nonce::text,true\)/)
assert.match(sql,/from public\.patch_v2_sections_cas\(p_patch,p_expected_revisions,p_updated_by\)/)
assert.match(sql,/new\.catalog_write_nonce:=case when v_session_nonce is not null/)
assert.match(sql,/new\.catalog_write_nonce is distinct from old\.catalog_write_nonce/)
assert.match(sql,/revoke all on function public\.patch_v2_sections_cas_compat/)
assert.match(sql,/grant execute on function public\.patch_v2_sections_cas_compat.*to authenticated/)
assert.doesNotMatch(sql,/create or replace function public\.patch_v2_sections_cas\(/,
  'Do not alter existing operational V2 RPC in bridge deployment')
assert.doesNotMatch(sql,/drop table|truncate\s+table/i)
console.log('OK: active V2 saves use bridge nonce, server image URLs, strict revisions and restricted SQL draft')
