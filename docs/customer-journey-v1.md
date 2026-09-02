# Customer Journey V1 — laboratorio sin deploy

Objetivo: preparar y probar el primer bloque de experiencia de cliente antes de tocar producción o gastar intentos de Vercel.

## Alcance V1

1. Pedido confirmado / agendado
   - Evento: el pedido queda confirmado en Polifan.
   - Enviar automáticamente por WhatsApp el comprobante `pedido.jpg` correspondiente al pedido.
   - Mensaje automático: confirma número de pedido, que quedó agendado y que ingresó a la cola de producción.
   - Pedir expresamente al cliente que controle el comprobante y, ante cualquier irregularidad, responda por WhatsApp antes de que el pedido avance.
   - Incluir un enlace privado de seguimiento del pedido.
   - No duplicar el mensaje ni el comprobante si el evento se procesa más de una vez.

2. Seguimiento visible para el cliente
   - El enlace abre una página simple, móvil primero, sin acceso a Polifan.
   - Mostrar número de pedido y nombre del cliente de forma limitada, sin exponer DNI, teléfono, domicilio completo ni datos internos.
   - Mostrar una barra de progreso con estas etapas:
     1. Pedido agendado
     2. En producción
     3. En corte
     4. Para embalar
     5. Despachado / Listo para retirar
   - La etapa actual debe destacarse visualmente y las anteriores quedar marcadas como completadas.
   - La URL debe usar un token público aleatorio y no un ID secuencial fácil de adivinar.
   - El seguimiento debe leer un estado público mínimo, separado de los datos internos del pedido.

3. Corte terminado
   - Evento: todas las piezas requeridas del pedido quedan marcadas como cortadas.
   - Mensaje automático: informa que las piezas fueron cortadas y que el pedido pasa a pegado, control y embalaje.
   - Actualizar la barra de seguimiento.
   - No enviar por cortes parciales.

4. Despachado / listo para retirar
   - Evento: operador confirma el estado final desde Producción.
   - Vía Cargo: informar que fue despachado hacia la sucursal de destino.
   - Logística: informar que fue despachado hacia el domicilio del cliente.
   - Retiro: informar que está listo para retirar.
   - Actualizar la barra de seguimiento a estado final.
   - Incluir agradecimiento de Tu Vida en Tinta.
   - Incluir invitación a dejar una reseña una vez recibido el pedido, con un enlace configurable.

## Vista Producción

Agregar conceptualmente una sección grande "Pedidos de hoy" con:
- número de pedido
- cliente
- cantidad de piezas
- tipo de entrega
- estado actual
- acción principal según etapa
- botón final DESPACHADO / LISTO PARA RETIRAR

El cambio de estado es la fuente de verdad. El mensaje y el seguimiento se generan a partir de ese cambio y de los datos existentes del pedido.

## Registro anti-duplicados

Cada notificación debe registrar:
- orderId
- eventKey: confirmed | cut_complete | dispatched | ready_pickup
- destinatario
- fecha/hora
- estado: pending | sent | failed
- providerMessageId si existe
- último error si falla
- receiptAttached: true/false cuando corresponda
- trackingToken usado

Regla: una combinación orderId + eventKey no puede enviarse dos veces salvo reintento explícito de un envío failed.

## Mensajes base para pruebas

### Confirmado + comprobante
Hola {nombre} 💜 Tu pedido #{numero} de Tu Vida en Tinta ya fue agendado correctamente y quedó en nuestra cola de producción.

Te enviamos adjunto tu comprobante `pedido.jpg`. Por favor, controlá que los datos, diseños, cantidades y modalidad de entrega sean correctos. Si encontrás cualquier irregularidad, escribinos por este mismo WhatsApp para poder revisarlo antes de que avance la producción.

Podés seguir el estado de tu pedido acá: {trackingUrl}

Gracias por confiar en nosotros.

### Corte terminado
Hola {nombre} 💜 Tenemos novedades de tu pedido #{numero}: todas las piezas ya fueron cortadas y ahora pasan a la etapa de pegado, control y embalaje. ¡Cada vez falta menos!

Podés ver el avance acá: {trackingUrl}

### Despachado — Vía Cargo
Hola {nombre} 💜 Tu pedido #{numero} ya fue despachado por Vía Cargo hacia la sucursal de destino.

Gracias por elegir Tu Vida en Tinta. Disfrutamos preparando tu pedido y esperamos que disfrutes muchísimo recibirlo.

Cuando lo recibas, si quedaste conforme con nuestro trabajo, nos ayudaría muchísimo que nos dejes una reseña acá: {reviewUrl}

Seguimiento: {trackingUrl}

### Despachado — logística
Hola {nombre} 💜 Tu pedido #{numero} ya fue despachado y va camino a tu domicilio.

Gracias por elegir Tu Vida en Tinta. Disfrutamos preparando tu pedido y esperamos que disfrutes muchísimo recibirlo.

Cuando lo recibas, si quedaste conforme con nuestro trabajo, nos ayudaría muchísimo que nos dejes una reseña acá: {reviewUrl}

Seguimiento: {trackingUrl}

### Listo para retirar
Hola {nombre} 💜 Tu pedido #{numero} ya está terminado, controlado y listo para retirar.

Gracias por elegir Tu Vida en Tinta y por confiar en nuestro trabajo.

Después de retirarlo, si quedaste conforme, nos ayudaría muchísimo que nos dejes una reseña acá: {reviewUrl}

## Recomendación de postventa

No marcar la reseña como obligatoria ni enviarla antes del despacho. La invitación debe ser amable y quedar disponible también en la página de seguimiento final. Como mejora posterior, se puede enviar un recordatorio de postventa únicamente después de confirmar recepción o pasado un plazo razonable desde el despacho.

## Pruebas antes de implementar

- Usar pedidos ficticios o modo simulación; nunca enviar WhatsApp real durante la primera prueba.
- Generar un `pedido.jpg` de prueba y verificar que corresponda exactamente al pedido antes de asociarlo al mensaje.
- Probar que un pedido confirmado genera una sola notificación y un solo adjunto.
- Probar cada tipo de entrega.
- Probar todos los estados de la barra de seguimiento.
- Verificar que un token inválido no revele datos del pedido.
- Verificar que la página pública no exponga DNI, teléfono, domicilio completo, costos internos ni notas internas.
- Probar un pedido con corte parcial: no debe generar cut_complete.
- Procesar dos veces el mismo evento: debe quedar un solo mensaje.
- Simular fallo del proveedor: debe quedar failed y permitir reintento controlado.
- Confirmar que ningún cambio de estado modifica o elimina otros pedidos.
- Confirmar que la UI móvil de Producción permite accionar sin errores.

## Restricciones de seguridad del proyecto

- No tocar main durante el laboratorio.
- No desplegar esta rama en Vercel mientras se prepara.
- No modificar datos reales de Supabase para probar.
- No tocar el motor de placas.
- Antes de producción: revisar diff completo, build, persistencia/concurrencia y recién después hacer un único despliegue coherente.

## Pendiente técnico para mañana

- Elegir y validar la integración oficial de WhatsApp para envío automático, incluyendo requisitos para archivos multimedia, plantillas, costos y límites vigentes.
- Definir cómo generar/recuperar el `pedido.jpg` exacto de cada pedido y entregarlo al proveedor de WhatsApp sin depender de rutas locales.
- Definir dónde persistir el outbox/registro de notificaciones sin aumentar innecesariamente transferencia de Supabase.
- Definir el almacenamiento público mínimo para seguimiento y generación segura de tokens.
- Definir el enlace de reseñas que usará Tu Vida en Tinta.
- Mapear los nombres exactos de campos/estados actuales de Polifan al flujo anterior.
- Implementar primero en modo simulación (outbox sin envío) y validar el recorrido completo antes de conectar WhatsApp real.
