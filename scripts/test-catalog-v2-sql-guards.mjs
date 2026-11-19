import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync(new URL('./catalog-v2-optimistic-save-draft.sql',import.meta.url),'utf8').toLowerCase()
assert.match(sql,/security invoker/)
assert.match(sql,/set search_path = ''/)
assert.match(sql,/auth\.uid\(\) is null/)
assert.match(sql,/on conflict \(id\) do nothing/)
assert.match(sql,/where id=p_id and updated_at=p_expected_updated_at/g)
assert.match(sql,/greatest\(clock_timestamp\(\),updated_at\+interval '1 microsecond'\)/)
assert.match(sql,/revoke all on function public\.mutate_catalog_product_v2\(text,text,jsonb,timestamptz\) from public,anon/)
assert.match(sql,/grant execute on function public\.mutate_catalog_product_v2\(text,text,jsonb,timestamptz\) to authenticated/)
assert.doesNotMatch(sql,/update public\.app_state|delete from public\.app_state|update public\.public_catalog/)
console.log('OK: SQL RPC draft has per-row CAS, RLS invoker, revision monotonicity and restricted execution')
