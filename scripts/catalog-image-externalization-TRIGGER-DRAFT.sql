-- DRAFT — DO NOT APPLY UNTIL END-TO-END TESTS AND ROLLBACK ARE VERIFIED.
-- This retains the legacy app_state JSON structure, all order data and the
-- full customerCatalog array. It externalizes only embedded data:image URLs.
-- Existing catalog images live in catalog_product_images and the public Edge
-- Function catalog-image is ACTIVE (verify_jwt=false), with versioned caching.
--
-- BEFORE UPDATE: image UPSERT and compact main JSON happen in one SQL
-- transaction. A failed main update / guarded conflict rolls both back.
-- Old clients without the new nonce are rejected; updated clients get HTTP URLs.
--
-- IMPORTANT: This is a migration prototype, not authorized for production.
begin;
-- Fail quickly during business activity; never wait indefinitely on writes.
set local lock_timeout='500ms';
set local statement_timeout='15s';
-- PREREQUISITE: First run catalog-write-nonce-preparation-DRAFT.sql, THEN
-- deploy the new web client that changes the nonce on every UPDATE.
-- Older open tabs omit the nonce and are rejected after cutover.
do $preflight$ begin
  -- Lock the canonical row before checking; no other computer can update
  -- it between this audit and transaction commit.
  perform 1 from public.app_state where id='main' for update;
  if not found then
    raise exception 'Main state missing; refusing cutover' using errcode='23514';
  end if;
  if (select catalog_image_compaction_enabled from public.app_state where id='main') then
    raise exception 'Compaction already enabled; refusing second activation'
      using errcode='22023';
  end if;
  if (select catalog_write_nonce is null from public.app_state where id='main') then
    raise exception 'No verified save from a new browser since deployment'
      using errcode='22023';
  end if;
  if (select jsonb_array_length(data->'customerCatalog') < 100
      from public.app_state where id='main') then
    raise exception 'Main catalog unexpectedly small' using errcode='23514';
  end if;
  if (select jsonb_array_length(data->'customerCatalog') from public.app_state where id='main')
     is distinct from
     (select count(*) from public.catalog_product_images) then
    raise exception 'Catalog and images count mismatch' using errcode='23514';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='app_state'
      and column_name='catalog_write_nonce' and udt_name='uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='app_state'
      and column_name='catalog_image_compaction_enabled' and udt_name='bool'
  ) then
    raise exception 'App version gate missing; run preparation and deploy tested client before trigger';
  end if;
end $preflight$;
create or replace function public.compact_main_catalog_images_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p jsonb;
  image_text text;
  existing_image text;
  image_revision timestamptz;
  v_product_id text;
  compact_products jsonb := '[]'::jsonb;
  image_url text;
begin
  if new.id is distinct from 'main' then return new; end if;
  if new.catalog_write_nonce is null
     or new.catalog_write_nonce is not distinct from old.catalog_write_nonce then
    raise exception 'Esta versión de Gestión Polifan necesita actualizarse: recargá antes de guardar'
      using errcode='P0001';
  end if;
  if jsonb_typeof(new.data->'customerCatalog') is distinct from 'array' then
    raise exception 'Missing customerCatalog: refusing destructive write'
      using errcode='22023';
  end if;
  -- All already-externalized saves pass through without extra image reads.
  if not exists(
    select 1
    from pg_catalog.jsonb_array_elements(new.data->'customerCatalog') item
    where item->>'image' like 'data:image/%'
  ) then return new; end if;

  for p in select value from pg_catalog.jsonb_array_elements(new.data->'customerCatalog')
  loop
    image_text := p->>'image';
    if image_text like 'data:image/%' then
      v_product_id := p->>'id';
      if v_product_id is null or length(v_product_id)>160 or
         v_product_id !~ '^[A-Za-z0-9._~-]+$' then
        raise exception 'Cannot safely encode catalog image identifier'
          using errcode='22023';
      end if;
      if image_text !~ '^data:image/(jpeg|png|webp|gif);base64,' or
         length(image_text)>8000000 then
        raise exception 'Unsupported image type or size' using errcode='22023';
      end if;
      image_revision := null;
      existing_image := null;
      select i.image,i.updated_at into existing_image,image_revision
      from public.catalog_product_images i
      where i.product_id=v_product_id;
      if existing_image is distinct from image_text then
        insert into public.catalog_product_images(product_id,image,updated_at)
          values(v_product_id,image_text,pg_catalog.clock_timestamp())
        on conflict (product_id)
        do update set
          image=excluded.image,
          updated_at=greatest(pg_catalog.clock_timestamp(),
                    public.catalog_product_images.updated_at+interval '1 microsecond')
        where public.catalog_product_images.image is distinct from excluded.image
        returning updated_at into image_revision;
        if image_revision is null then
          -- Concurrent attempt inserting the identical image.
          select i.updated_at into image_revision
          from public.catalog_product_images i where i.product_id=v_product_id;
        end if;
      end if;
      if image_revision is null then
        raise exception 'Image was not safely persisted' using errcode='23514';
      end if;
      image_url := 'https://eftksimpkkvmyfurwqii.supabase.co/functions/v1/catalog-image?id='
        || v_product_id
        || '&v=' || pg_catalog.floor(extract(epoch from image_revision))::bigint
        || '&rev=' || pg_catalog.round(extract(epoch from image_revision)*1000000)::bigint;
      p := pg_catalog.jsonb_set(p,'{image}',pg_catalog.to_jsonb(image_url),true);
    elsif image_text is null or image_text = '' then
      -- Link images already stored separately, without rewriting their bytes.
      -- Preserve any explicit nonempty URL in existing product metadata.
      v_product_id := p->>'id';
      if v_product_id is null or length(v_product_id)>160 or
         v_product_id !~ '^[A-Za-z0-9._~-]+$' then
        raise exception 'Invalid product identifier for linked image'
          using errcode='22023';
      end if;
      image_revision := null;
      select i.updated_at into image_revision
      from public.catalog_product_images i where i.product_id=v_product_id;
      if image_revision is not null then
        image_url := 'https://eftksimpkkvmyfurwqii.supabase.co/functions/v1/catalog-image?id='
          || v_product_id
          || '&v=' || pg_catalog.floor(extract(epoch from image_revision))::bigint
          || '&rev=' || pg_catalog.round(extract(epoch from image_revision)*1000000)::bigint;
        p := pg_catalog.jsonb_set(p,'{image}',pg_catalog.to_jsonb(image_url),true);
      end if;
    end if;
    compact_products := compact_products || pg_catalog.jsonb_build_array(p);
  end loop;
  new.data := pg_catalog.jsonb_set(new.data,'{customerCatalog}',compact_products);
  return new;
end;
$$;
revoke all on function public.compact_main_catalog_images_before_write() from public,anon,authenticated;
create trigger zz_compact_main_catalog_images_before_write
before update of data on public.app_state
for each row when (new.id='main')
execute function public.compact_main_catalog_images_before_write();
-- Atomic cutover flag: the newly deployed client uses RETURNING data only
-- after this flag turns true. Do not activate during business hours.
update public.app_state
set catalog_image_compaction_enabled=true
where id='main' and catalog_image_compaction_enabled is false;
-- The flag update is itself transactional. Never report success if it
-- updated no rows, because the client would remain in the wrong mode.
do $confirm$ begin
  if (select catalog_image_compaction_enabled from public.app_state where id='main')
     is distinct from true then
    raise exception 'Compaction flag not activated; rolling back'
      using errcode='23514';
  end if;
end $confirm$;
commit;
-- Rollback SQL (ONLY if no new images were created since activation):
-- drop trigger if exists zz_compact_main_catalog_images_before_write on public.app_state;
-- drop function if exists public.compact_main_catalog_images_before_write();
-- Never restore an old main state without reconciling orders and catalog edits.
