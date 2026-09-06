-- El seguimiento sólo se recalcula si realmente cambiaron los pedidos.
drop trigger if exists trg_sync_order_tracking on public.app_state;
drop trigger if exists trg_sync_order_tracking_insert on public.app_state;
drop trigger if exists trg_sync_order_tracking_update on public.app_state;
create trigger trg_sync_order_tracking_insert
before insert on public.app_state
for each row when (new.id='main') execute function public.sync_order_tracking_from_app_state();
create trigger trg_sync_order_tracking_update
before update of data on public.app_state
for each row when (new.id='main' and old.data->'orders' is distinct from new.data->'orders')
execute function public.sync_order_tracking_from_app_state();

-- Al editar el catálogo sincroniza sólo las figuras nuevas, modificadas o eliminadas.
create or replace function public.sync_public_catalog_items()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.id<>'main' then return new; end if;
  if tg_op='UPDATE' and old.data->'customerCatalog' is not distinct from new.data->'customerCatalog' then return new; end if;

  delete from public.public_catalog_items p
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(new.data->'customerCatalog','[]'::jsonb)) n(item)
    where coalesce(n.item->>'id',md5(n.item::text))=p.id
  );

  insert into public.public_catalog_items(id,payload,image,updated_at)
  select coalesce(n.item->>'id',md5(n.item::text)),
         n.item-'image'-'svg'-'svgBase'-'svgTapa'-'svgContent'-'baseSvg'-'tapaSvg'-'pathData'-'vectorData'-'sourceSvg',
         n.item->>'image',new.updated_at
  from jsonb_array_elements(coalesce(new.data->'customerCatalog','[]'::jsonb)) n(item)
  left join jsonb_array_elements(coalesce(old.data->'customerCatalog','[]'::jsonb)) o(item)
    on coalesce(o.item->>'id',md5(o.item::text))=coalesce(n.item->>'id',md5(n.item::text))
  where o.item is distinct from n.item
  on conflict(id) do update set
    payload=excluded.payload,image=excluded.image,updated_at=excluded.updated_at;

  insert into public.public_catalog_revision(id,updated_at)
  values('main',new.updated_at)
  on conflict(id) do update set updated_at=excluded.updated_at;
  return new;
end;
$$;

revoke all on function public.sync_public_catalog_items() from public,anon,authenticated;
