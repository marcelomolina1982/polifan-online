-- READ-ONLY STAGING of catalog metadata: already applied 2026-11-19.
-- Source of truth remains app_state.main. DO NOT deploy a write cutover yet.
-- The 161 image rows are already held in catalog_product_images.
begin;
create table if not exists public.catalog_product_metadata_v3 (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint product_metadata_object check(jsonb_typeof(payload)='object'),
  constraint product_metadata_matching_id check(payload->>'id'=id),
  constraint product_metadata_no_images check(not (payload ?| array['image','imageData','photo']))
);
alter table public.catalog_product_metadata_v3 enable row level security;
revoke all on table public.catalog_product_metadata_v3 from anon, authenticated;
grant select on table public.catalog_product_metadata_v3 to authenticated;
drop policy if exists catalog_product_metadata_v3_authenticated_read on public.catalog_product_metadata_v3;
create policy catalog_product_metadata_v3_authenticated_read
  on public.catalog_product_metadata_v3 for select to authenticated
  using ((select auth.uid()) is not null);
insert into public.catalog_product_metadata_v3(id,payload)
select p->>'id',p-'image'-'imageData'-'photo'
from public.app_state s
cross join lateral jsonb_array_elements(s.data->'customerCatalog') p
where s.id='main'
on conflict (id) do nothing;
commit;
-- NO UPDATE of existing metadata: never silently overwrite later edits.
