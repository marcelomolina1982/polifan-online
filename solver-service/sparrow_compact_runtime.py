"""Sparrow Compact LAB — optimización de aprovechamiento de placa.

Este módulo NO reemplaza el motor estable. Se activa sólo en la rama de laboratorio.
La causa observada del sobrante lateral era que Smart V1.12 detenía el crecimiento
apenas alcanzaba 70% de área real. Compact eleva ese umbral y obliga a seguir
probando 11..18 figuras completas antes de conformarse con una placa válida.

Mantiene el certificador geométrico, gap productivo y Sparrow real.
"""
import nest_sparrow as ns
import intelligent_selector_runtime as growth
import hybrid_strategy_runtime as hybrid

COMPACT_TARGET_PERCENT = 84.0
COMPACT_MAX_COMPLETE = 18

# Antes: 70%. Ese corte temprano hacía que una placa válida dejara 10-13 cm
# aunque todavía existieran candidatos que podían rellenar huecos.
growth.PRODUCTIVE_TARGET_PERCENT = COMPACT_TARGET_PERCENT
growth.MAX_GROWTH_TARGET = COMPACT_MAX_COMPLETE

# Dar más oportunidad a 11/12 y a la recompacción sin cambiar el gap.
growth.PER_LEVEL_SECONDS = max(float(getattr(growth, 'PER_LEVEL_SECONDS', 18.0)), 22.0)
growth.TARGET12_SECONDS = max(float(getattr(growth, 'TARGET12_SECONDS', 48.0)), 58.0)
growth.RECOMPACT_SECONDS = max(float(getattr(growth, 'RECOMPACT_SECONDS', 62.0)), 72.0)

# Para comparar soluciones de igual ocupación, preferir menor franja lateral.
_original_solution_score = growth._solution_score

def _compact_solution_score(selected, result):
    density=float((result or {}).get('density') or 0.0)
    count=len(selected)
    width=float((result or {}).get('stripWidthMm') or 1e18)
    # La ocupación sigue mandando. Dentro de diferencias pequeñas (0,35 puntos),
    # premiamos más figuras y menor ancho usado.
    density_band=round(density / 0.35)
    return (density_band, count, -width, density)

growth._solution_score = _compact_solution_score

# La función híbrida delega a intelligent_nest para casos no homogéneos y lee
# estos globals en runtime, por lo que conserva certificación y seguridad.

COMPACT_BUILD='sparrow-compact-lab-v1'

def compact_runtime_info():
    from flask import jsonify
    return jsonify(
        ok=True,
        build=COMPACT_BUILD,
        mode='LAB_ONLY',
        productiveTargetPercent=COMPACT_TARGET_PERCENT,
        maxComplete=COMPACT_MAX_COMPLETE,
        gapMm=float(getattr(growth,'LAB_GAP_MM',2.5)),
        strategy='seguir creciendo + recompactar + minimizar franja derecha',
        productionUntouched=True,
    )

if 'sparrow_compact_runtime_info' not in ns.app.view_functions:
    ns.app.add_url_rule('/sparrow-compact/runtime-info',endpoint='sparrow_compact_runtime_info',view_func=compact_runtime_info,methods=['GET'])
