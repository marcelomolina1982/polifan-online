from nest_sparrow import app
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # BASE 10 ESTABLE: decide QUE 10 probar; Sparrow acomoda y V1.7 certifica
import strict_svg_cert_runtime  # segunda barrera: valida el SVG exacto a 3 mm y no mueve piezas

# IMPORTANTE: fixed_hole_runtime queda aislado durante la prueba de estabilidad.
# El crecimiento 11+ es una optimizacion opcional y nunca debe poder romper
# una base de 10 que ya demostro estabilidad. Se reactivara en una rama/etapa
# separada una vez terminadas las pruebas de BASE 10 ESTABLE.

import async_jobs
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
