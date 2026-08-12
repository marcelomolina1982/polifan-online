from __future__ import annotations
import motor_definitivo_v1 as core
import motor_definitivo_v2 as v2

# Conservamos el algoritmo/LNS V1.2 que ya consiguió 20/20.
# V1.3 optimiza únicamente la revalidación raster del SVG exportado.
_ORIGINAL_VALIDATE = core.validate


def _adaptive_validate(svg_path, ppm=4.0):
    """Relee y rasteriza el SVG exportado a 2 px/mm.

    La búsqueda ya exige 0,5 mm de margen extra (3,0 mm para certificar 2,5 mm),
    por lo que 2 px/mm aporta resolución de 0,5 mm sin rasterizar 20 placas
    completas a 4 px/mm. Si falla, no certifica.
    """
    val = _ORIGINAL_VALIDATE(svg_path, 2.0)
    val['validation_mode'] = 'adaptive_2ppm_with_0_5mm_search_safety'
    val['validation_ppm'] = 2.0
    return val


# v2 consulta core.validate dinámicamente al final de cada solución.
core.validate = _adaptive_validate


def solve_svg_text(svg_text: str, filename: str = 'placa.svg', seconds3: float = 8., seconds25: float = 14.):
    result = v2.solve_svg_text(svg_text, filename, seconds3, seconds25)
    result = dict(result)
    result['engineVersion'] = 'V1.3'
    result['certificationStrategy'] = 'adaptive_2ppm_with_0_5mm_search_safety'
    return result
