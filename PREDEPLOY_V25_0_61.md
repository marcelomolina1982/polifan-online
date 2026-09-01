# Predeploy v25.0.61

Estado: preparado fuera de `app-v2-parallel` para no consumir builds mientras Vercel está limitado.

## Antes de mover la rama
- Confirmar que Vercel dejó de responder con `build-rate-limit`.
- Mantener como rollback la producción READY anterior (`86ac7a78de19f9850934e2321814482176b3b5b4`).
- No tocar Sparrow ni sus parámetros de placa/separación.

## Protección de builds
`vercel.json` deja continuar automáticamente `app-v2-parallel` sólo en el proyecto `polifan-app-v2`. En `polifan-online` y `polifan-motor-lab` ese mismo branch queda ignorado para no triplicar builds. Sus otras ramas siguen habilitadas.

## Guards de compilación v25.0.61
- Para cortar y Motor deben usar `pendingCutPlan`.
- Motor no puede conservar `pendingCutByDelivery`.
- Vía Cargo debe apuntar a `/api/cotizar` y no al endpoint viejo `/quote`.
- CORS del servicio Via Cargo no puede volver a `*`.
- La logística debe bloquear zonas desconocidas en vez de adivinar precio.
- Las cotizaciones Via Cargo en vuelo se invalidan al cambiar CP/localidad/provincia/cantidad.

## Verificación después del único build
1. Confirmar versión visible `v25.0.61`.
2. Abrir Pedidos para cortar: atrasados activos visibles y priorizados.
3. Comparar resumen por figura: stock físico + en corte no se vuelve a pedir.
4. Abrir Motor y confirmar mismo pendiente que Para cortar antes de generar.
5. No modificar el algoritmo Sparrow; sólo verificar que recibe el plan unificado.
6. Probar Vía Cargo con CP 3700, Presidencia Roque Sáenz Peña, Chaco, 12 unidades; aceptar sólo coincidencia oficial exacta y precio positivo.
7. Cambiar CP/localidad durante una cotización y verificar que una respuesta vieja no reaparece.
8. Probar Logística GBA/CABA en una zona conocida y en una desconocida; la desconocida debe quedar sin tarifa automática.
9. Revisar pedidos, inventario, catálogo y solicitudes web antes de dar la versión por estable.

## Rollback
Si una comprobación crítica falla, no seguir haciendo commits de prueba. Volver a la producción READY anterior y corregir fuera de producción antes de un nuevo intento.
