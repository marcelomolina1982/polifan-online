-- TEST FIXTURE ONLY. Adapted from live sync_public_catalog_items as of 2026-11-19.
-- Every table and function reference is pg_temp; never deploy this fixture.
-- The real function must be rechecked against this fixture before release.
CREATE OR REPLACE FUNCTION pg_temp.sync_public_catalog_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_temp'
AS $function$
begin
  if new.id<>'main' then return new; end if;
  if tg_op='UPDATE' and old.data->'customerCatalog' is not distinct from new.data->'customerCatalog' then return new; end if;

  delete from pg_temp.public_catalog_items p
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(new.data->'customerCatalog','[]'::jsonb)) n(item)
    where coalesce(n.item->>'id',md5(n.item::text))=p.id
  );

  insert into pg_temp.public_catalog_items(id,payload,image,updated_at)
  select coalesce(n.item->>'id',md5(n.item::text)),
         n.item-'image'-'svg'-'svgBase'-'svgTapa'-'svgContent'-'baseSvg'-'tapaSvg'-'pathData'-'vectorData'-'sourceSvg',
         n.item->>'image',new.updated_at
  from jsonb_array_elements(coalesce(new.data->'customerCatalog','[]'::jsonb)) n(item)
  left join jsonb_array_elements(coalesce(old.data->'customerCatalog','[]'::jsonb)) o(item)
    on coalesce(o.item->>'id',md5(o.item::text))=coalesce(n.item->>'id',md5(n.item::text))
  where o.item is distinct from n.item
  on conflict(id) do update set
    payload=excluded.payload,image=excluded.image,updated_at=excluded.updated_at;

  insert into pg_temp.public_catalog_revision(id,updated_at)
  values('main',new.updated_at)
  on conflict(id) do update set updated_at=excluded.updated_at;
  return new;
end;
$function$;
