# Polifan Online — Tu Vida En Tinta

Sistema web para administrar pedidos, catálogo, inventario, producción, caja, gastos y solicitudes recibidas desde el catálogo por WhatsApp.

## Versión

**13.0.0 — limpieza y organización del proyecto**

Esta versión no elimina funciones del sistema. Unifica la documentación histórica y reduce la cantidad de archivos innecesarios para facilitar la carga en GitHub.

## Funciones principales

- Gestión y numeración automática de pedidos.
- Impresión del pedido interno y remito para el cliente.
- Catálogo administrable con imágenes, categorías y productos activos/inactivos.
- Descarga del catálogo actualizado en PDF.
- Pedidos enviados por WhatsApp.
- Solicitudes web pendientes de pago y conversión a pedido confirmado.
- Control de producción y planchas.
- Inventario y piezas pendientes de cortar.
- Caja, ingresos, gastos, embalajes y ganancias estimadas.
- Estadísticas del catálogo.
- Aplicación instalable como PWA.

## Instalación

```bash
npm install
npm run dev
```

Para generar la versión de producción:

```bash
npm run build
```

## Configuración de Supabase

El proyecto utiliza Supabase para guardar los datos. Los scripts necesarios están en la raíz:

- `SUPABASE_ESTADISTICAS.sql`
- `SUPABASE_SOLICITUDES_WEB.sql`

Cada script debe ejecutarse una sola vez desde **Supabase → SQL Editor** en el proyecto correspondiente.

## Publicación

El proyecto está preparado para Vercel. Al reemplazar archivos en GitHub, Vercel iniciará un nuevo despliegue automáticamente.

## Archivos importantes

- `src/`: código principal de la aplicación.
- `public/`: logo, iconos y archivos de instalación PWA.
- `CHANGELOG.md`: historial consolidado de versiones y mejoras.
- `VERSION.txt`: número de versión actual.

## Negocio

**Tu Vida En Tinta**  
José León Suárez, General San Martín, Buenos Aires  
WhatsApp de pedidos: 11-5919-2358
