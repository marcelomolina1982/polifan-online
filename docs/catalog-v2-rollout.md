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
