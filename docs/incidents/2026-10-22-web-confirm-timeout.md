# Diagnóstico: confirmación de solicitudes web (2026-10-22)

## Incidente confirmado
La llamada POST /rest/v1/rpc/confirm_web_request_atomic devuelve HTTP 500 y PostgreSQL 57014: "canceling statement due to statement timeout". Registros observados alrededor de 16:59–17:00 UTC del 22/10/2026. La base está ACTIVE_HEALTHY.

Solicitud afectada indicada por el usuario: WEB-20261022164616-4HSB (24 piezas). **No asumir que no se creó un pedido** hasta comprobar el estado de web_requests y app_state.

## Hallazgo en la función actual
La función `public.confirm_web_request_atomic`:
1. bloquea `web_requests` con `FOR UPDATE`;
2. bloquea `app_state/main` con `FOR UPDATE`;
3. agrega y recorre los registros `order_%` para calcular el número;
4. reconstruye el arreglo `orders` dentro de `app_state/main`;
5. actualiza el documento JSON grande de `app_state/main`, inserta el registro durable del pedido, actualiza revisiones y confirma la solicitud.

El documento principal pesa aproximadamente 11 MB. Este trabajo dentro de una transacción con bloqueos puede exceder el tiempo permitido. Es una hipótesis técnica, no una prueba aislada de cuál sentencia exacta consume el tiempo.

## Propuesta para probar, NO desplegada
- Preparar una variante de la función que reduzca trabajo sobre el documento principal, conservando **atomicidad**, control de duplicados y numeración única.
- No usar secuencias o cálculos de número sin revisar compatibilidad con numeración histórica.
- Verificar que `optimizedMainRead` y `mergeCriticalState` reconstruyan el pedido desde `order_*` antes de considerar omitir escrituras a `main`.
- Verificar la persistencia del cliente y las revisiones de sección.
- Probar concurrencia: dos confirmaciones simultáneas, reintento del mismo código, error intermedio, restauración y lectura desde otra sesión.
- Tomar respaldo comprobable antes de cualquier migración; comprobar rollback.
- Revisar EXPLAIN/tiempos con datos no productivos. Nunca probar confirmaciones mutantes en producción.
- Desplegar solo tras pruebas y aprobación explícita. No modificar inventario, movimientos, cortes ni pedidos existentes.

## Operación inmediata
No reintentar repetidamente la confirmación afectada ni borrar la solicitud. Verificar estado de solicitud y presencia del pedido antes de reintentar.
