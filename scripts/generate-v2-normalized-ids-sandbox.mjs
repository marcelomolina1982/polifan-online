import assert from 'node:assert/strict'
import fs from 'node:fs'

// A regression for untrimmed distinct IDs ("m1" and " m1 "):
// the original row-by-row RPC treats both as the SAME durable key and
// applies the LAST entry. A set-based UPSERT must retain that behavior.
const newDraft=fs.readFileSync(new URL('./patch-v2-set-based-durable-sync-DRAFT.sql',import.meta.url),'utf8')
const oldDraft=fs.readFileSync(new URL('./fixtures/patch-v2-original-reference.sql',import.meta.url),'utf8')
assert.equal((newDraft.match(/select distinct on \(btrim\(coalesce\(x\.item->>'id',''\)\)\)/g)||[]).length,2,
  'Both set-based inserts must deduplicate canonical IDs')
assert.match(newDraft,/with ordinality x\(item,position\)/)
assert.match(newDraft,/x\.position desc/)
function isolate(source,name){
 const index=source.indexOf('CREATE OR REPLACE FUNCTION public.patch_v2_sections_cas(')
 assert.ok(index>=0)
 const text=source.slice(index)
  .replaceAll('public.app_state_section_revisions','pg_temp.app_state_section_revisions')
  .replaceAll('public.app_state','pg_temp.app_state')
  .replace('public.patch_v2_sections_cas(',`pg_temp.${name}(`)
  .replaceAll('auth.uid()',"'11111111-1111-4111-8111-111111111111'::uuid")
  .replace("SET search_path TO 'public'","SET search_path TO 'pg_temp'")
 assert.doesNotMatch(text,/public\.app_state|auth\.uid\(\)/)
 return text
}
const original=isolate(oldDraft,'old_v2')
const optimized=isolate(newDraft,'optimized_v2')
const revision='{"movements":"2026-11-20T10:00:00Z"}'
const id='11111111-1111-4111-8111-111111111111'
const duplicatePatch='{"movements":[{"id":"m1","qty":1},{"id":" m1 ","qty":2}]}'
const seedEmpty=`insert into pg_temp.app_state(id,data) values
 ('main','{"movements":[],"orders":[],"cutBatches":[]}'::jsonb);
insert into pg_temp.app_state_section_revisions values('movements','2026-11-20T10:00:00Z');`
const seedDuplicateOld=`insert into pg_temp.app_state(id,data) values
 ('main','{"movements":[{"id":"m1","qty":1},{"id":" m1 ","qty":2}],"orders":[],"cutBatches":[]}'::jsonb),
 ('movement_m1','{"collection":"movements","item":{"id":" m1 ","qty":2}}'::jsonb);
insert into pg_temp.app_state_section_revisions values('movements','2026-11-20T10:00:00Z');`
const script=`begin;
set local statement_timeout='6s';
create temp table app_state(id text primary key,data jsonb not null,
 updated_at timestamptz,updated_by uuid);
create temp table app_state_section_revisions(section_key text primary key,
 updated_at timestamptz);
create temp table comparison(case_name text primary key,expected jsonb);
${original}
${optimized}
-- Case 1: original last-entry-wins on raw IDs with same normalized key.
${seedEmpty}
select * from pg_temp.old_v2('${duplicatePatch}'::jsonb,
 '${revision}'::jsonb,'${id}'::uuid);
insert into pg_temp.comparison select 'last-wins',data
 from pg_temp.app_state where id='movement_m1';
truncate pg_temp.app_state,pg_temp.app_state_section_revisions;
${seedEmpty}
select * from pg_temp.optimized_v2('${duplicatePatch}'::jsonb,
 '${revision}'::jsonb,'${id}'::uuid);
do $test$ begin
 if (select data from pg_temp.app_state where id='movement_m1') is distinct from
 (select expected from pg_temp.comparison where case_name='last-wins')
 then raise exception 'Normalized IDs changed original last-write-wins behavior';end if;
 if (select count(*)<>1 from pg_temp.app_state where id like 'movement_%')
 then raise exception 'Canonical duplicates created multiple durable rows';end if;
end $test$;
-- Case 2: duplicate canonical IDs in OLD movements, both removed.
truncate pg_temp.app_state,pg_temp.app_state_section_revisions;
${seedDuplicateOld}
select * from pg_temp.old_v2('{"movements":[]}'::jsonb,
 '${revision}'::jsonb,'${id}'::uuid);
insert into pg_temp.comparison select 'tombstone',data
 from pg_temp.app_state where id='movement_m1';
truncate pg_temp.app_state,pg_temp.app_state_section_revisions;
${seedDuplicateOld}
select * from pg_temp.optimized_v2('{"movements":[]}'::jsonb,
 '${revision}'::jsonb,'${id}'::uuid);
do $test$ begin
 if (select data from pg_temp.app_state where id='movement_m1') is distinct from
 (select expected from pg_temp.comparison where case_name='tombstone')
 then raise exception 'Deduplicated tombstone differs from original';end if;
 if (select data->>'deleted'<>'true' from pg_temp.app_state where id='movement_m1')
 then raise exception 'Removed movement not tombstoned';end if;
end $test$;
rollback;
`
assert.doesNotMatch(script,/\b(?:update|insert into|delete from|alter table|truncate)\s+public\.(?:app_state|app_state_section_revisions)/i)
assert.match(script,/rollback;\s*$/)
if(process.argv.includes('--check')){
 console.log('OK: original vs set-based normalized-ID last-wins and duplicate-old tombstones, pg_temp + rollback')
}else process.stdout.write(script)
