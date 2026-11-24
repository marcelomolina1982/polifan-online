# Gestión Polifan — verificación de respaldo SIN modificar producción

**Estado 24/11/2026: pendiente de respaldo restaurado y verificado.**

El respaldo físico de Supabase Pro es una protección útil, pero no
sustituye la prueba de recuperación independiente. No usar el botón
**Restore** sobre el proyecto que está atendiendo pedidos.

## Ruta sin contratar otro proyecto Supabase

Se puede preparar una exportación lógica desde una PC Windows con Docker
Desktop y Supabase CLI. No depende de crear un proyecto extra de pago.
**No se ejecutó todavía en una computadora del comercio.**

1. En Supabase, revisar **Database → Backups**. Confirmar una fecha
   reciente, sin seleccionar Restore. En Pro se conservan normalmente
   los últimos siete respaldos diarios.
2. Instalar Docker Desktop y la CLI de Supabase en una PC controlada
   por el comercio. Verificar versión con `supabase --version` y
   opciones con `supabase db dump --help`; CLI v3 cambió sus
   comportamientos predeterminados. En Windows usar PowerShell.
3. En Supabase Dashboard, abrir **Connect → Session pooler**. Usar las
   credenciales únicamente en la PC, **nunca en GitHub, correo, capturas,
   ChatGPT ni archivos del proyecto**. No pegar la cadena de conexión
   con contraseña en el historial de PowerShell; usar un mecanismo
   local de secreto y limpiar los procesos y variables temporales.
4. Seguir los tres volcados que documenta oficialmente Supabase:
   roles, esquema y datos. Referencia exacta:
   https://supabase.com/docs/guides/self-hosting/restore-from-platform
   y https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore .
   La forma general de los comandos es:

   ```powershell
   supabase db dump --db-url <CONEXION_PRIVADA_LOCAL> -f roles.sql --role-only
   supabase db dump --db-url <CONEXION_PRIVADA_LOCAL> -f schema.sql
   supabase db dump --db-url <CONEXION_PRIVADA_LOCAL> -f data.sql --use-copy --data-only
   ```

   **No ejecutar los marcadores `<CONEXION_PRIVADA_LOCAL>` literalmente.**
   Son ejemplos de documentación, no una orden lista para pegar.
5. Guardar los archivos en un soporte externo cifrado, fuera de la PC
   operativa. Confirmar que los archivos existen y tienen tamaño mayor
   que cero. No subirlos al repositorio ni a una conversación: contienen
   clientes, domicilios, pedidos y otros datos personales.
6. En un PostgreSQL / Supabase **local y aislado**, practicar la
   restauración siguiendo la guía oficial y ejecutando después
   `scripts/verify-v2-restore-manifest-READONLY.sql` sobre la
   copia. Comparar conteos y huellas contra un manifiesto obtenido de
   una instantánea **del mismo momento**. Una copia antigua no debe
   coincidir necesariamente con la base comercial actual.
7. Verificar manualmente un pedido, un movimiento y una imagen de
   muestra dentro de la copia, sin conectar esa copia a la URL de
   producción ni ejecutar envíos o notificaciones.

## Alcance y límites

- La CLI `db dump` omite esquemas administrados por Supabase como
  `auth` y `storage`. **Estos tres volcados no constituyen una copia
  completa de usuarios, archivos Storage ni funciones Edge.** Preparar
  un plan separado para esos servicios antes de declarar recuperación
  integral: https://supabase.com/docs/reference/cli/supabase-db-dump
- El respaldo físico diario en Supabase y la copia lógica externa
  cumplen propósitos complementarios.
- El manifiesto de `scripts/verify-v2-restore-manifest-READONLY.sql`
  mide integridad pero **no genera ni restaura un backup**.
- No crear clones de Supabase ni ramificaciones facturables sin
  consentimiento explícito sobre su costo.
- El cambio SQL set-based PR #78 y la compactación PR #74 permanecen
  bloqueados hasta comprobar recuperación, pruebas y reversión.
