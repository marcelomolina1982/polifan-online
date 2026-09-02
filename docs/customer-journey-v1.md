# Customer Journey V1 — laboratorio sin deploy

Objetivo: preparar y probar el primer bloque de experiencia de cliente antes de tocar producción o gastar intentos de Vercel.

## Alcance V1

1. Pedido confirmado / agendado
   - Evento: el pedido queda confirmado en Polifan.
   - Mensaje automático: confirma número de pedido, que quedó agendado y que ingresó a la cola de producción.
   - No duplicar el mensaje si el evento se procesa más de una vez.

2. Corte terminado
   - Evento: todas las piezas requeridas del pedido quedan marcadas como cortadas.
   - Mensaje automático: informa que las piezas fueron cortadas y que el pedido pasa a pegado, control y embalaje.
   - No enviar por cortes parciales.

3. Despachado / listo para retirar
   - Evento: operador confirma el estado final desde Producción.
   - Vía Cargo: informar que fue despachado hacia la sucursal de destino.
   - Logística: informar que fue despachado hacia el domicilio del cliente.
   - Retiro: informar que está listo para retirar.
   - Incluir agradecimiento de Tu Vida en Tinta.

## Vista Producción

Agregar conceptualmente una sección grande "Pedidos de hoy" con:
- número de pedido
- cliente
- cantidad de piezas
- tipo de entrega
- estado actual
- acción principal según etapa
- botón final DESPACHADO / LISTO PARA RETIRAR

El cambio de estado es la fuente de verdad. El mensaje se genera a partir de ese cambio y de los datos existentes del pedido.

## Registro anti-duplicados

Cada notificación debe registrar:
- orderId
- eventKey: confirmed | cut_complete | dispatched | ready_pickup
- destinatario
- fecha/hora
- estado: pending | sent | failed
- providerMessageId si existe
- último error si falla

Regla: una combinación orderId + eventKey no puede enviarse dos veces salvo reintento explícito de un envío failed.

## Mensajes base para pruebas

### Confirmado
Hola {nombre} 💜 Tu pedido #{numero} de Tu Vida en Tinta ya fue agendado correctamente y quedó en nuestra cola de producción. Te vamos a mantener al tanto a medida que avance. Gracias por confiar en nosotros.

### Corte terminado
Hola {nombre} 💜 Tenemos novedades de tu pedido #{numero}: todas las piezas ya fueron cortadas y ahora pasan a la etapa de pegado, control y embalaje. ¡Cada vez falta menos!

### Despachado — Vía Cargo
Hola {nombre} 💜 Tu pedido #{numero} ya fue despachado por Vía Cargo hacia la sucursal de destino. Gracias por elegir Tu Vida en Tinta. Disfrutamos preparando tu pedido y esperamos que disfrutes muchísimo recibirlo.

### Despachado — logística
Hola {nombre} 💜 Tu pedido #{numero} ya fue despachado y va camino a tu domicilio. Gracias por elegir Tu Vida en Tinta. Disfrutamos preparando tu pedido y esperamos que disfrutes muchísimo recibirlo.

### Listo para retirar
Hola {nombre} 💜 Tu pedido #{numero} ya está terminado, controlado y listo para retirar. Gracias por elegir Tu Vida en Tinta y por confiar en nuestro trabajo.

## Pruebas antes de implementar

- Usar pedidos ficticios o modo simulación; nunca enviar WhatsApp real durante la primera prueba.
- Probar cada tipo de entrega.
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

- Elegir y validar la integración oficial de WhatsApp para envío automático, incluyendo requisitos, plantillas, costos y límites vigentes.
- Definir dónde persistir el outbox/registro de notificaciones sin aumentar innecesariamente transferencia de Supabase.
- Mapear los nombres exactos de campos/estados actuales de Polifan al flujo anterior.
- Implementar primero en modo simulación (outbox sin envío) y validar el recorrido completo antes de conectar WhatsApp real.
