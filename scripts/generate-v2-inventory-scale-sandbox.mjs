import assert from 'node:assert/strict'
import fs from 'node:fs'

// Reproduce operational-scale data *without copying any customer information*.
// node scripts/generate-v2-inventory-scale-sandbox.mjs > /tmp/v2-inventory-scale.sql
// Carefully review it and run only within a rollback transaction.
const draft=fs.readFileSync(new URL('./patch-v2-set-based-durable-sync-DRAFT.sql',import.meta.url),'utf8')
const start=draft.indexOf('CREATE OR REPLACE FUNCTION public.patch_v2_sections_cas(')
assert.ok(start>=0,'SQL draft not found')
const isolated=draft.slice(start)
 .replaceAll('public.app_state_section_revisions','pg_temp.app_state_section_revisions')
 .replaceAll('public.app_state','pg_temp.app_state')
 .replace('public.patch_v2_sections_cas','pg_temp.patch_v2_sections_cas')
 .replaceAll('auth.uid()',"'11111111-1111-4111-8111-111111111111'::uuid")
 .replace("SET search_path TO 'public'","SET search_path TO 'pg_temp'")
assert.doesNotMatch(isolated,/\b(?:update|from|into|join|delete from)\s+public\.app_state\b/i)
assert.doesNotMatch(isolated,/auth\.uid\(\)/)
assert.match(isolated,/left join pg_temp\.app_state d/)
assert.match(isolated,/for v_name, v_prefix in values/)
const array=(end)=>`(select jsonb_build_object('movements',jsonb_agg(
 case when n=100 then jsonb_build_object('id','m100','qty',2)
 else jsonb_build_object('id','m'||n,'qty',1) end order by n))
 from generate_series(1,${end}) g(n))`
const currentRevision=`jsonb_build_object('movements',
 (select updated_at::text from pg_temp.app_state_section_revisions
 where section_key='movements'))`
const sql=`begin;
set local statement_timeout='8s';
create temp table app_state(id text primary key,data jsonb not null,
 updated_at timestamptz,updated_by uuid);
create temp table app_state_section_revisions(section_key text primary key,
 updated_at timestamptz);
create temp table updated_durable(id text not null);
create function pg_temp.audit_durable_update()
returns trigger language plpgsql as $audit$
begin insert into pg_temp.updated_durable(id) values(new.id);return new;end;
$audit$;
create trigger durable_audit after update on pg_temp.app_state
for each row when (old.id like 'movement_%')
execute function pg_temp.audit_durable_update();
insert into pg_temp.app_state(id,data,updated_at)
select 'main',jsonb_build_object(
 'movements',(select jsonb_agg(jsonb_build_object('id','m'||n,'qty',1)
 order by n) from generate_series(1,3326) g(n)),
 'orders','[]'::jsonb,'cutBatches','[]'::jsonb),clock_timestamp();
insert into pg_temp.app_state(id,data,updated_at)
select 'movement_m'||n,
 jsonb_build_object('collection','movements',
 'item',jsonb_build_object('id','m'||n,'qty',1)),
 clock_timestamp() from generate_series(1,3326) g(n);
insert into pg_temp.app_state_section_revisions values
 ('movements','2026-11-20T10:00:00Z');
${isolated}
-- A single changed quantity should update a single durable row.
do $test$ begin
 perform * from pg_temp.patch_v2_sections_cas(
 ${array(3326)},'{"movements":"2026-11-20T10:00:00Z"}'::jsonb,
 '11111111-1111-4111-8111-111111111111'::uuid);
 if (select count(*)<>1 from pg_temp.updated_durable)
 then raise exception 'Changed one quantity, updated multiple rows';end if;
 if (select id<>'movement_m100' from pg_temp.updated_durable limit 1)
 then raise exception 'Changed wrong row';end if;
 if (select data #>> '{item,qty}'<>'2'
 from pg_temp.app_state where id='movement_m100')
 then raise exception 'Changed quantity not saved';end if;
 if (select count(*)<>3326 from pg_temp.app_state
 where id like 'movement_%')
 then raise exception 'Unexpected loss of movements';end if;
end $test$;
truncate pg_temp.updated_durable;
-- A second identical patch should not UPDATE any durable row.
do $test$ begin
 perform * from pg_temp.patch_v2_sections_cas(
 ${array(3326)},${currentRevision},
 '11111111-1111-4111-8111-111111111111'::uuid);
 if (select count(*)<>0 from pg_temp.updated_durable)
 then raise exception 'No-op save rewrote durable records';end if;
end $test$;
truncate pg_temp.updated_durable;
-- Removing one element must preserve a durable tombstone.
do $test$ begin
 perform * from pg_temp.patch_v2_sections_cas(
 ${array(3325)},${currentRevision},
 '11111111-1111-4111-8111-111111111111'::uuid);
 if (select count(*)<>1 from pg_temp.updated_durable)
 then raise exception 'Expected one tombstone UPDATE';end if;
 if (select data->>'deleted'<>'true' from pg_temp.app_state
 where id='movement_m3326')
 then raise exception 'Missing removed movement marker';end if;
 if (select jsonb_array_length(data->'movements')<>3325
 from pg_temp.app_state where id='main')
 then raise exception 'Main movements array changed incorrectly';end if;
end $test$;
rollback;
`
assert.doesNotMatch(sql,/\b(?:insert into|update|delete from|alter table)\s+public\.(?:app_state|app_state_section_revisions)\b/i)
assert.match(sql,/rollback;\s*$/)
if(process.argv.includes('--check')){
 console.log('OK: operational-scale 3326 synthetic movements; single update, no-op, tombstone; pg_temp + rollback')
}else process.stdout.write(sql)
