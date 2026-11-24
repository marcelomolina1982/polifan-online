import assert from 'node:assert/strict'
import fs from 'node:fs'

// Generate a reproducible test against the EXACT SQL draft, never a copied
// rewrite of the algorithm. Uses only pg_temp and always ROLLBACKs.
const source=fs.readFileSync(new URL('./patch-v2-durable-upsert-only-changed-DRAFT.sql',import.meta.url),'utf8')
assert.match(source,/DRAFT, not deployed/)
assert.equal((source.match(/on conflict\(id\) do update set/g)||[]).length,2)
assert.equal((source.match(/where public\.app_state\.data is distinct from excluded\.data/g)||[]).length,2)
assert.match(source,/Conflicto de sincronización/)
assert.match(source,/SET statement_timeout TO '90s'/)
assert.match(source,/for v_old_item in select value/)
assert.match(source,/for v_item in select value/)
const i=source.indexOf('CREATE OR REPLACE FUNCTION public.patch_v2_sections_cas(')
assert.ok(i>=0)
const isolated=source.slice(i).replaceAll('public.app_state_section_revisions','pg_temp.app_state_section_revisions')
 .replaceAll('public.app_state','pg_temp.app_state')
 .replace('public.patch_v2_sections_cas','pg_temp.patch_v2_sections_cas')
 .replaceAll('auth.uid()',"'11111111-1111-4111-8111-111111111111'::uuid")
 .replace("SET search_path TO 'public'","SET search_path TO 'pg_temp'")
assert.doesNotMatch(isolated,/(update|insert into|delete from|from)\s+public\.app_state\b/i)
assert.doesNotMatch(isolated,/auth\.uid\(\)/)
const script=`begin;
create temp table app_state(id text primary key,data jsonb not null,updated_at timestamptz,updated_by uuid);
create temp table app_state_section_revisions(section_key text primary key,updated_at timestamptz);
create temp table durable_write_audit(id text not null);
create function pg_temp.record_durable_write()
returns trigger language plpgsql as $audit$
begin
  insert into pg_temp.durable_write_audit(id) values(new.id);
  return new;
end;$audit$;
create trigger audit_durable_update after update on pg_temp.app_state
for each row when (old.id like 'movement_%')
execute function pg_temp.record_durable_write();
insert into pg_temp.app_state(id,data,updated_at)
values('main','{"movements":[{"id":"m1","qty":1},{"id":"m2","qty":2}],"orders":[],"cutBatches":[]}'::jsonb,clock_timestamp()),
('movement_m1','{"collection":"movements","item":{"id":"m1","qty":1}}'::jsonb,clock_timestamp()),
('movement_m2','{"collection":"movements","item":{"id":"m2","qty":2}}'::jsonb,clock_timestamp());
insert into pg_temp.app_state_section_revisions values('movements','2026-11-20T10:00:00Z');
${isolated}
select * from pg_temp.patch_v2_sections_cas(
 '{"movements":[{"id":"m1","qty":1},{"id":"m2","qty":3}]}'::jsonb,
 '{"movements":"2026-11-20T10:00:00Z"}'::jsonb,
 '11111111-1111-4111-8111-111111111111'::uuid);
do $check$ begin
 if (select count(*)<>1 from pg_temp.durable_write_audit) then
   raise exception 'Unchanged durable rows got rewritten';end if;
 if (select id<>'movement_m2' from pg_temp.durable_write_audit limit 1) then
   raise exception 'Wrong durable row updated';end if;
 if (select data #>> '{item,qty}'<>'3' from pg_temp.app_state where id='movement_m2') then
   raise exception 'Changed durable movement not saved';end if;
 if (select jsonb_array_length(data->'movements')<>2 from pg_temp.app_state where id='main') then
   raise exception 'Live movements lost';end if;
end $check$;
truncate table pg_temp.durable_write_audit;
select * from pg_temp.patch_v2_sections_cas(
 '{"movements":[{"id":"m1","qty":1}]}'::jsonb,
 jsonb_build_object('movements',(select updated_at::text from pg_temp.app_state_section_revisions where section_key='movements')),
 '11111111-1111-4111-8111-111111111111'::uuid);
do $check$ begin
 if (select count(*)<>1 from pg_temp.durable_write_audit) then
   raise exception 'Tombstone did not update exactly one removed movement';end if;
 if (select data->>'deleted'<>'true' from pg_temp.app_state where id='movement_m2') then
   raise exception 'Removed movement tombstone missing';end if;
 if (select data->'item' is null from pg_temp.app_state where id='movement_m1') then
   raise exception 'Unchanged movement lost';end if;
end $check$;
rollback;
`
assert.doesNotMatch(script,/\b(insert into|update|delete from)\s+public\.(app_state|app_state_section_revisions)/i)
assert.match(script,/rollback;\s*$/)
if(process.argv.includes('--check')){
 console.log('OK: conditional durable writes preserve CAS, changed rows, tombstones and fully isolated test transaction')
}else process.stdout.write(script)
