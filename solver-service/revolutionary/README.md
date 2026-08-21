# Motor Revolucionario TVT

Objetivo: construir un motor de nesting sustancialmente mejor sin tocar producción hasta demostrarlo con pruebas repetibles.

## Regla de producción

- Render producción (`polifan-cnc-solver`) queda congelado y con autoDeploy desactivado.
- La referencia exacta del backend estable está preservada en la rama `production-stable-2026-08-21` (commit 2225f3cb0ad98b5f626299443fdce7ef89d42c2a).
- Todo desarrollo nuevo se hace en `motor-revolutionario`.
- Ningún cambio pasa a producción si no supera el banco fijo de pruebas y mantiene gap >= 3.0 mm, 0 conflictos y 0 borde.

## Arquitectura nueva

En vez de apilar runtimes y parches, el flujo será único:

`pendientes -> selector geométrico -> ensemble Sparrow -> warm start -> score TVT -> certificador único -> SVG`

### 1. Selector geométrico

Genera varias carteras de 10..16 juegos completos usando criterios distintos:

- prioridad de entrega;
- área útil;
- compacidad/solidez;
- compatibilidad histórica;
- mezcla de formas grandes/pequeñas;
- candidatos de relleno para franjas y huecos.

La IA no decide coordenadas. Decide qué combinaciones vale la pena enviar al optimizador.

### 2. Ensemble Sparrow

Para cada cartera prometedora se ejecutan varios seeds y presupuestos cortos en paralelo. Cada corrida usa Sparrow/Jagua como núcleo geométrico. La primera solución válida de 10 se guarda como respaldo y nunca se pierde.

### 3. Warm start

Las mejores soluciones pasan a una segunda ronda de exploración/compresión. Sparrow acepta una solución JSON como entrada, por lo que no hace falta empezar de cero en cada intento.

### 4. Score TVT

Orden estricto:

1. cantidad de figuras completas;
2. prioridad comercial/fecha;
3. ocupación real de placa;
4. menor ancho utilizado;
5. tiempo de cálculo.

Nunca se acepta una solución con gap < 3.0 mm ni con conflictos.

### 5. Aprendizaje liviano

Se guarda historial por combinación/modelo:

- tasa de éxito al entrar en 10/11/12+;
- densidad lograda;
- tiempo;
- modelos que conviven bien;
- modelos que suelen bloquear crecimiento.

Eso alimenta el selector, no reemplaza al optimizador geométrico.

## Banco fijo de pruebas

Cada versión se evalúa siempre contra los mismos casos. Las pruebas no dependen del inventario vivo.

Casos iniciales:

- `mama`: placa donde manualmente entró una figura Mamá completa sin mover la solución base;
- `cactus`: placa donde manualmente entró un cactus completo;
- `franja-derecha`: placa con ~200+ mm libres a la derecha y sólo 10 completas;
- `arcoiris`: referencia manual de alta densidad, usada para medir distancia contra una solución humana fuerte.

Métricas por caso:

`completas | ocupacion | gap_mm | conflictos | borde | segundos | ancho_usado`

Un cambio sólo es candidato a producción si:

- no empeora ningún caso estable;
- mejora al menos un caso real de forma material;
- conserva gap >=3.0 mm;
- conserva 0 conflictos y 0 borde;
- no aumenta el tiempo de manera desproporcionada.

## Meta de la primera versión

No se considera éxito pasar de 58% a 60%. La primera versión debe demostrar una mejora visible: más figuras completas por placa y acercarse consistentemente a 70%+ cuando la geometría lo permite.
