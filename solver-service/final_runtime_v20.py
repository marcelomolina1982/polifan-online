"""Sparrow v25.0.26 / V1.14 Global Human Search runtime.

- parte de la solución segura V1.13;
- conserva mínimo 10 completas, 2.5 mm entre piezas y 3 mm de borde;
- ejecuta destroy-and-repair global para escapar de óptimos locales;
- prueba +1, quitar 1/agregar 2, quitar 2/agregar 3 y quitar 3/agregar 4;
- cambia ordenes y semillas para explorar geometrías distintas;
- sólo reemplaza el baseline si la nueva placa queda certificada y mejora ocupación.
"""
import nest_sparrow as ns
import intelligent_selector_runtime as growth
import hybrid_strategy_runtime as hybrid
from partial_fill_runtime import with_partial_fill
from global_human_search_runtime import with_global_human_search

growth.MAX_GROWTH_TARGET = 16
growth.PRODUCTIVE_TARGET_PERCENT = 70.0

# Primero corre la solución segura existente. Después la fase V1.14 intenta superarla.
SAFE_SOLVER = with_partial_fill(hybrid.hybrid_nest)
FINAL_SOLVER = with_global_human_search(SAFE_SOLVER)
ns.nest_sparrow = FINAL_SOLVER
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = FINAL_SOLVER

FINAL_SOLVER.polifan_runtime_version = 'v25.0.26-global-human-search-v14'
FINAL_SOLVER.polifan_growth_targets = '10-min-area-first-11-16+residual+destroy-repair'
FINAL_SOLVER.polifan_productive_target = 70.0
FINAL_SOLVER.polifan_partial_fill = True
FINAL_SOLVER.polifan_residual_fill = 'v1.13-safe-baseline'
FINAL_SOLVER.polifan_global_human_search = 'v1.14'
