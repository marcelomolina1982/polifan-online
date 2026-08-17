"""Sparrow v25.0.22 Global Recompact runtime.

- conserva la mejor placa certificada como fallback;
- Balanced Growth 11..16;
- segunda fase de recompacción global para intentar 12+;
- 2.5 mm entre piezas y 3 mm de borde;
- objetivo productivo 70%.
"""
import nest_sparrow as ns
import intelligent_selector_runtime as growth
import hybrid_strategy_runtime as hybrid

growth.MAX_GROWTH_TARGET = 16
growth.GROWTH_CANDIDATES = 6
growth.TOTAL_SECONDS = 210
growth.PER_LEVEL_SECONDS = 20.0
growth.RECOMPACT_SECONDS = 42.0
growth.PRODUCTIVE_TARGET_PERCENT = 70.0

FINAL_SOLVER = hybrid.hybrid_nest
ns.nest_sparrow = FINAL_SOLVER
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = FINAL_SOLVER

FINAL_SOLVER.polifan_runtime_version = 'v25.0.22-global-recompact'
FINAL_SOLVER.polifan_growth_targets = '11-16+recompact'
FINAL_SOLVER.polifan_productive_target = 70.0
