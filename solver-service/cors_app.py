from nest_sparrow import app
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # BASE 10 ESTABLE: decide QUE 10 probar; Sparrow acomoda

# IMPORTANTE: fixed_hole_runtime viejo queda AISLADO. No se vuelve a importar.
# La nueva capa safe_hole_growth_runtime trabaja despues de la BASE 10 y ante
# cualquier fallo devuelve intacta la placa de 10 ya certificada.

import strict_svg_cert_runtime  # segunda barrera: valida el SVG exacto a 3 mm y no mueve piezas
import safe_hole_growth_runtime  # primer intento 10->11+ conservando la base y rellenando huecos
import hybrid_competitor_runtime  # segundo intento: PackingSolver reacomoda 10+1 desde cero; Sparrow siempre queda de respaldo
import nest_v8  # geometry-first: NFP/Minkowski con gap >=3 mm como restriccion dura
import async_jobs
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
