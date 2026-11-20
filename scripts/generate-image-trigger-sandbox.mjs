// Generate a PostgreSQL-only regression test of the EXACT draft trigger.
// The resulting script uses exclusively pg_temp tables and always ROLLBACKs.
// Run with: node scripts/generate-image-trigger-sandbox.mjs > /tmp/image-test.sql
// Review /tmp/image-test.sql before running it with a development connection.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync(new URL('./catalog-image-externalization-TRIGGER-DRAFT.sql',import.meta.url),'utf8')
const start=sql.indexOf('\nbegin;\n'),end=sql.indexOf('\ncommit;',start)
assert.ok(start!==-1&&end>start,'Cannot locate draft body')
assert.equal((sql.match(/\ncommit;/g)||[]).length,1,'Draft must contain one transaction only')
const trigger=sql.slice(start+8,end)
  .replaceAll('public.catalog_product_images','pg_temp.catalog_product_images')
  .replaceAll('public.app_state','pg_temp.app_state')
  .replaceAll('public.compact_main_catalog_images_before_write','pg_temp.compact_main_catalog_images_before_write')
  .replace("table_schema='public'","table_schema like 'pg_temp_%'")
assert.doesNotMatch(trigger,/public\.(app_state|catalog_product_images|compact_main_catalog_images_before_write)/,'Dry run may not reference live tables')
const syncFixture=fs.readFileSync(new URL('./fixtures/sync-public-catalog-items-temp.sql',import.meta.url),'utf8')
assert.doesNotMatch(syncFixture,/public\.(app_state|public_catalog_items|public_catalog_revision|sync_public_catalog_items)/)
assert.match(syncFixture,/pg_temp\.sync_public_catalog_items/)
const script=`begin;
create temp table app_state(id text primary key,data jsonb not null,updated_at text not null default 'R1',catalog_write_nonce uuid,catalog_image_compaction_enabled boolean not null default false);
create temp table catalog_product_images(
product_id text primary key,image text not null,
updated_at timestamptz not null default clock_timestamp());
create temp table public_catalog_items(id text primary key,payload jsonb not null,image text,updated_at text not null);
create temp table public_catalog_revision(id text primary key,updated_at text not null);
insert into pg_temp.app_state(id,data) values('main',
'{"customerCatalog":[{"id":"demo1","name":"Heart","image":"data:image/jpeg;base64,YQ=="},{"id":"demo2","name":"Rainbow"}],"orders":[{"id":"order1"}]}'::jsonb);
insert into pg_temp.catalog_product_images(product_id,image)
values('demo1','data:image/jpeg;base64,YQ=='),
('demo2','data:image/webp;base64,Yg==');
-- Pretend the last saved row came from the prepared client.
update pg_temp.app_state set catalog_write_nonce='00000000-0000-4000-8000-000000000099' where id='main';
insert into pg_temp.public_catalog_items(id,payload,image,updated_at) values
('demo1','{"id":"demo1","name":"Heart"}','data:image/jpeg;base64,YQ==','R1'),
('demo2','{"id":"demo2","name":"Rainbow"}',null,'R1');
${trigger}
${syncFixture}
create trigger sync_public_catalog_items_temp after update of data on pg_temp.app_state for each row
execute function pg_temp.sync_public_catalog_items();
-- After installing the trigger in the same transaction, enable its
-- client readback flag for all future save requests.
do $test$ begin
  if (select catalog_image_compaction_enabled is not true from pg_temp.app_state where id='main')
    then raise exception 'Client canonicalization flag not enabled';end if;
end $test$;
-- Old tabs do not send a new per-write nonce and must be rejected.
do $test$ declare accepted boolean := false; begin
  begin
    update pg_temp.app_state set data=jsonb_set(data,'{orders}',
    '[{"id":"should-not-save"}]'::jsonb) where id='main';
    accepted := true;
  exception when sqlstate 'P0001' then null;
  end;
  if accepted then raise exception 'Old client incorrectly accepted' using errcode='22023';end if;
  if (select data #>> '{orders,0,id}'<>'order1' from pg_temp.app_state where id='main')
    then raise exception 'Old client changed orders';end if;
end $test$;
-- First write: preserves orders and externalizes only embedded image.
update pg_temp.app_state set catalog_write_nonce='00000000-0000-4000-8000-000000000001',data=jsonb_set(data,'{orders}',
'[{"id":"order1"},{"id":"order2"}]'::jsonb) where id='main';
do $test$ begin
 if (select data #>> '{customerCatalog,0,image}' not like
 'https://eftksimpkkvmyfurwqii.supabase.co/functions/v1/catalog-image?id=demo1&v=%'
 from pg_temp.app_state where id='main') then
   raise exception 'Embedded image not converted to a public URL';end if;
 if (select jsonb_array_length(data->'orders')<>2
 from pg_temp.app_state where id='main') then
   raise exception 'Orders were altered';end if;
 if (select data #>> '{customerCatalog,1,image}' not like
 'https://eftksimpkkvmyfurwqii.supabase.co/functions/v1/catalog-image?id=demo2&v=%'
 from pg_temp.app_state where id='main') then
   raise exception 'Image absent from old JSON not restored via link';end if;
 if (select count(*)<>2 from pg_temp.catalog_product_images) then
   raise exception 'Unchanged image was duplicated';end if;
 if (select count(*)<>2 from pg_temp.public_catalog_items where image like 'https://%') then
   raise exception 'Public catalog items not synchronized';end if;
 if (select count(*)<>0 from pg_temp.public_catalog_items where image like 'data:%') then
   raise exception 'Public catalog still contains embedded image';end if;
end $test$;
-- Image update: same transaction writes image and changes catalog URL.
update pg_temp.app_state set catalog_write_nonce='00000000-0000-4000-8000-000000000002',data=jsonb_set(data,'{customerCatalog,0,image}',
'"data:image/jpeg;base64,Yg=="'::jsonb) where id='main';
do $test$ begin
 if (select image<>'data:image/jpeg;base64,Yg=='
 from pg_temp.catalog_product_images where product_id='demo1') then
   raise exception 'Updated image was not persisted';end if;
 if (select data #>> '{customerCatalog,0,image}' like 'data:%'
 from pg_temp.app_state where id='main') then
   raise exception 'Updated image remained embedded';end if;
end $test$;
-- New product: insert its image through the same trigger.
update pg_temp.app_state set catalog_write_nonce='00000000-0000-4000-8000-000000000003',data=jsonb_set(data,'{customerCatalog}',
(data->'customerCatalog')||
'[{"id":"demo3","name":"New","image":"data:image/jpeg;base64,Yw=="}]'::jsonb)
where id='main';
do $test$ begin
 if (select count(*)<>3 from pg_temp.catalog_product_images) then
   raise exception 'New product image was not inserted';end if;
 if (select count(*)<>3 from pg_temp.public_catalog_items) then
   raise exception 'New product absent from published items';end if;
 if (select jsonb_array_length(data->'customerCatalog')<>3
 from pg_temp.app_state where id='main') then
   raise exception 'New product was not preserved';end if;
end $test$;
-- Bad images must be rejected without modifying operational JSON.
do $test$ begin
  begin
    update pg_temp.app_state set catalog_write_nonce='00000000-0000-4000-8000-000000000004',data=jsonb_set(data,'{customerCatalog,0,image}',
    '"data:image/invalid;base64,YQ=="'::jsonb) where id='main';
    raise exception 'Invalid image was incorrectly accepted';
  exception when sqlstate '22023' then
    null;
  end;
  if (select jsonb_array_length(data->'orders')<>2
  from pg_temp.app_state where id='main') then
    raise exception 'Invalid image harmed orders';end if;
end $test$;
-- Computer B saves a newer image; A cannot revert it with stale revision.
update pg_temp.app_state set updated_at='R2' where id='main' and updated_at='R1';
update pg_temp.app_state set catalog_write_nonce='00000000-0000-4000-8000-000000000005',data=jsonb_set(data,'{customerCatalog,0,image}',
'"data:image/jpeg;base64,TkVX"'::jsonb),updated_at='R3'
where id='main' and updated_at='R2';
do $test$ declare affected integer; begin
  if (select image<>'data:image/jpeg;base64,TkVX'
  from pg_temp.catalog_product_images where product_id='demo1') then
    raise exception 'Newer image not stored';end if;
  update pg_temp.app_state set catalog_write_nonce='00000000-0000-4000-8000-000000000006',data=jsonb_set(data,'{customerCatalog,0,image}',
  '"data:image/jpeg;base64,YQ=="'::jsonb),updated_at='R4'
  where id='main' and updated_at='R2';
  get diagnostics affected = row_count;
  if affected<>0 then raise exception 'Stale client overwrote a newer image';end if;
  if (select image<>'data:image/jpeg;base64,TkVX'
  from pg_temp.catalog_product_images where product_id='demo1') then
    raise exception 'Image reverted despite revision guard';end if;
  if (select updated_at<>'R3' from pg_temp.app_state where id='main') then
    raise exception 'Revision changed during stale attempt';end if;
end $test$;
-- Nothing in this script persists, including the images and trigger.
rollback;
`
assert.doesNotMatch(script,/\b(update|delete from|insert into|truncate)\s+public\.(app_state|catalog_product_images|public_catalog_items|public_catalog_revision)\b/i)
assert.match(script,/rollback;\s*$/)
if(process.argv.includes('--check')){
 console.log('OK: PostgreSQL sandbox generation uses only pg_temp data and ends with ROLLBACK')
}else process.stdout.write(script)
