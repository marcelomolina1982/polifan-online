-- DEMO ONLY: synthetic fixtures for independent PG17 backup / restore CI.
-- Never insert these rows into Supabase production.
do $guard$ begin
 if current_database()<>'sandbox' then
  raise exception 'Synthetic backup fixture can run only in sandbox';
 end if;
end $guard$;
create table public.app_state(
 id text primary key,
 data jsonb not null,
 updated_at timestamptz not null
);
create table public.catalog_product_images(
 product_id text primary key,
 image text not null
);
create table public.catalog_product_metadata_v3(
 id text primary key,
 payload jsonb not null
);
create table public.public_catalog_items(
 id text primary key,
 payload jsonb not null
);
create function public.patch_v2_sections_cas(
  p_patch jsonb,p_expected_revisions jsonb,p_updated_by uuid default null)
returns table(updated_at timestamptz)
language sql as $func$ select '2026-11-20T12:00:00Z'::timestamptz $func$;

insert into public.app_state(id,data,updated_at)
values
 ('main',jsonb_build_object(
   'customerCatalog',jsonb_build_array(
      jsonb_build_object('id','demo_a','name','Synthetic A','image','data:image/png;base64,YQ=='),
      jsonb_build_object('id','demo_b','name','Synthetic B','image','data:image/png;base64,Yg=='),
      jsonb_build_object('id','demo_c','name','Synthetic C','image','data:image/png;base64,Yw==')
   ),
   'orders',jsonb_build_array(
      jsonb_build_object('id','order1','total',12,'items',jsonb_build_array()),
      jsonb_build_object('id','order2','total',20,'items',jsonb_build_array())
   ),
   'movements',jsonb_build_array(
      jsonb_build_object('id','move1','qty',1),
      jsonb_build_object('id','move2','qty',2),
      jsonb_build_object('id','move3','qty',3),
      jsonb_build_object('id','move4','qty',4)
   ),
   'cutBatches',jsonb_build_array(jsonb_build_object('id','batch1'))
 ),'2026-11-20T12:00:00Z'),
 ('order_order1','{"collection":"orders","item":{"id":"order1","total":12,"items":[]}}','2026-11-20T12:00:00Z'),
 ('order_order2','{"collection":"orders","item":{"id":"order2","total":20,"items":[]}}','2026-11-20T12:00:00Z'),
 ('movement_move1','{"collection":"movements","item":{"id":"move1","qty":1}}','2026-11-20T12:00:00Z'),
 ('movement_move2','{"collection":"movements","item":{"id":"move2","qty":2}}','2026-11-20T12:00:00Z'),
 ('movement_move3','{"collection":"movements","item":{"id":"move3","qty":3}}','2026-11-20T12:00:00Z'),
 ('movement_move4','{"collection":"movements","item":{"id":"move4","qty":4}}','2026-11-20T12:00:00Z'),
 ('batch_batch1','{"collection":"cutBatches","item":{"id":"batch1"}}','2026-11-20T12:00:00Z');

insert into public.catalog_product_images(product_id,image)
values ('demo_a','data:image/png;base64,YQ=='),
       ('demo_b','data:image/png;base64,Yg=='),
       ('demo_c','data:image/png;base64,Yw==');
insert into public.catalog_product_metadata_v3(id,payload)
values ('demo_a','{"id":"demo_a","name":"Synthetic A"}'),
       ('demo_b','{"id":"demo_b","name":"Synthetic B"}'),
       ('demo_c','{"id":"demo_c","name":"Synthetic C"}');
insert into public.public_catalog_items(id,payload)
values ('demo_a','{"id":"demo_a","name":"Synthetic A"}'),
       ('demo_b','{"id":"demo_b","name":"Synthetic B"}'),
       ('demo_c','{"id":"demo_c","name":"Synthetic C"}');
