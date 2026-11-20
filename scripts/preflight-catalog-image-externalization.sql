-- READ ONLY PREFLIGHT. Never alters production tables.
-- Any "false" / nonzero difference blocks the migration.
with main_state as (
  select data,updated_at,catalog_write_nonce,catalog_image_compaction_enabled from public.app_state where id='main'
),original as (
  select p->>'id' id,p-'image'-'imageData'-'photo' metadata,p->>'image' legacy_image
  from main_state m cross join lateral jsonb_array_elements(m.data->'customerCatalog') p
),published as (
  select p->>'id' id,p-'image'-'imageData'-'photo' metadata
  from public.public_catalog c cross join lateral jsonb_array_elements(c.data->'customerCatalog') p
),counts as (
  select
    (select count(*) from original) original_count,
    (select count(*) from public.catalog_product_images) image_count,
    (select count(*) from public.public_catalog_items) published_item_count,
    (select count(*) from public.catalog_product_metadata_v3) metadata_count,
    (select count(*) from published) public_count,
    (select count(*) from original o full join published p on o.id=p.id
       where o.id is null or p.id is null or o.metadata is distinct from p.metadata) public_differences,
    (select count(*) from original o full join public.catalog_product_metadata_v3 m on o.id=m.id
       where o.id is null or m.id is null or o.metadata is distinct from m.payload) staged_differences,
    (select count(*) from original o left join public.catalog_product_images i on i.product_id=o.id
       where i.product_id is null) missing_images,
    (select count(*) from original o full join public.public_catalog_items i on i.id=o.id
       where o.id is null or i.id is null
       or o.metadata-'svg'-'svgBase'-'svgTapa'-'svgContent'-'baseSvg'-'tapaSvg'-'pathData'-'vectorData'-'sourceSvg' is distinct from i.payload
       or coalesce(o.legacy_image,'') is distinct from coalesce(i.image,'')) published_item_differences,
    (select count(*) from original where id is null or length(id)>160
       or id !~ '^[A-Za-z0-9._~-]+$') invalid_ids,
    (select count(*) from public.catalog_product_images
       where image !~ '^data:image/(jpeg|png|webp|gif);base64,') incompatible_images,
    (select count(*) from information_schema.columns
       where table_schema='public' and table_name='app_state'
         and column_name='catalog_write_nonce' and udt_name='uuid') nonce_column_ready,
    (select count(*) from information_schema.columns
       where table_schema='public' and table_name='app_state'
         and column_name='catalog_image_compaction_enabled' and udt_name='bool') flag_column_ready,
    (select catalog_image_compaction_enabled from main_state) compaction_active,
    (select catalog_write_nonce is not null from main_state) latest_save_has_nonce,
    exists (select 1 from pg_trigger
      where tgrelid='public.app_state'::regclass
        and tgname='zz_compact_main_catalog_images_before_write') trigger_installed,
    (select pg_column_size(data) from main_state) main_bytes,
    (select updated_at from main_state) main_revision
)
select *,
  original_count>=100 and original_count=image_count and original_count=metadata_count
  and original_count=public_count and original_count=published_item_count
  and public_differences=0 and staged_differences=0 and published_item_differences=0
  and missing_images=0 and invalid_ids=0 and incompatible_images=0 as preflight_ok,
  nonce_column_ready=1 and flag_column_ready=1
  and compaction_active is false and trigger_installed is false
  and latest_save_has_nonce is true and original_count>=100
  and original_count=image_count and original_count=metadata_count
  and original_count=public_count and original_count=published_item_count
  and public_differences=0 and staged_differences=0 and published_item_differences=0
  and missing_images=0 and invalid_ids=0 and incompatible_images=0
    as database_prerequisites_ready
from counts;
