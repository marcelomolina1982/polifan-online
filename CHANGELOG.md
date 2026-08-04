# Historial de cambios

## 13.0.0 — Limpieza del proyecto

- Se eliminaron archivos `LEEME_VERSION_*.txt` antiguos y documentación duplicada.
- Se eliminó un parche histórico que ya no era necesario para ejecutar la aplicación.
- Se consolidó la información en `README.md` y `CHANGELOG.md`.
- Se conservaron los scripts SQL, el código, los recursos y todas las funciones actuales.
- Se redujo la cantidad total de archivos para facilitar la carga desde GitHub.

## 12.0.1 — Flujo integrado

- Pedido interno y remito en la misma hoja A4.
- Capacidad diaria de 90 piezas, equivalente a 9 planchas de 10.
- Domingos excluidos de la producción.
- Entrega aproximada calculada según producción pendiente.
- Solicitudes web con código `WEB-XXXXXX` y estado pendiente de pago.
- Confirmación de pago y creación automática del pedido.
- Relación entre catálogo y pedido mediante `productId`.
- Caché local y actualización silenciosa al volver a la pestaña.

## 11.5 — Categorías reorganizadas

- Se eliminó “Figuras para pintar”.
- Esos productos pasaron a “Carameleras”.
- “Palabras” pasó a llamarse “Palabras con luces”.
- Letras, números y palabras sin luces pasaron a “Carameleras”.
- El PDF del catálogo adoptó la misma organización.

## 11.4 — PDF proporcional

- Las imágenes del catálogo PDF mantienen su proporción.
- Las imágenes quedan centradas y sin deformaciones.
- El logo de portada también conserva sus dimensiones.

## 11.2–11.3 — Catálogo PDF

- Se agregó la descarga del catálogo actualizado en PDF.
- Incluye productos visibles, categorías, promociones, imágenes, nombres y medidas.
- Se corrigió una importación que impedía compilar en Vercel.

## 11.0–11.1 — Experiencia de uso

- Menú reorganizado por módulos.
- Inicio con alertas de producción, stock y saldos.
- Catálogo por categorías, carrito flotante y progreso de promociones.
- Precios presentados como unidad, promo por 6 y promo por 12.
- Animaciones suaves y respeto por la preferencia de movimiento reducido.

## 10.x — Estadísticas y promociones

- Estadísticas de visitas, productos vistos, productos agregados y pedidos enviados.
- Registro de localidad, provincia y código postal declarados.
- Corrección del precio por cantidad para aplicar el valor unitario de la promoción alcanzada.

## 8.x–9.x — Catálogo y finanzas

- Catálogo administrable con productos, imágenes, categorías y visibilidad.
- Caja, ingresos, gastos, embalajes y ganancias estimadas.
- Ganancia por figura según cantidad total del pedido.

## 7.x — Catálogo por WhatsApp

- Catálogo público con carrito y formulario de cliente.
- Envío del detalle del pedido por WhatsApp.
- Código postal obligatorio para envíos.
- Incorporación del catálogo visual y sus categorías.

## 6.x y anteriores

- Gestión de pedidos, inventario y piezas para cortar.
- Numeración automática.
- Impresión múltiple y etiquetas.
- Control de capacidad diaria.
- Catálogo, buscador y mejoras generales de interfaz.
