# Laboratorio seguro: seguimiento E2E + optimización de placas

Fecha: 2026-09-09

Esta rama NO debe desplegarse a producción ni modificar pedidos, inventario, movimientos o lotes reales durante la fase de laboratorio.

## 1. Seguimiento punta a punta — criterio de aprobación

Casos obligatorios con fixtures/datos simulados:

1. Pedido cubierto 100% por stock terminado.
   - No consume ni escribe inventario durante la prueba.
   - No debe aparecer falsamente como corte activo.
   - Debe llegar al estado operativo correcto sin duplicar piezas.
2. Pedido que necesita producción.
   - `production_cut` sólo cuando la cobertura necesaria de producción está completa según lotes gestionados.
   - `packing` sólo después de corte terminado + ventana definida de 3 horas.
3. Final manual.
   - Logística/Vía Cargo -> `dispatched`.
   - Retiro -> `ready_pickup`.
   - Repetir la acción debe ser idempotente.
4. Compatibilidad.
   - Aceptar estados históricos en español y estados normalizados sin migración masiva.
5. Persistencia.
   - Guardar únicamente el pedido cuyo journey cambió.
   - Nunca auto-guardar toda la base al abrir Centro operativo.
   - Confirmar escritura antes de mostrar éxito.
6. Página pública.
   - El RPC/API debe reflejar el mismo estado que la lógica operativa.
   - Consultas `no-store`.

## 2. Motor de placas — criterio de optimización

Restricciones que NO se negocian:

- separación mínima certificada: 3 mm;
- placa física 1230 x 580 mm;
- área segura actual: 1218 x 568 mm por el offset del SVG final;
- BASE + TAPA forman una figura completa;
- ninguna solución con conflicto, pieza fuera de placa o figura incompleta puede ganar por densidad;
- prioridad de producción se conserva.

### Score del candidato

Comparar soluciones lexicográficamente:

1. mayor cantidad de figuras completas válidas;
2. mayor cumplimiento de prioridad/urgencia;
3. mayor ocupación geométrica certificada;
4. menor ancho/área residual utilizada.

### Estrategias a ensayar antes de tocar el motor activo

- baseline V5 actual;
- múltiples semillas Sparrow para diversidad;
- órdenes: prioridad pura, grandes primero, pequeñas primero, mezcla grande/chica;
- rotaciones permitidas por geometría;
- búsqueda local 1x2 sobre kits completos (nunca piezas BASE/TAPA independientes);
- segunda pasada de compresión/warm-start sólo si conserva certificación;
- cortar temprano estrategias claramente peores para no gastar cómputo inútil.

Cada resultado debe pasar el certificador geométrico antes de compararse como candidato final.

## 3. Política de despliegue

- Trabajo y pruebas primero en local/fixtures/GitHub.
- Render de laboratorio sólo cuando haya un candidato medible.
- Un único Preview Vercel cuando seguimiento + interfaz candidata estén listos.
- `main` sólo después de resultados comparativos y prueba controlada aprobada.
- Nunca mezclar en un mismo cambio una modificación de seguimiento con una modificación de inventario/corte.
