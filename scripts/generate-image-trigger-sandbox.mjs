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
assert.doesNotMatch(trigger,/public\.(app_state|catalog_product_images|compact_main_catalog_images_before_write)/,'Dry run may not reference live tables')
const script=`begin;
create temp table app_state(id text primary key,data jsonb not null);
create temp table catalog_product_images(
product_id text primary key,image text not null,
updated_at timestamptz not null default clock_timestamp());
insert into pg_temp.app_state(id,data) values('main',
'{"customerCatalog":[{"id":"demo1","name":"Heart","image":"data:image/jpeg;base64,YQ=="},{"id":"demo2","name":"Rainbow"}],"orders":[{"id":"order1"}]}'::jsonb);
insert into pg_temp.catalog_product_images(product_id,image)
values('demo1','data:image/jpeg;base64,YQ=='),
('demo2','data:image/webp;base64,Yg==');
${trigger}
-- First write: preserves orders and externalizes only embedded image.
update pg_temp.app_state set data=jsonb_set(data,'{orders}',
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
end $test$;
-- Image update: same transaction writes image and changes catalog URL.
update pg_temp.app_state set data=jsonb_set(data,'{customerCatalog,0,image}',
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
update pg_temp.app_state set data=jsonb_set(data,'{customerCatalog}',
(data->'customerCatalog')||
'[{"id":"demo3","name":"New","image":"data:image/jpeg;base64,Yw=="}]'::jsonb)
where id='main';
do $test$ begin
 if (select count(*)<>3 from pg_temp.catalog_product_images) then
   raise exception 'New product image was not inserted';end if;
 if (select jsonb_array_length(data->'customerCatalog')<>3
 from pg_temp.app_state where id='main') then
   raise exception 'New product was not preserved';end if;
end $test$;
-- Bad images must be rejected without modifying operational JSON.
do $test$ begin
  begin
    update pg_temp.app_state set data=jsonb_set(data,'{customerCatalog,0,image}',
    '"data:image/invalid;base64,YQ=="'::jsonb) where id='main';
    raise exception 'Invalid image was incorrectly accepted';
  exception when sqlstate '22023' then
    null;
  end;
  if (select jsonb_array_length(data->'orders')<>2
  from pg_temp.app_state where id='main') then
    raise exception 'Invalid image harmed orders';end if;
end $test$;
-- Nothing in this script persists, including the images and trigger.
rollback;
`
assert.doesNotMatch(script,/\b(update|delete from|insert into|truncate)\s+public\.(app_state|catalog_product_images)\b/i)
assert.match(script,/rollback;\s*$/)
if(process.argv.includes('--check')){
 console.log('OK: PostgreSQL sandbox generation uses only pg_temp data and ends with ROLLBACK')
}else process.stdout.write(script)
