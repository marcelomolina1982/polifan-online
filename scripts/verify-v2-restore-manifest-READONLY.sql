-- READ ONLY. Integrity manifest for comparison with an independently
-- restored database or a consistent logical pg_dump snapshot.
-- No business rows, image bytes, names, addresses or secrets are returned.
-- The MD5 digests detect accidental differences; they are NOT security signatures.
-- DO NOT confuse a passing manifest on production with a successful restore.
with main as(
  select data,updated_at
  from public.app_state where id='main'
),
catalog as (
  select p->>'id' id,p product
  from main m cross join lateral jsonb_array_elements(m.data->'customerCatalog') p
),
images as (
  select count(*) image_count,
         md5(coalesce(string_agg(product_id || ':' || md5(image),
                                ',' order by product_id),'')) images_digest
  from public.catalog_product_images
),
durable as (
  select count(*) filter(where id like 'movement_%') durable_movements,
         count(*) filter(where id like 'order_%') durable_orders,
         count(*) filter(where id like 'batch_%') durable_batches
  from public.app_state
),
coverage as (
  select count(*) filter(where m.id is null or
                         m.data->'item' is distinct from c.product) catalog_coverage_failures
  from catalog c left join public.catalog_product_metadata_v3 m on m.id=c.id
),
counts as (
  select
    (select count(*) from catalog) products,
    (select count(*) from public.public_catalog_items) published_products,
    (select count(*) from public.catalog_product_metadata_v3) metadata_products,
    (select jsonb_array_length(data->'movements') from main) movements,
    (select jsonb_array_length(data->'orders') from main) orders,
    (select jsonb_array_length(data->'cutBatches') from main) batches,
    (select md5(data::text) from main) canonical_state_digest,
    (select pg_column_size(data) from main) canonical_state_bytes,
    (select updated_at from main) canonical_state_revision,
    (select md5(pg_get_functiondef(
      'public.patch_v2_sections_cas(jsonb,jsonb,uuid)'::regprocedure))
    ) v2_rpc_digest
)
select current_timestamp as manifest_generated_at,
  c.*, i.image_count,i.images_digest,
  d.durable_movements,d.durable_orders,d.durable_batches,
  v.catalog_coverage_failures,
  c.products=i.image_count and c.products=c.published_products
    and c.products=c.metadata_products
    and v.catalog_coverage_failures=0 as catalog_consistency_passed
from counts c cross join images i cross join durable d cross join coverage v;
