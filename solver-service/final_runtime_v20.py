"""Sparrow v25.0.25 / V1.13 Residual Fill runtime.

Hotfix productivo:
- mínimo 10 figuras completas;
- 3.0 mm reales entre piezas desde el inicio de la búsqueda;
- el wrapper de seguridad agrega su colchón interno al solver;
- crecimiento 11..16 y recompacción;
- relleno residual primero con completas y luego hasta 3 piezas sueltas;
- las piezas sueltas no suman completeFigures y dejan su contraparte pendiente.
"""
import nest_sparrow as ns
import intelligent_selector_runtime as growth
import hybrid_strategy_runtime as hybrid
import partial_fill_runtime as partial
from partial_fill_runtime import with_partial_fill

# Unificar TODO el pipeline productivo en 3 mm. Antes growth/hybrid/partial
# seguían arrancando en 2.5 mm y la certificación final rechazaba la placa.
growth.LAB_GAP_MM = 3.0
hybrid.LAB_GAP_MM = 3.0
partial.LAB_GAP_MM = 3.0
partial.COMPLETE_GAP_MM = 3.0

growth.MAX_GROWTH_TARGET = 16
growth.PRODUCTIVE_TARGET_PERCENT = 70.0

FINAL_SOLVER = with_partial_fill(hybrid.hybrid_nest)
ns.nest_sparrow = FINAL_SOLVER
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = FINAL_SOLVER

FINAL_SOLVER.polifan_runtime_version = 'v25.0.26-hotfix-3mm-pipeline'
FINAL_SOLVER.polifan_growth_targets = '10-min-11-16+residual-3'
FINAL_SOLVER.polifan_productive_target = 70.0
FINAL_SOLVER.polifan_partial_fill = True
FINAL_SOLVER.polifan_residual_fill = 'v1.13-complete-first-3mm'
FINAL_SOLVER.polifan_gap_mm = 3.0
