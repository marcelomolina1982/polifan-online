# Polifan Online — estructura modular

La aplicación conserva la misma base de datos y el mismo registro `app_state/main` de Supabase. La reorganización no borra pedidos, clientes, inventario ni placas existentes.

## Carpetas

- `src/App.jsx`: sesión, carga/guardado y navegación.
- `src/pages/`: una pantalla por archivo.
- `src/components/UI.jsx`: componentes visuales compartidos.
- `src/lib/constants.js`: estado inicial, catálogo inicial y estados.
- `src/lib/format.js`: fechas, precios y moneda.
- `src/lib/inventory.js`: cálculo de demanda, stock y pendientes de corte.
- `src/supabase.js`: conexión existente a Supabase.

## Ventaja

Cada cambio futuro puede realizarse dentro de su módulo sin editar un único archivo gigante. Esto reduce errores y facilita agregar caja, presupuestos, estadísticas o nuevos tipos de corte.
