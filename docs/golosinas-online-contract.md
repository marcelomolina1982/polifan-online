# Contrato de reserva online para Golosinas

Este documento describe el contrato pendiente de implementación. **No habilitar en producción hasta completar la función transaccional y sus pruebas.**

## Entrada de la función
- request_key: UUID generado una sola vez por intento de compra; persistido mientras se reintenta.
- code: código visible de solicitud, único.
- customer: datos de cliente validados y limitados en tamaño.
- items: lista de {productId, qty} con enteros positivos. Los nombres, categorías y precios se obtienen del catálogo del servidor.
- datos de despacho y observaciones: validados y limitados en tamaño.

## Operación atómica
1. Comprobar si request_key ya fue procesada y devolver el mismo pedido.
2. Validar todos los artículos contra el catálogo publicado; impedir IDs duplicados o agruparlos.
3. Identificar Golosinas exclusivamente según la categoría del catálogo del servidor.
4. Bloquear filas de candy_stock por product_id en orden estable.
5. Rechazar cualquier golosina sin stock inicial o con unidades insuficientes.
6. Crear web_requests y candy_reservations en la misma transacción.
7. Descontar existencias disponibles y registrar movimientos online_reserve.
8. Confirmar la transacción completa o revertirla íntegramente ante un error.

## Estados
- reserved: se descontó disponibilidad al recibir la solicitud, sin marcarla como venta final.
- completed: pago/pedido confirmado, no descontar otra vez.
- released: cancelado, devolver unidades exactamente una vez.

## Seguridad
La operación pública solo puede crear solicitudes y reservas; nunca reponer, cancelar o confirmar. Las acciones administrativas exigen identidad autorizada. Implementar protección contra abuso y validar cantidades y datos antes de publicar el endpoint.

## Integración
El formulario público debe usar la nueva función solamente cuando haya golosinas en el carrito. Los pedidos sin golosinas conservan el flujo actual. No abrir WhatsApp hasta recibir confirmación del servidor. Conservar la misma request_key si falla la red y el usuario reintenta.

## Pruebas de aceptación
Dos solicitudes simultáneas por la última unidad -> solo una reserva. Doble envío con la misma request_key -> un solo pedido. Fallo de inserción -> stock sin cambios. Cancelación repetida -> una sola devolución. Pedido mixto -> stock de polifan sin cambios. Intento anónimo de reponer -> denegado.
