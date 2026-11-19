# Migración de imágenes del catálogo — puerta de publicación

**Estado: NO ACTIVAR EN PRODUCCIÓN.** Esta rama contiene una propuesta de
trigger que modifica únicamente las imágenes incrustadas de
`app_state.main.customerCatalog` y las sustituye por enlaces a la Edge
Function existente `catalog-image`. **No se elimina ningún producto ni se
vacía el catálogo.**

## Dependencias verificadas en base real (19/11/2026)

- 161 productos y 161 imágenes válidas.
- 29 productos tienen imagen base64 incrustada en `app_state`; los otros 132
  recuperarán su URL desde `catalog_product_images`.
- `public_catalog`, `public_catalog_items`, `app_state` y la copia
  `catalog_product_metadata_v3` concuerdan en los 161 productos.
- `public_catalog_items` contiene ~16 MB de imágenes, copiados desde
  `app_state`. El trigger **existente** `trg_sync_public_catalog_items`
  actualiza esa tabla cuando cambia `customerCatalog`; su contenido
  también deberá verificarse después de la migración.
- La simulación read-only produce 4.737.858 bytes de estado, frente a
  21.860.198 bytes actuales: **78,33 % de reducción teórica del JSON**.
  No equivale al ahorro medido de Disk I/O.

## Pruebas realizadas

- Ejecución del SQL del trigger sobre tablas `pg_temp` en una transacción
  terminada con `ROLLBACK` — no afecta tablas reales.
- Conservación de pedidos, conversión de imagen base64 a URL, actualización
  de una foto, relleno de URL si la foto ya está separada, inserción de
  nueva imagen y rechazo de formatos inválidos.
- `scripts/generate-image-trigger-sandbox.mjs` permite reproducir pruebas.
- `npm run build` ejecuta las comprobaciones de sintaxis y contrato del
  borrador; GitHub Actions las pasó. Las pruebas estáticas NO reemplazan
  una prueba integral en entorno de desarrollo.
- `scripts/preflight-catalog-image-externalization.sql` revisa las cuatro
  copias relevantes; cualquier discrepancia bloquea el cambio.

## Bloqueos para pasar de borrador a producción

1. **Respaldo externo completo y verificable**, con fecha/hora, del estado
   principal y de las tablas de imágenes y catálogo público, con
   restauración ensayada. Los seis respaldos históricos no sustituyen
   uno actual.
2. Comprobación de la Edge Function `catalog-image` con una foto real,
   permisos CORS, caché, ETag y URL con `v` y `rev`; verificar imágenes
   actualizadas repetidamente en menos de un segundo.
3. Prueba de las tres computadoras/navegadores con sincronización y
   versiones anteriores: precios, carga/edición/baja de producto,
   stock, pedidos, PDF, catálogo público y recarga del navegador.
   **Controlar clientes antiguos**: ningún cliente que guarde sin comparar
   la revisión de `app_state` debe poder reintroducir una foto antigua.
4. Ensayo de la migración SQL, incluida `trg_sync_public_catalog_items`,
   en una base de desarrollo con esquema y disparadores equivalentes.
5. Mantenimiento programado o ventana de escasa actividad, con corte
   controlado y capacidad de volver a una versión anterior sin perder
   productos, pedidos ni nuevas fotos. La reversión requiere conciliar
   los cambios posteriores; no basta con desactivar el trigger.
6. Solo entonces ejecutar preflight de nuevo, verificar la revisión del
   estado justo antes de actualizar y activar el trigger bajo transacción.
   Confirmar que `app_state` conserva pedidos/SVG y 161 productos,
   `public_catalog_items` sigue teniendo 161 productos y que las 161
   URLs de imagen responden.
7. Medir Disk I/O, RAM y WAL tras el cambio; si hay discrepancias,
   detener el despliegue, preservar datos y aplicar plan de reversión.

**No borrar datos ni respaldos para obtener espacio inmediato.**

## Prevención de fotos antiguas y estado confirmado (19/11, segunda revisión)

Se detectó que el guardado `saveData()` antes de esta rama aceptaba solamente
`updated_at` de una escritura exitosa y guardaba en memoria `merged`, aunque
el trigger propuesto puede sustituir imágenes base64 por URLs en `new.data`.
Eso habría dejado el navegador creyendo que sus datos antiguos eran idénticos
al estado del servidor.

La rama ahora llama `.select('updated_at,data')` **solo si el documento
enviado contiene imágenes base64 o productos sin imagen**. PostgreSQL devuelve
el documento ya modificado por el trigger, dentro del mismo UPDATE, sin una
segunda consulta que permita otra escritura entre medias. Este documento se
usa como el único estado confirmado para `serverDataRef`, React y caché local.
En guardados posteriores, cuando todas las imágenes son URL, usa la lectura
ligera `.select('updated_at')`.

Si se confirma que el UPDATE se ejecutó pero no se recibe `data` para el
caso que requiere canonicalización, el cliente muestra un aviso y pide
recargar. No acepta el JSON viejo como si fuera el estado final. Es una
condición excepcional que requiere comprobación manual y no se marca como
`ok:true`.

Se incorporó el ensayo `scripts/test-save-catalog-canonicalization.mjs`
que ejecuta el código real de `saveData` con un backend simulado:
compactación, fotos que ya estaban guardadas por separado, nueva foto,
guardados consecutivos y respuesta incompleta. El generador de SQL
`scripts/generate-image-trigger-sandbox.mjs` ahora incluye un escenario
en que una PC guarda una foto nueva y otra intenta sobrescribirla con una
revisión vieja; el guardado obsoleto debe afectar 0 filas.

Estas pruebas **no autorizan aún** la migración en producción. El código
anterior de navegadores abiertos sigue necesitando control de versiones
antes del cambio.

## Control de versiones obligatorio y usuarios trabajando durante la preparación

- **La rama no se puede fusionar ni desplegar sola**: la nueva aplicación manda
  `catalog_write_nonce` en cada UPDATE. Primero debe ejecutarse
  `scripts/catalog-write-nonce-preparation-DRAFT.sql`, que agrega una columna
  UUID opcional (sin alterar el JSON). Este paso todavía NO está realizado.
- Recién después de verificar esa columna puede desplegarse la nueva app;
  todas las computadoras deberán cargar la versión compatible antes del corte.
- Una vez validada la app nueva, el trigger de compactación comprueba que
  `NEW.catalog_write_nonce` sea diferente de `OLD.catalog_write_nonce`:
  rechaza guardados de pestañas antiguas sin pisar datos. Se comunica al
  usuario que debe recargar la aplicación.
- El SQL de activación NO agrega esa columna de forma oportunista: exige
  encontrarla y falla si falta, para impedir una publicación desordenada.
- El sandbox ahora ensaya tanto guardados antiguos rechazados como cambios
  de imagen que se conservan, catálogo público sincronizado y ROLLBACK.
- `preflight_ok` comprueba datos, mientras
  `database_prerequisites_ready` sigue siendo **false** hasta instalar la
  columna; aun entonces el despliegue compatible debe verificarse manualmente.

**Las cifras del catálogo son dinámicas.** Durante las pruebas el catálogo
pasó de 161 a 164 productos porque el negocio siguió trabajando. La revisión
detectó diferencias de la tabla auxiliar; se añadieron 3 filas de metadatos
faltantes sin actualizar, borrar ni restaurar ninguna fila original. La
verificación volvió a coincidir en 164 productos y 164 imágenes, con diferencias
cero. Cualquier cambio posterior exige otra auditoría. Nunca forzar el catálogo
real a coincidir con una copia más antigua.

## Estado del despliegue por etapas — 19/11/2026, ~19:48 ART

- **Hecho en producción:** agregado de las columnas
  `app_state.catalog_write_nonce uuid NULL` y
  `app_state.catalog_image_compaction_enabled boolean NOT NULL DEFAULT false`
  bajo `lock_timeout=300ms`, sin reescribir el documento ni activar trigger.
- **Verificado:** bandera de compactación `false`, nonce principal `NULL`,
  trigger `zz_compact_main_catalog_images_before_write` **ausente** y
  168 imágenes / 168 productos presentes al último control.
- **Hecho en GitHub:** la nueva versión de cliente se separó en el
  [PR #73](https://github.com/marcelomolina1982/polifan-online/pull/73),
  pasó la compilación y tests, y se integró en `main` (commit
  `ff5ac44e81d9d31181657355727ee88d0fa7b62d`).
- **BLOQUEO de publicación:** Vercel respondió HTTP 402 con código
  `api-deployments-free-per-day`, indicando volver a intentar después
  de 24 horas. La CLI de Vercel no está instalada en el entorno disponible.
  NO se cambió el plan ni se generó ningún costo.
- **Última producción comprobada:** deployment
  `dpl_FowsLugwzgZeuA79booxB8USVMVc`, commit
  `d33c9bbaf178c350bf85225085aeebe9159dbc46`, **anterior** a PR #73.
- **No autorizado para activación:** NO ejecutar el trigger del PR #72
  hasta que Vercel haya desplegado PR #73, todas las computadoras funcionen,
  exista un respaldo restaurable comprobado y pase el preflight actualizado.
- **La copia auxiliar puede quedar atrás** porque los usuarios siguen
  agregando productos. Compararla y sincronizar los faltantes justo antes
  del corte. Nunca forzar el catálogo principal a una copia desactualizada.
- **Importante:** mientras la bandera siga en `false`, el cliente preparado
  (una vez publicado) no descargará un documento completo adicional por
  cada guardado. Al activar el trigger, la bandera se habilitará en la misma
  transacción para pedir el estado canónico solo cuando sea necesario.
