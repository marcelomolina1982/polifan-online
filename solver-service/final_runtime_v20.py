"""Sparrow v25.0.24 / V1.12 Area First runtime.

- mínimo 10 figuras completas;
- maximiza ocupación real certificada antes que cantidad de figuras;
- crecimiento 11..16 y recompacción;
- 2.5 mm entre piezas y 3 mm de borde;
- relleno residual opcional con UNA tapa/base suelta;
- la pieza suelta no suma completeFigures y deja registrada su contraparte faltante.
"""
import nest_sparrow as ns
import intelligent_selector_runtime as growth
import hybrid_strategy_runtime as hybrid
from partial_fill_runtime import with_partial_fill

growth.MAX_GROWTH_TARGET = 16
growth.PRODUCTIVE_TARGET_PERCENT = 70.0

# hybrid conserva el atajo homogéneo; para casos normales delega al selector Area First.
# El wrapper de partial fill se aplica al final de ambos caminos.
FINAL_SOLVER = with_partial_fill(hybrid.hybrid_nest)
ns.nest_sparrow = FINAL_SOLVER
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = FINAL_SOLVER

FINAL_SOLVER.polifan_runtime_version = 'v25.0.24-area-first-partial-fill'
FINAL_SOLVER.polifan_growth_targets = '10-min-area-first-11-16+partial'
FINAL_SOLVER.polifan_productive_target = 70.0
FINAL_SOLVER.polifan_partial_fill = True
