# Golosinas: plan de integración de stock con pedidos web

Estado: propuesta en PR #59; no aplicar en producción hasta pasar pruebas.

## Implementado en rama
- Tabla independiente de existencias y movimientos.
- Ingreso de mercadería y venta directa por unidad.
- Escritura atómica con bloqueo por producto y operación idempotente.
- Autorización para personal registrado en perfiles; validación de categoría Golosinas.

## Pendiente: reservas online (bloqueante para publicación)
El formulario público actualmente inserta directamente en public.web_requests y después abre WhatsApp.
No restar existencias desde el cliente. Crear una función transaccional de servidor que:
1. Reciba una clave de solicitud única y los ítems validados contra el catálogo, nunca confíe en precios ni categorías del cliente.
2. Bloquee las filas de stock en orden estable de product_id para evitar interbloqueos.
3. Compruebe disponibilidad y reserve únicamente las golosinas, sin tocar inventario de Polifan.
4. Inserte la solicitud web y las reservas en la misma transacción; si falla, no cambie nada.
5. Devuelva la solicitud ya existente si la clave se reintenta, sin duplicar reservas.
6. Al cancelar, libere una sola vez; al confirmar, convierta reserva en venta una sola vez.
7. Valide quién puede cancelar/confirmar, sin exponer operaciones administrativas a visitantes anónimos.
8. Publique disponibilidad en una vista segura, sin exponer datos de clientes ni movimientos internos.

## Migración de existencias
- Nunca asumir que la ausencia de registro equivale a stock 0 para bloquear ventas online: primero cargar y verificar cantidades reales.
- Activar control online solamente tras completar el conteo inicial y confirmar productos.
- No sobrescribir fotos, precios, pedidos ni historial existente.

## Pruebas obligatorias
- Venta directa 1 unidad; ingreso 1 unidad; stock insuficiente.
- Doble clic / reintento con mismo ID, y ID repetido con distinto producto.
- Dos compradores simultáneos disputan última unidad: solo uno obtiene reserva.
- Fallo al insertar web_requests: rollback de reserva.
- Cancelación repetida, confirmación repetida, pedido mixto Polifan+Golosinas.
- Producto nuevo, eliminado o cambiado de categoría.
- Verificar permisos de anon, authenticated y perfiles.
- Medir tiempo de respuesta y consultas para no agravar carga en Supabase.
