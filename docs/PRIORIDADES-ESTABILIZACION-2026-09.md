# Prioridades de estabilización · septiembre 2026

Objetivo: mejorar Polifan y el catálogo sin poner en riesgo pedidos, inventario ni piezas para cortar.

## P0 · Integridad de datos

1. Ninguna pantalla puede modificar inventario, pedidos o cortes sólo por abrirse/montarse.
2. Las operaciones críticas esperan confirmación de Supabase antes de mostrar éxito.
3. Corte terminado + movimientos de inventario debe evolucionar a una operación atómica e idempotente.
4. Toda automatización crítica debe poder auditarse por `orderId`, `batchId` o identificador de ajuste.

## P1 · Seguimiento punta a punta

Estados públicos únicos:

1. Pedido agendado.
2. En producción / corte.
3. Para embalar.
4. Despachado / Listo para retirar.

Reglas:

- Stock terminado puede cubrir un pedido sin inventar una etapa de producción.
- Un pedido que requiere producción sólo entra en producción cuando la cobertura proyectada completa de ese pedido está enviada a corte.
- Una placa parcial o una placa de otro pedido no puede adelantar el seguimiento.
- Para embalar aparece 3 horas después de que termine completamente el corte requerido.
- El estado final es manual.
- Compatibilidad temporal con estados históricos sin migración masiva.

## P2 · Motor Sparrow

1. Mantener certificación geométrica como condición obligatoria.
2. Elegir soluciones por figuras completas primero; densidad y ancho sólo desempatan.
3. Benchmark del cambio aislado.
4. Después probar frontera adaptativa y rescate multi-seed sólo para conseguir una figura completa adicional.
5. No bajar separaciones de seguridad para mejorar artificialmente el resultado.

## P3 · Corte e inventario

- Retirar escrituras automáticas de `useEffect`/montaje.
- Confirmación explícita de corte terminado.
- Evitar doble alta mediante idempotencia por placa.
- Auditoría de stock calculado vs. almacenado sin autocorrección.

## P4 · App y catálogo como un solo flujo

Catálogo -> Solicitud web -> Confirmación -> Pedido -> Stock/Producción -> Embalaje -> Despacho -> Seguimiento.

Centralizar en Polifan precios, promociones, fecha de despacho, zonas/logística y reglas de embalaje para evitar lógica comercial duplicada en el frontend público.

## P5 · Rediseño

Sólo después de P0-P3 probados. Mantener la lógica estable y modernizar navegación/dashboard sobre ella. Producción agrupará Para cortar, Generar placas, En corte, Calendario y SVG. Añadir búsqueda global y salud del sistema sin escrituras críticas optimistas.

## Criterio de salida a producción

No se considera una corrección terminada por compilar o desplegar. Debe superar pruebas controladas y verificarse el comportamiento real de producción cuando corresponda.
