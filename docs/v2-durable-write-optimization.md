# Optimización del guardado de Inventario (borrador, no desplegado)

## Estado confirmado — 20 de noviembre de 2026

La aplicación productiva volvió al despliegue estable
`dpl_47CGtgcTCMg9CQFdMneZu7SzStBt` después de que el puente V2 agotara
`statement_timeout`. El usuario comprobó después que el guardado de
Inventario volvió a funcionar. El código de GitHub `main` se alineó
con esa versión estable mediante **PR #77**, recuperando
`patch_v2_sections_cas` en el cliente.

**IMPORTANTE: el RPC de compatibilidad de PR #75 sigue instalado pero
el cliente actual NO lo llama. No activar compactación de catálogo.**

## Problema medido

La sección `movements` contiene unos 3.326 elementos y el JSON principal
ocupa ~26,9 MB. El RPC original `patch_v2_sections_cas` recorre cada
registro con un `INSERT ... ON CONFLICT DO UPDATE`, aunque el registro
individual no haya cambiado. Además, el borrado compara cada elemento
anterior con la lista nueva, repetidamente.

## Alternativas de SQL, NO ejecutadas en producción

- `scripts/patch-v2-durable-upsert-only-changed-DRAFT.sql`: primera
  mejora conservadora; solo agrega condiciones `WHERE ... IS DISTINCT
  FROM` para evitar UPDATE físico de registros idénticos, aunque todavía
  itera uno por uno.
- `scripts/patch-v2-set-based-durable-sync-DRAFT.sql`: propuesta
  preferida. Sincroniza registros en grupos, selecciona únicamente los
  que realmente cambiaron y conserva las bajas como tombstones. Sigue
  usando el CAS original y la validación de las tres colecciones.
- `scripts/fixtures/patch-v2-original-reference.sql`: copia del SQL
  anterior para comparación y posible reversión controlada; no contiene
  datos comerciales.

## Pruebas concretas con tablas temporales

- Con **180 movimientos ficticios**, el RPC original efectuó 180
  `UPDATE` individuales para un cambio; el borrador set-based efectuó
  **1**, conservando el dato.
- Con **250 movimientos ficticios**, el borrador actualizó solo el que
  cambió y generó correctamente una baja; conservó todos los demás.
- Con **pedidos y lotes de corte** ficticios, actualizó un pedido y
  conservó los demás; generó el tombstone de un lote.
- Se comprobó rechazo de una revisión CAS desactualizada sin modificar
  un pedido ya confirmado.
- Todas las consultas de prueba usaron `pg_temp` y finalizaron con
  `ROLLBACK`; **no se modificó ningún pedido, movimiento ni lote real**.
- `scripts/generate-v2-set-based-sandbox.mjs` reproduce la prueba
  comparativa; `npm run build` exige sus guardas estáticas.
  Estas pruebas no sustituyen ejecutar un benchmark íntegro en una
  base no productiva.

## Condiciones para una eventual publicación

1. Obtener un respaldo actual y **probar restauración en ambiente
   aislado**; no presionar Restore sobre producción.
2. Ejecutar la batería completa en un entorno de desarrollo con
   el mismo esquema y triggers, incluyendo 3.326 movimientos ficticios,
   pedidos, lotes, IDs duplicados, reintentos y conflicto CAS.
3. Preparar plan de reversión usando la función SQL original. En
   producción el reemplazo del RPC debe ser transaccional, con un
   `lock_timeout` corto, inspección antes/después y ventana controlada.
4. Primero medir bytes WAL y tiempos de guardado; después considerar
   la futura separación de las imágenes que todavía ocupan ~21 MB
   en `app_state`. Esta optimización **NO elimina la reescritura del
   JSON grande** y no debe presentarse como arreglo definitivo del
   Disk I/O.
5. No fusionar esta PR directamente en `main` ni aplicar SQL
   productivo sin cumplir las comprobaciones.

El objetivo es mejorar rendimiento sin recrear el error de timeout
ni modificar datos actuales.
