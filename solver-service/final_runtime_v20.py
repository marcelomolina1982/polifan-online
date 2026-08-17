"""Sparrow v25.0.21 Balanced Growth runtime.

Conserva la placa certificada de 10 como fallback y activa el selector balanceado:
- 2.5 mm entre piezas;
- 3 mm de borde;
- crecimiento real 11..16;
- presupuesto reservado por nivel para evitar que 11 consuma todo el tiempo;
- objetivo productivo 70% con certificación geométrica obligatoria.
"""
import nest_sparrow as ns
import intelligent_selector_runtime as growth
import hybrid_strategy_runtime as hybrid

growth.MAX_GROWTH_TARGET = 16
growth.GROWTH_CANDIDATES = 6
growth.TOTAL_SECONDS = 180
growth.PER_LEVEL_SECONDS = 22.0
growth.PRODUCTIVE_TARGET_PERCENT = 70.0

# El híbrido prueba primero el caso homogéneo. Si no aplica, su _original_nest
# es el intelligent_nest cargado antes y ahora ejecuta Balanced Growth V1.9.
FINAL_SOLVER = hybrid.hybrid_nest
ns.nest_sparrow = FINAL_SOLVER
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = FINAL_SOLVER

FINAL_SOLVER.polifan_runtime_version = 'v25.0.21-balanced-growth'
FINAL_SOLVER.polifan_growth_targets = '11-16-balanced'
FINAL_SOLVER.polifan_productive_target = 70.0