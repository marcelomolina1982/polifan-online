-- Read-only verification before switching catalog reads/writes to catalog_products_v2.
-- A successful initial copy must have zero differences.
WITH original AS (
  SELECT product->>'id' AS id, product AS payload
  FROM public.app_state AS state
  CROSS JOIN LATERAL jsonb_array_elements(state.data->'customerCatalog') AS product
  WHERE state.id = 'main'
)
SELECT
  (SELECT count(*) FROM original) AS original_products,
  (SELECT count(*) FROM public.catalog_products_v2) AS independent_products,
  (SELECT count(*) FROM original AS o
   FULL JOIN public.catalog_products_v2 AS n ON n.id=o.id
   WHERE o.id IS NULL OR n.id IS NULL OR o.payload IS DISTINCT FROM n.payload) AS differences,
  (SELECT count(*) FROM original AS o
   LEFT JOIN public.catalog_product_images AS i ON i.product_id=o.id
   WHERE i.product_id IS NULL) AS missing_images;
