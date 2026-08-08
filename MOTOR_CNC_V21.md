# Motor CNC industrial v21

El cálculo automático de placas ya no se realiza en React. La interfaz envía las figuras completas al endpoint `/api/nest`, donde un solver C++ de packing irregular (PackingSolver mediante `pyckingsolver`) calcula posiciones con rotación continua y separación física entre piezas.

## Reglas preservadas
- placa configurada por la app (por defecto 122 x 58 cm)
- medidas SVG originales, sin escala ni deformación
- tapa + base se envían como un kit completo
- prioridad por fecha de salida antes de los rellenos de alta rotación
- separación configurada por el usuario (por defecto 2 mm)
- una sola placa por cálculo

## Vercel
Las dependencias Python están en `requirements.txt`. El endpoint está en `api/nest.py` y `vercel.json` excluye `/api/` del rewrite SPA.

Si Vercel informa que la función Python supera el tamaño estándar, habilitar Large Functions / Fluid Compute en el proyecto y redeployar.

## Comprobación rápida tras desplegar
Abrir `https://TU-DOMINIO/api/nest` en el navegador. Un GET debe devolver un JSON con `status: ready`; la app utiliza POST para resolver una placa.
