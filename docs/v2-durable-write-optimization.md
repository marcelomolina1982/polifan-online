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

## Pruebas de escala y simulación del JSON — 20/11/2026

- Se ejecutó el **SQL set-based exacto** (reescrito a tablas `pg_temp`)
  sobre 3.326 movimientos ficticios, sin importar datos reales. Un cambio
  produjo exactamente 1 UPDATE durable, un guardado igual produjo 0,
  y eliminar una figura produjo exactamente 1 tombstone. Confirmadas
  integridad de cantidades y conteos. La transacción terminó con
  `ROLLBACK`, sin alterar Inventario comercial.
- `scripts/generate-v2-inventory-scale-sandbox.mjs` reproduce esta
  prueba y está incluido en las comprobaciones de `npm run build`.
  No crea datos comerciales ni altera la base activa.
- Prueba adicional de solo lectura del documento actual (168 productos):
  `pg_column_size(app_state.main.data)=26.916.370` bytes. Sustituir en
  memoria todas las imágenes incrustadas por referencias a la tabla
  `catalog_product_images` daría aproximadamente `4.743.694` bytes,
  una reducción simulada del **82,38 %**. No se aplicó ni modificó
  ningún producto.
- Esto **NO equivale** a reducir 82,38 % el Disk I/O. El consumo de
  disco depende también de WAL, lecturas, índices y autovacuum. Quedan
  separados dos frentes: **PR #78** evita registros durables
  reescritos y **PR #74** prepara compactación del JSON, actualmente
  bloqueada por incompatibilidad de versiones tras el incidente del
  puente V2.
- Estado del código productivo: PR #77 restauró `main` a la ruta
  estable `patch_v2_sections_cas`. Vercel apunta al despliegue
  `dpl_47CGtgcTCMg9CQFdMneZu7SzStBt`. La función bridge instalada
  anteriormente **no se invoca** por ese cliente. No activarla.


## Regresión adicional: IDs con espacios

En SQL el RPC histórico recorta espacios al construir la clave durable,
pero la validación inicial de duplicados compara los IDs sin recortar.
Por ejemplo, `m1` y ` m1 ` pueden aparecer en el mismo lote: el RPC
anterior los procesa en orden y conserva el **último**.

La primera versión set-based fallaba en ese caso (PostgreSQL `21000`:
varios registros de un mismo INSERT intentaban modificar la misma clave).
Se reprodujo el problema usando únicamente `pg_temp`, se corrigió
con `DISTINCT ON` y `WITH ORDINALITY` (última aparición por clave
normalizada), y se volvió a comparar la salida real de ambas funciones.

También se verificó que IDs duplicados del arreglo anterior, cuando
ambos se borran, produzcan un único tombstone **equivalente al original**.
La prueba reproducible es
`scripts/generate-v2-normalized-ids-sandbox.mjs`; forma parte del CI.

Una auditoría de solo lectura del estado real comprobó:
- Movimientos: 3.326 registros, 0 IDs vacíos, 0 colisiones normalizadas.
- Pedidos: 308 registros, 0 IDs vacíos, 0 colisiones normalizadas.
- Lotes: 309 registros, 0 IDs vacíos, 0 colisiones normalizadas.

La corrección no se desplegó: es una salvaguarda para casos futuros.

## Plan de validación de respaldos sin modificar producción

Se agregó `scripts/verify-v2-restore-manifest-READONLY.sql` para
obtener un **manifiesto sin datos personales**: número de productos,
pedidos, movimientos, lotes e imágenes; huellas del documento principal,
de las imágenes y del RPC; y consistencia de las copias del catálogo.
La consulta se ejecutó en producción exclusivamente en modo lectura:
168 productos/imágenes, 308 pedidos, 3.326 movimientos, 309 lotes,
0 diferencias de metadatos y `catalog_consistency_passed=true`.

**No equivale a haber restaurado un respaldo.** Comparar huellas
exactas requiere la misma instantánea de base: los respaldos físicos
diarios pueden ser anteriores a movimientos comerciales nuevos.
Si se recupera una copia independiente, ejecutar el manifiesto sobre
esa copia y comparar con una referencia del mismo instante.

Documentación oficial Supabase:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/platform/clone-project

Los respaldos físicos diarios no se descargan directamente como archivos.
Crear un clon independiente puede generar **costos adicionales** y
requiere autorización antes de hacerlo. Una alternativa es un respaldo
lógico manual con Supabase CLI / pg_dump y restaurarlo en PostgreSQL
local, separado de la base activa. Puede requerir acceso a la conexión
de base de datos y Docker/PostgreSQL local; **no compartir contraseñas
ni cadenas de conexión privadas por chat o repositorio**. Los backups
de base NO incluyen objetos del servicio Storage; deben verificarse
por separado.

No ejecutar `Restore` sobre la base comercial para probar recuperación.

## Validación 24/11/2026 — CI independiente y concurrencia

**Estado productivo confirmado:** Supabase `ACTIVE_HEALTHY`,
Vercel sigue apuntando a `dpl_47CGtgcTCMg9CQFdMneZu7SzStBt`;
3342 movimientos, 311 pedidos, 312 lotes, 168 productos y 168
imágenes. La compactación está apagada. PR #78 sigue en borrador.

**Nueva automatización:** `.github/workflows/v2-sql-sandbox.yml`.
En cada cambio pertinente de la PR, GitHub levanta PostgreSQL 17
efímero y ejecuta el **SQL generado a partir del borrador real**:
`generate-v2-durable-sandbox.mjs`,
`generate-v2-set-based-sandbox.mjs`,
`generate-v2-inventory-scale-sandbox.mjs` y
`generate-v2-normalized-ids-sandbox.mjs`. Los cuatro terminaron con
`ROLLBACK`. Se verifica que el esquema productivo no fue creado allí.

**Prueba de guardados simultáneos:** una quinta prueba genera el
borrador set-based para un esquema independiente llamado
`sandbox_concurrency`, con un guardia que impide ejecutarlo fuera
de una base denominada `sandbox`. Dos sesiones PostgreSQL guardan
desde la misma revisión: el primer movimiento persiste y el segundo
recibe correctamente `Conflicto de sincronización`. GitHub Actions
aprobó el ensayo el 24/11. No se utilizaron credenciales ni datos
reales de Supabase.

**Estadísticas observadas en Supabase** (acumuladas desde el reinicio de
estadísticas, NO tasas de hoy): la firma RPC V2 monitorizada presentó
22 ejecuciones, 9,3 segundos de promedio, 16,3 segundos de máximo y
840 MB de WAL. No atribuir el valor total exclusivamente a movimientos
ni asegurar un ahorro de WAL sin medición posterior.

Se preparó `docs/backup-polifan-offsite-windows.md` con el
procedimiento para respaldo lógico en una PC propia, usando Supabase
CLI/Docker y sin contratar un clon Supabase. **No se ejecutó todavía
una restauración real**, por lo que no habilitar el SQL definitivo ni
la compactación PR #74.
