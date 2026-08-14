create table if not exists public.public_catalog (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.public_catalog enable row level security;

drop policy if exists "public_catalog_anon_read" on public.public_catalog;
create policy "public_catalog_anon_read"
on public.public_catalog
for select
to anon
using (id='main');

drop policy if exists "public_catalog_auth_read" on public.public_catalog;
create policy "public_catalog_auth_read"
on public.public_catalog
for select
to authenticated
using (true);

drop policy if exists "public_catalog_auth_insert" on public.public_catalog;
create policy "public_catalog_auth_insert"
on public.public_catalog
for insert
to authenticated
with check (id='main');

drop policy if exists "public_catalog_auth_update" on public.public_catalog;
create policy "public_catalog_auth_update"
on public.public_catalog
for update
to authenticated
using (id='main')
with check (id='main');

grant select on public.public_catalog to anon;
grant select,insert,update on public.public_catalog to authenticated;
