# Bridge real de guardados AppV2 — 20 de noviembre de 2026

## Diagnóstico confirmado

La entrada de producción `src/main.jsx` monta `AppV2`, **no**
`App.jsx`. La actualización publicada mediante PR #73 solo añadió
`catalog_write_nonce` en `App.jsx`, una ruta que no sirve las pantallas
operativas actuales. Esto explica que el guardado verificado a las
13:35:36 ART del 20/11/2026 incrementara `app_state.main.updated_at`,
pero `catalog_write_nonce` continuara NULL.

En producción `AppV2.saveData` llama a
`src/lib/v2Data.js:patchV2Sections`, que ejecuta el RPC
`public.patch_v2_sections_cas` de Supabase. Ese RPC actualmente escribe
la fila completa de `app_state.main` y no conoce el nonce. **Activar el
trigger de PR #74 sin modificar este camino rompería todos los guardados
de AppV2.** PR #74 no puede publicarse hasta resolver esta dependencia.

## Implementación en esta rama, desactivada

- `scripts/v2-catalog-write-bridge-DRAFT.sql`: crea
  `public.patch_v2_sections_cas_compat`, una envoltura segura para el
  RPC existente que conserva el control optimista, la validación y los
  registros durables originales. Pasa un UUID único como configuración
  **local de transacción** y, después del guardado, devuelve la revisión
  confirmada y el catálogo normalizado solo si la compactación está activa.
- Trigger de compatibilidad `aa_capture_v2_catalog_write_nonce`: guarda
  el UUID del nuevo RPC junto con la actualización principal, respeta
  escrituras directas de clientes actualizados y limpia un nonce antiguo
  cuando un navegador viejo vuelve a guardar. Su nombre ejecuta antes del
  futuro trigger `zz_compact_main_catalog_images_before_write`.
- `src/lib/v2Data.js`: utiliza el RPC compatible con un UUID nuevo por
  guardado, sin cambiar su lógica de control de revisiones.
- `src/AppV2.jsx`: reemplaza en estado/caché de React el catálogo enviado
  por el **catálogo canónico devuelto por el servidor** si fue compactado.
- `scripts/test-v2-catalog-write-bridge.mjs`: prueba el código real de
  V2 con RPC simulado y protecciones estáticas de SQL.

## Pruebas

Una transacción SQL sobre tablas `pg_temp` verificó que el nuevo RPC
registra el UUID, que un guardado viejo posterior limpia el nonce, que un
nuevo guardado restaura el UUID correcto y que el catálogo se devuelve
cuando la bandera está activa. Todas las pruebas terminaron con ROLLBACK.

## Orden obligatorio (NO ejecutar todavía)

1. Proteger un respaldo actual y **verificar su restauración en un
   entorno no productivo**, sin borrar ni sustituir la base activa.
2. Ejecutar y comprobar SOLO el SQL del bridge. No activar compactación.
3. Publicar la aplicación V2 de esta rama únicamente después de (2),
   verificando `patch_v2_sections_cas_compat` y que funciona el guardado
   de pedidos, imágenes, movimientos y catálogo.
4. Comprobar que el último `app_state.main.catalog_write_nonce` ya no
   es NULL tras un cambio comercial legítimo, sin fabricar un guardado.
5. Verificar que todas las computadoras tienen el cliente actualizado;
   un navegador antiguo puede seguir trabajando antes del corte,
   pero después del corte se rechazará hasta recargar.
6. Volver a ejecutar preflight y actualizar la copia auxiliar.
7. Verificar también que el trigger de compactación de PR #74 maneja
   correctamente los productos sin imagen incrustada, incluso cuando
   AppV2 actualiza `customerCatalog` desde una vista resumida.
8. Activar la compactación en una ventana controlada, mediante transacción,
   con respaldo y reversión listos. Revisar imágenes y PDF.
9. Medir consumo real de Disk I/O y RAM, no solo tamaños JSON.

**No publicar solo esta rama sin instalar antes el RPC puente. No activar
PR #74 en producción durante una jornada normal de trabajo.**
