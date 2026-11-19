-- READ ONLY. Audit v3 metadata against the currently canonical app_state.
-- DO NOT USE this table as the write source until old clients are gated.
with original as (
  select product->>'id' as id,
         product-'image'-'imageData'-'photo' as payload,
         length(coalesce(product->>'image',''))>500 as embedded_image
  from public.app_state a
  cross join lateral jsonb_array_elements(a.data->'customerCatalog') product
  where a.id='main'
),
compare as (
  select o.id original_id,v.id v3_id,
         o.payload is distinct from v.payload as changed,
         o.embedded_image,
         (i.product_id is not null) as has_image
  from original o
  full join public.catalog_product_metadata_v3 v on o.id=v.id
  left join public.catalog_product_images i on i.product_id=coalesce(o.id,v.id)
)
select
  (select count(*) from original) original_products,
  (select count(*) from public.catalog_product_metadata_v3) v3_products,
  count(*) filter (where original_id is null or v3_id is null or changed) mismatches,
  count(*) filter (where not has_image) missing_images,
  count(*) filter (where embedded_image) legacy_embedded_image_products,
  (select count(*) from public.catalog_product_metadata_v3
    where payload ?| array['image','imageData','photo']) image_fields_in_v3,
  (select pg_total_relation_size('public.catalog_product_metadata_v3')) v3_table_bytes,
  (select sum(pg_column_size(payload)) from public.catalog_product_metadata_v3) v3_payload_bytes
from compare;
