## 14.7 - Datos de envío completos
- Nombre y apellido separados en pedidos, catálogo y clientes.
- Se agregó Partido / Departamento.
- Domicilio, localidad, partido, provincia y código postal alimentan impresión, etiqueta, comprobante y agenda de clientes.
- Compatibilidad con pedidos anteriores que guardaban el nombre completo.

# Cambios

## 14.6 — Planificación online unificada
- El catálogo, WhatsApp y solicitudes web usan el mismo motor de planificación.
- La producción se vuelve a consultar al abrir el catálogo, al regresar a la pestaña, cada 30 segundos y antes de enviar.
- Los cierres manuales y la ocupación de 90 piezas se aplican en tiempo real.
- Se eliminan cachés antiguas de la PWA y se desactiva la caché del HTML, service worker y versión.
- La fecha aproximada se muestra como rango de tres días, comenzando 72 horas después del último día de corte.

## 14.5
- Corrección del cálculo de fecha aproximada.
- El rango comienza 72 horas después del último día necesario de corte.
- Se muestra como "del martes al jueves" en vez de una única fecha.
- Los domingos se desplazan al lunes.
- Se conserva por separado la fecha interna de producción para no alterar la agenda.

# Versión 14.4

- Cierre manual de producción por fecha.
- Las entregas estimadas parten del día posterior al último cierre.
- Se busca automáticamente el próximo día con espacio dentro del límite de 90 piezas.
- Domingos y días cerrados quedan excluidos.
- El catálogo muestra una fecha límite de entrega calculada a 48 horas del último día de corte.

# Versión 13.4.0

- Datos de entrega unificados en pedidos manuales y solicitudes web.
- Dirección, localidad, provincia y código postal obligatorios.
- La etiqueta y el detalle de compra usan esos datos directamente.
- Las solicitudes web conservan todos los datos al convertirse en pedidos.

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

## 13.1.0
- Mensaje de WhatsApp al cliente más completo según estado, cantidad, total y fecha de salida.
- Se quitaron los botones Imprimir etiqueta y Etiqueta JPG de la lista de pedidos.
- Se conservó el formato clásico de impresión del pedido con remito debajo.
- Renovación visual del catálogo público: portada premium, señales de confianza, buscador destacado, tarjetas modernas, selección visible y mejor experiencia móvil.
- Limpieza de documentos históricos innecesarios para facilitar la carga en GitHub.

## 13.3.0
- Nueva impresión A4 completa: pedido interno + etiqueta de caja + detalle de compra.
- Pedido interno más grande y etiqueta más compacta.
- Resumen de hasta 16 modelos en dos columnas; el detalle completo continúa en una hoja adicional cuando es necesario.
- Recomendación automática de embalaje:
  - 1–6: 30×20×20 cm
  - 7–12: 40×30×30 cm
  - 13–20: Caja Vía Cargo, utilizable con cualquier expreso
  - 21–24: 50×40×30 cm
  - 25–36: 50×40×40 cm
  - 37–48: 60×40×40 cm
  - Más de 48: combinación automática de cajas
- Indicación de envolver con film negro.
- Limpieza de archivos LEEME y documentación histórica duplicada.

## 14.0.0 — 04/08/2026
- Calendario visual de producción con capacidad de 90 piezas por día.
- Catálogo premium con más elegidos y novedades.
- Historial de clientes con datos completos, favoritos y distintivo de cliente frecuente.
- Autocompletado de datos al crear pedidos usando teléfono o nombre.
- Dashboard ampliado con solicitudes web, embalados y acceso al calendario.
- Embalaje inteligente con recomendación automática de cajas y materiales.

## 14.1.0
- Alta y actualización automática de clientes desde pedidos.
- DNI opcional en pedidos, catálogo y clientes.
- Importación histórica de clientes sin duplicados.

## 14.2.0 — 04/08/2026
- Restyling completo del dashboard con jerarquía visual moderna.
- Resumen de producción del día con barra de capacidad.
- Nuevas tarjetas interactivas de pedidos, ventas, ganancia y stock.
- Alertas accionables y agenda de próximas entregas.
- Versión centralizada desde `version.json` para evitar números antiguos.

## 14.3.0 — 04/08/2026
- Datos del pedido interno adaptados a Logística, Retiro en el local y Vía Cargo / Correo Argentino.
- Listado completo de figuras y QR público de control desde el celular.
- Pedidos ordenables por fecha de salida y buscador compatible con fechas.
- Eliminada la acción Duplicar.
- Catálogo sin bloque “Inspirate”; abre directamente en Carameleras.
- Solicitudes web con campos condicionales de entrega, email, entre calles y modalidad de agencia/domicilio.
