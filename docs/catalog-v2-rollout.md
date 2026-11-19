# Catálogo independiente v2 — plan de activación segura

ESTADO: SOLO PREPARACIÓN, NO ACTIVAR EN PRODUCCIÓN.

## Situación actual

- La fuente oficial es `app_state(id='main').data.customerCatalog`.
- `catalog_products_v2` contiene una copia, no es la fuente oficial.
- `public_catalog` es un documento separado usado por el catálogo de clientes.
- Los navegadores viejos pueden seguir guardando `app_state`.
- El módulo `src/lib/catalogProductV2.js` permite obtener filas y enviar altas,
  actualizaciones y bajas individuales a la RPC **cuando sea activada**.
- La RPC en `scripts/catalog-v2-optimistic-save-draft.sql` NO se instaló. Usa
  revisión por producto, `SECURITY INVOKER`, RLS y `clock_timestamp()`.

## Lo que falta antes del cambio de fuente

1. **Lectura:** cargar productos desde v2 en todas las pantallas que los usan,
   sin descargar el catálogo gigante de `app_state` en cada sincronización.
2. **Escritura:** implementar `CatalogAdmin` para utilizar el cliente v2,
   con revisión obtenida al editar; ante conflicto, conservar el formulario y
   solicitar recarga. Las altas/bajas y los cambios de categoría deben ser
   consistentes y recuperables.
3. **Publicación:** generar `public_catalog` desde los datos guardados, nunca
   desde una copia local desactualizada. Evitar catálogo público desincronizado.
4. **Compatibilidad:** impedir que clientes anteriores sobrescriban el catálogo.
   Ningún despliegue v2 puede iniciarse hasta que exista una transición atómica,
   una comprobación de versión o un puente seguro de sincronización.
5. **Seguridad:** verificar los permisos de la función y RLS. Probar rechazos de
   `anon`, modificaciones obsoletas y operaciones del usuario autorizado.
6. **Pruebas:** tests de datos reales sobre una instancia de desarrollo,
   compilación CI, simulación de varias computadoras y restauración desde respaldo.
7. **Copia y validación:** comparar cada `id` y cada `payload` de la fuente
   anterior y v2. Los conteos por sí solos no alcanzan. Confirmar las imágenes.

## Condiciones para detener o revertir

- Si la auditoría arroja diferencias, no activar escrituras v2.
- Si hay clientes antiguos conectados, no cambiar el origen de los productos.
- Si los datos v2 cambian tras la activación, **NO** volver a `app_state` sin
  reconciliar los cambios o se perderán productos recientes.
- Mantener los respaldos históricos; no borrar por optimizar Disk I/O.
- `public_catalog` y los datos operativos son parte de la verificación final.

## Comprobaciones actuales

`npm run test:catalog-v2` ejecuta las pruebas del cliente independiente y
sus validaciones estáticas. **No prueba que la función SQL se haya instalado**:
esto requiere una base de datos de desarrollo y pruebas RLS.

La consulta read-only `scripts/verify-independent-catalog.sql` compara
ambos catálogos y verifica vínculos con imágenes.

**Resultado esperado de la fase final:** modificar un producto toca solo la fila
correspondiente en `catalog_products_v2`; no reescribe los ~22 MB de
`app_state` ni publica un catálogo desactualizado.

## Hallazgo del Disk I/O: catálogo de metadatos v3 (19/11/2026)

La copia v2 arrastra 29 imágenes base64 integradas en el JSON de 161 productos:
17.175.865 bytes. La misma información sin `image`, `imageData` ni `photo`
ocupa solo ~31.741 bytes. Las 29 imágenes integradas se verificaron iguales
a las almacenadas por `catalog_product_images`; hay imagen para los 161
productos.

Se creó en producción la tabla **auxiliar, inerte y de solo lectura para clientes**
`public.catalog_product_metadata_v3`, con RLS, SELECT restringido a usuarios
autenticados y sin INSERT/UPDATE/DELETE para clientes. La aplicación no la utiliza.
La copia contiene 161 filas, 0 diferencias, 0 imágenes sin relación y 0 campos
de imagen incrustados. Tamaño físico de la nueva tabla: ~96 KB con índices.

Proyección de tamaño de `app_state.data` si se excluyera `customerCatalog`:
21.860.198 → 4.683.766 bytes (**78,57 % menor**). Es una simulación de
tamaño, **no** un ahorro de Disk I/O comprobado, y no se modificó `app_state`.

Archivos:
- `scripts/catalog-metadata-v3-staging.sql` describe la creación y copia,
  ya efectuada con control de seguridad.
- `scripts/verify-catalog-metadata-v3.sql`: auditoría solo lectura.
- `src/lib/catalogMetadataV3.js`: cliente de catálogo liviano;
  lee imágenes por separado y no las retransmite al guardar precios.
- `scripts/catalog-metadata-v3-atomic-write-DRAFT.sql`: RPC atómica con
  revisión optimista y escritura de imagen solo cuando cambió. **NO ejecutada**.
- Tests v3 dentro de `npm run test:catalog-v2`.

### Requisito obligatorio antes de recortar app_state

**No habilitar la RPC ni modificar la aplicación principal todavía.**
Primero migrar todos los lectores internos a la tabla v3 y al endpoint de imagen,
incluidos pedidos, stock, formularios, categorías y PDF de catálogo. La publicación
pública debe utilizar datos confirmados por el servidor, nunca un estado antiguo.

Luego probar con varios navegadores y una base de desarrollo. Preparar un control
de versiones en el backend que rechace guardados de clientes antiguos, obligando a
actualizar en lugar de permitir reinsertar el JSON gigante o perder cambios.
El trigger actual `guard_polifan_main_state` bloquea eliminar el catálogo de
`app_state` (mínimo 100 productos); adaptar esa protección **solamente** durante
el cambio coordinado y conservar el mínimo SVG de 180. Hacer backup comprobable,
verificar todas las imágenes, desplegar con plan de reversión y comparar métricas
`pg_stat_statements.wal_bytes`, Disk I/O y RAM después del cambio.

No eliminar las seis copias históricas, el catálogo v2 ni las imágenes hasta
completar la transición y comprobar la restauración. Eliminar el campo de
`app_state` antes de actualizar los clientes pondría en riesgo el negocio.
