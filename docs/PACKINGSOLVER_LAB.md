# PackingSolver irregular lab

Rama experimental para integrar PackingSolver sin tocar el solver estable.

## Reglas Polifan
- Placa: 1220 x 580 mm.
- Separación mínima pieza-pieza: 3 mm.
- Base + tapa forman una figura completa.
- No escalar ni deformar geometría SVG.
- Rotación permitida.
- Cero colisiones y cero piezas fuera de placa.
- Objetivo mínimo operativo: 10 figuras completas por placa.
- Toda solución debe pasar por el certificador existente antes de aceptarse.

## Arquitectura objetivo
1. Convertir geometrías SVG base/tapa a polígonos de PackingSolver.
2. Ejecutar `irregular` con `item_item_minimum_spacing: 3`.
3. Convertir el certificado de salida a placements Polifan.
4. Validar placements con el certificador actual.
5. Competir PackingSolver vs Sparrow/motor actual.
6. Conservar automáticamente la mejor solución certificada.

Referencia oficial: PackingSolver irregular admite polígonos no convexos, agujeros, rotaciones discretas/continuas y distancia mínima entre piezas.
