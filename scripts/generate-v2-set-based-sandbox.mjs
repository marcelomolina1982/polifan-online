import assert from 'node:assert/strict'
import fs from 'node:fs'

// This is an opt-in, entirely synthetic database test. It NEVER reads
// business rows. Render SQL with: node scripts/generate-v2-set-based-sandbox.mjs
// Then inspect it and run in a Postgres session; it ends with ROLLBACK.
const source=fs.readFileSync(new URL('./patch-v2-set-based-durable-sync-DRAFT.sql',import.meta.url),'utf8')
const original=fs.readFileSync(new URL('./fixtures/patch-v2-original-reference.sql',import.meta.url),'utf8')
assert.match(source,/Set-based durable synchronization/)
assert.match(source,/left join public\.app_state d/)
assert.match(source,/where d\.id is null/)
assert.match(source,/d\.data is distinct from jsonb_build_object/)
assert.match(source,/left join jsonb_array_elements\(v_new->v_name\) n\(item\)/)
assert.equal((source.match(/on conflict\(id\) do update/g)||[]).length,2)
assert.equal((source.match(/where public\.app_state\.data is distinct from excluded\.data/g)||[]).length,2)
assert.match(source,/Conflicto de sincronización/)
assert.match(source,/orders contiene totales negativos/)
assert.match(source,/movements contiene cantidades negativas/)
assert.match(source,/deletedAt/)
assert.match(original,/for v_old_item in select value/)
function toTempFunction(sql,name){
 const start=sql.indexOf('CREATE OR REPLACE FUNCTION public.patch_v2_sections_cas(')
 assert.ok(start>0,'Expected V2 function')
 const result=sql.slice(start)
  .replaceAll('public.app_state_section_revisions','pg_temp.app_state_section_revisions')
  .replaceAll('public.app_state','pg_temp.app_state')
  .replace('public.patch_v2_sections_cas(',`pg_temp.${name}(`)
  .replaceAll('auth.uid()',"'11111111-1111-4111-8111-111111111111'::uuid")
  .replace("SET search_path TO 'public'","SET search_path TO 'pg_temp'")
 assert.doesNotMatch(result,/(?:from|update|insert into|join)\s+public\.app_state\b/i)
 assert.doesNotMatch(result,/auth\.uid\(\)/)
 return result
}
const old=toTempFunction(original,'old_v2_baseline')
const next=toTempFunction(source,'new_v2_setbased')
const seed=`insert into pg_temp.app_state(id,data,updated_at)
select 'main',jsonb_build_object(
 'movements',(select jsonb_agg(jsonb_build_object('id','m'||n,'qty',1) order by n)
 from generate_series(1,180) x(n)),
 'orders','[{"id":"o1","total":10,"items":[]}]'::jsonb,
 'cutBatches','[{"id":"b1"}]'::jsonb),clock_timestamp();
insert into pg_temp.app_state(id,data,updated_at)
select 'movement_m'||n,jsonb_build_object('collection','movements',
 'item',jsonb_build_object('id','m'||n,'qty',1)),clock_timestamp()
from generate_series(1,180) x(n);
insert into pg_temp.app_state(id,data,updated_at) values
 ('order_o1','{"collection":"orders","item":{"id":"o1","total":10,"items":[]}}',clock_timestamp()),
 ('batch_b1','{"collection":"cutBatches","item":{"id":"b1"}}',clock_timestamp());
insert into pg_temp.app_state_section_revisions values
 ('movements','2026-11-20T10:00:00Z'),
 ('orders','2026-11-20T10:00:00Z'),
 ('cutBatches','2026-11-20T10:00:00Z');
`
const execute=name=>`do $test$ begin
 perform * from pg_temp.${name}(
 (select jsonb_build_object('movements',
 jsonb_agg(case when n=100 then jsonb_build_object('id','m100','qty',3)
 else jsonb_build_object('id','m'||n,'qty',1) end order by n))
 from generate_series(1,180) x(n)),
 '{"movements":"2026-11-20T10:00:00Z"}'::jsonb,
 '11111111-1111-4111-8111-111111111111'::uuid);
end $test$;
`
const script=`begin;
set local statement_timeout='7s';
create temp table app_state(id text primary key,data jsonb not null,
 updated_at timestamptz,updated_by uuid);
create temp table app_state_section_revisions(section_key text primary key,
 updated_at timestamptz);
create temp table durable_write_audit(id text not null);
create function pg_temp.track_durable_updates() returns trigger
language plpgsql as $t$
begin insert into pg_temp.durable_write_audit(id) values(new.id);return new;end;$t$;
create trigger movement_audit after update on pg_temp.app_state for each row
when (old.id like 'movement_%')
execute function pg_temp.track_durable_updates();
${old}
${next}
${seed}
${execute('old_v2_baseline')}
do $check$ begin
 if (select count(*)<>180 from pg_temp.durable_write_audit)
 then raise exception 'Original V2 did not update all 180 rows';end if;
end $check$;
truncate pg_temp.app_state,pg_temp.app_state_section_revisions,
 pg_temp.durable_write_audit;
${seed}
${execute('new_v2_setbased')}
do $check$ begin
 if (select count(*)<>1 from pg_temp.durable_write_audit)
 then raise exception 'Set-based function rewrote unchanged movement rows';end if;
 if (select id<>'movement_m100' from pg_temp.durable_write_audit limit 1)
 then raise exception 'Wrong durable movement updated';end if;
 if (select data #>> '{item,qty}'<>'3' from pg_temp.app_state where id='movement_m100')
 then raise exception 'Changed qty not persisted';end if;
 if (select count(*)<>180 from pg_temp.app_state where id like 'movement_%')
 then raise exception 'Movement lost';end if;
 if (select data #>> '{item,id}'<>'o1' from pg_temp.app_state where id='order_o1')
 then raise exception 'Order lost';end if;
end $check$;
truncate pg_temp.durable_write_audit;
do $check$ begin
 perform * from pg_temp.new_v2_setbased(
 (select jsonb_build_object('movements',
 jsonb_agg(case when n=100 then jsonb_build_object('id','m100','qty',3)
 else jsonb_build_object('id','m'||n,'qty',1) end order by n))
 from generate_series(1,179) x(n)),
 jsonb_build_object('movements',
 (select updated_at::text from pg_temp.app_state_section_revisions where section_key='movements')),
 '11111111-1111-4111-8111-111111111111'::uuid);
 if (select count(*)<>1 from pg_temp.durable_write_audit)
 then raise exception 'Expected one deletion tombstone';end if;
 if (select data->>'deleted'<>'true' from pg_temp.app_state where id='movement_m180')
 then raise exception 'Missing deleted marker';end if;
end $check$;
rollback;
`
assert.doesNotMatch(script,/(?:insert into|update|delete from|alter table)\s+public\.(app_state|app_state_section_revisions)/i)
assert.match(script,/rollback;\s*$/)
if(process.argv.includes('--check')){
 console.log('OK: exact original/set-based SQL sandbox compares 180 vs 1 row updates, tombstones, orders, CAS, ROLLBACK')
}else process.stdout.write(script)
