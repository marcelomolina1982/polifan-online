"""Sparrow V1.8 v25.0.20 final runtime selector.

Objetivos:
- conservar la base certificada de 10 como fallback;
- garantizar que /nest-sparrow termine apuntando al runtime Growth Fix, no a smart-1;
- explorar 11..16 aunque ya se alcance 70%, para aprovechar mejor el ancho completo;
- mantener 2.5 mm entre piezas y 3 mm de borde mediante los runtimes existentes.
"""
import nest_sparrow as ns
import intelligent_selector_runtime as growth
import hybrid_strategy_runtime as hybrid

# Más profundidad sin sacrificar la salida segura de 10.
growth.MAX_GROWTH_TARGET = 16
growth.GROWTH_CANDIDATES = 24
growth.TOTAL_SECONDS = 220
growth.PRODUCTIVE_TARGET_PERCENT = 70.0

# El híbrido conserva su boost homogéneo; si no aplica, su _original_nest apunta
# al intelligent_nest cargado antes de este módulo y usa las constantes mutadas.
FINAL_SOLVER = hybrid.hybrid_nest
ns.nest_sparrow = FINAL_SOLVER
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = FINAL_SOLVER

# Identidad explícita para diagnóstico en /engine-info y jobs asíncronos.
FINAL_SOLVER.polifan_runtime_version = 'v25.0.20-final-growth'
FINAL_SOLVER.polifan_growth_targets = '11-16'
FINAL_SOLVER.polifan_productive_target = 70.0
